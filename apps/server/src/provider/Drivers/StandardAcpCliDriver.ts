import {
  type ProviderDriverKind,
  type ServerProvider,
  TextGenerationError,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { TextGenerationShape } from "../../textGeneration/TextGeneration.ts";
import { ProviderDriverError } from "../Errors.ts";
import { parseStandardAcpCliArguments } from "../acp/StandardAcpCliSupport.ts";
import type { StandardAcpAdapterLiveOptions } from "../Layers/StandardAcpAdapter.ts";
import {
  buildInitialStandardAcpCliProviderSnapshot,
  checkStandardAcpCliProviderStatus,
  type StandardAcpCliProviderConfig,
} from "../Layers/StandardAcpCliProvider.ts";
import { ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "../providerMaintenance.ts";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "../ProviderDriver.ts";
import { mergeProviderInstanceEnvironment } from "../ProviderInstanceEnvironment.ts";
import type { ServerProviderDraft } from "../providerSnapshot.ts";

const SNAPSHOT_REFRESH_INTERVAL = Duration.minutes(5);

export interface StandardAcpCliSettings {
  readonly enabled: boolean;
  readonly binaryPath: string;
  readonly arguments?: string;
  readonly customModels: ReadonlyArray<string>;
  readonly homePath?: string | undefined;
}

export type StandardAcpCliDriverEnv =
  | BackgroundPolicy.BackgroundPolicy
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig
  | ServerSettingsService;

export interface StandardAcpCliDriverConfig<Settings extends StandardAcpCliSettings> {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly defaultBinary: string;
  readonly settingsSchema: Schema.Codec<Settings, unknown>;
  readonly defaultSettings: () => Settings;
  readonly launchArgs?: ReadonlyArray<string>;
  readonly makeAdapter: (
    settings: Settings,
    options: StandardAcpAdapterLiveOptions,
  ) => Effect.Effect<ProviderInstance["adapter"], never, StandardAcpCliDriverEnv | Scope.Scope>;
  readonly setupHint: string;
  readonly missingCommandMessage: string;
  readonly excludedAuthMethodIds?: ReadonlySet<string>;
  readonly homeEnvVarName?: string;
}

function makeUnsupportedTextGeneration(displayName: string): TextGenerationShape {
  const fail = (operation: TextGenerationError["operation"]) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${displayName} ACP is not supported for headless text generation. Select a different provider instance for generated metadata.`,
      }),
    );
  return {
    generateCommitMessage: () => fail("generateCommitMessage"),
    generatePrContent: () => fail("generatePrContent"),
    generateBranchName: () => fail("generateBranchName"),
    generateThreadTitle: () => fail("generateThreadTitle"),
  };
}

export function makeStandardAcpCliDriver<Settings extends StandardAcpCliSettings>(
  driverConfig: StandardAcpCliDriverConfig<Settings>,
): ProviderDriver<Settings, StandardAcpCliDriverEnv> {
  const maintenanceCapabilities = makeManualOnlyProviderMaintenanceCapabilities({
    provider: driverConfig.driverKind,
    packageName: null,
  });

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
      driver: driverConfig.driverKind,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.accentColor ? { accentColor: input.accentColor } : {}),
      continuation: { groupKey: input.continuationGroupKey },
    });

  return {
    driverKind: driverConfig.driverKind,
    metadata: { displayName: driverConfig.displayName, supportsMultipleInstances: true },
    configSchema: driverConfig.settingsSchema,
    defaultConfig: driverConfig.defaultSettings,
    create: ({ instanceId, displayName, accentColor, environment, enabled, config }) =>
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const processEnv = mergeProviderInstanceEnvironment(environment);
        const effectiveConfig = { ...config, enabled } satisfies Settings;
        const continuationIdentity = defaultProviderContinuationIdentity({
          driverKind: driverConfig.driverKind,
          instanceId,
        });
        const stampIdentity = withInstanceIdentity({
          instanceId,
          displayName,
          accentColor,
          continuationGroupKey: continuationIdentity.continuationKey,
        });
        const launchArgs = effectiveConfig.arguments
          ? parseStandardAcpCliArguments(effectiveConfig.arguments)
          : driverConfig.launchArgs;
        const providerConfig: StandardAcpCliProviderConfig = {
          provider: driverConfig.driverKind,
          displayName: driverConfig.displayName,
          command: effectiveConfig.binaryPath || driverConfig.defaultBinary,
          ...(launchArgs?.length ? { args: launchArgs } : {}),
          enabled: effectiveConfig.enabled,
          customModels: effectiveConfig.customModels,
          environment: processEnv,
          setupHint: driverConfig.setupHint,
          missingCommandMessage: driverConfig.missingCommandMessage,
          ...(driverConfig.excludedAuthMethodIds
            ? { excludedAuthMethodIds: driverConfig.excludedAuthMethodIds }
            : {}),
          ...(effectiveConfig.homePath?.trim()
            ? { homePath: effectiveConfig.homePath.trim() }
            : {}),
          ...(driverConfig.homeEnvVarName ? { homeEnvVarName: driverConfig.homeEnvVarName } : {}),
        };

        const eventLoggers = yield* ProviderEventLoggers;
        const adapter = yield* driverConfig.makeAdapter(effectiveConfig, {
          instanceId,
          environment: processEnv,
          ...(eventLoggers.native ? { nativeEventLogger: eventLoggers.native } : {}),
        });
        const checkProvider = checkStandardAcpCliProviderStatus(providerConfig).pipe(
          Effect.map(stampIdentity),
          Effect.provideService(Crypto.Crypto, crypto),
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        );
        const snapshot = yield* makeManagedServerProvider<StandardAcpCliProviderConfig>({
          maintenanceCapabilities,
          getSettings: Effect.succeed(providerConfig),
          streamSettings: Stream.never,
          haveSettingsChanged: () => false,
          initialSnapshot: (settings) =>
            buildInitialStandardAcpCliProviderSnapshot(settings).pipe(Effect.map(stampIdentity)),
          checkProvider,
          refreshInterval: SNAPSHOT_REFRESH_INTERVAL,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderDriverError({
                driver: driverConfig.driverKind,
                instanceId,
                detail: `Failed to build ${driverConfig.displayName} snapshot: ${cause.message ?? String(cause)}`,
                cause,
              }),
          ),
        );

        return {
          instanceId,
          driverKind: driverConfig.driverKind,
          continuationIdentity,
          displayName,
          accentColor,
          enabled,
          snapshot,
          adapter,
          textGeneration: makeUnsupportedTextGeneration(driverConfig.displayName),
        } satisfies ProviderInstance;
      }),
  };
}
