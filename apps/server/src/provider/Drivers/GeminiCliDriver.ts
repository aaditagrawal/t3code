/**
 * GeminiCliDriver — `ProviderDriver` for the Google Gemini CLI runtime.
 *
 * Mirrors `ClaudeDriver` / `OpenCodeDriver`: a plain value whose `create()`
 * returns one `ProviderInstance` bundling `snapshot` / `adapter` /
 * `textGeneration` closures captured over the per-instance
 * `GenericProviderSettings` payload (used as `GeminiCliSettings` until the
 * settings schema is split out).
 *
 * Two instances with different `binaryPath`s spawn fully independent
 * `gemini` subprocesses — there is no module-global session table or usage
 * accumulator anymore.
 *
 * @module provider/Drivers/GeminiCliDriver
 */
import {
  GenericProviderSettings,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { ServerConfig } from "../../config.ts";
import { makeGeminiCliTextGeneration } from "../../textGeneration/GeminiCliTextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { makeGeminiCliAdapter } from "../Layers/GeminiCliAdapter.ts";
import { checkGeminiCliStatus, makePendingGeminiCliProvider } from "../Layers/GeminiCliProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";

const DRIVER_KIND = ProviderDriverKind.make("geminiCli");
const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);
const MAINTENANCE_CAPABILITIES = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

export type GeminiCliDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

const withInstanceIdentity =
  (input: {
    readonly instanceId: ProviderInstance["instanceId"];
    readonly displayName: string | undefined;
    readonly accentColor: string | undefined;
    readonly continuationGroupKey: string;
  }) =>
  (snapshot: ServerProviderDraft): ServerProvider => ({
    ...snapshot,
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    continuation: { groupKey: input.continuationGroupKey },
  });

export const GeminiCliDriver: ProviderDriver<GenericProviderSettings, GeminiCliDriverEnv> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "Gemini CLI",
    supportsMultipleInstances: true,
  },
  configSchema: GenericProviderSettings,
  defaultConfig: (): GenericProviderSettings => Schema.decodeSync(GenericProviderSettings)({}),
  create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const eventLoggers = yield* ProviderEventLoggers;
      const processEnv = mergeProviderInstanceEnvironment(environment);
      const continuationIdentity = defaultProviderContinuationIdentity({
        driverKind: DRIVER_KIND,
        instanceId,
      });
      const stampIdentity = withInstanceIdentity({
        instanceId,
        displayName,
        accentColor,
        continuationGroupKey: continuationIdentity.continuationKey,
      });
      const effectiveConfig = { ...config, enabled } satisfies GenericProviderSettings;

      const adapter = yield* makeGeminiCliAdapter(effectiveConfig, {
        instanceId,
        environment: processEnv,
        ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
      });
      const textGeneration = yield* makeGeminiCliTextGeneration(effectiveConfig, processEnv);

      const checkProvider = checkGeminiCliStatus(effectiveConfig, processEnv).pipe(
        Effect.map(stampIdentity),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(Path.Path, path),
      );

      const snapshot = yield* makeManagedServerProvider<GenericProviderSettings>({
        maintenanceCapabilities: MAINTENANCE_CAPABILITIES,
        getSettings: Effect.succeed(effectiveConfig),
        streamSettings: Stream.never,
        haveSettingsChanged: () => false,
        initialSnapshot: (settings) =>
          Effect.succeed(stampIdentity(makePendingGeminiCliProvider(settings))),
        checkProvider,
        refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderDriverError({
              driver: DRIVER_KIND,
              instanceId,
              detail: `Failed to build Gemini CLI snapshot: ${cause.message ?? String(cause)}`,
              cause,
            }),
        ),
      );

      return {
        instanceId,
        driverKind: DRIVER_KIND,
        continuationIdentity,
        displayName,
        accentColor,
        enabled,
        snapshot,
        adapter,
        textGeneration,
      } satisfies ProviderInstance;
    }),
};
