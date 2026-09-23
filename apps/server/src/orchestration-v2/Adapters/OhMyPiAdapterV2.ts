import {
  OhMyPiSettings,
  ProviderDriverKind,
  type ProviderInstanceEnvironment,
  type ProviderUsageLimitsUpdate,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpErrors from "effect-acp/errors";

import { ServerConfig } from "../../config.ts";
import { makeAcpNativeLoggerFactory } from "../../provider/acp/AcpNativeLogging.ts";
import {
  currentStandardAcpConfigOptionModelFromSetup,
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
} from "../../provider/acp/StandardAcpCliSupport.ts";
import * as AcpSessionRuntime from "../../provider/acp/AcpSessionRuntime.ts";
import {
  applyOhMyPiAcpSelection,
  currentOhMyPiOptionsFromSetup,
  ohMyPiLaunchCommand,
  requestedOhMyPiOptionsFromSelection,
  resolveOhMyPiAuthMethodId,
} from "../../provider/Layers/OhMyPiAdapter.ts";
import { ProviderEventLoggers } from "../../provider/Layers/ProviderEventLoggers.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";
import { IdAllocatorV2 } from "../IdAllocator.ts";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "../ProviderAdapterDriver.ts";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "./AcpAdapterV2.ts";

export const OH_MY_PI_PROVIDER = ProviderDriverKind.make("ohMyPi");
const OH_MY_PI_DRIVER_KIND = OH_MY_PI_PROVIDER;
const DEFAULT_OH_MY_PI_SETTINGS = Schema.decodeSync(OhMyPiSettings)({});

/**
 * Oh My Pi stays on the shared ACP capability set. Model switching is negotiated
 * from the session's model config option; thinking and plan mode are applied
 * by this flavor rather than as extra capability flags.
 */
const OhMyPiProviderCapabilitiesV2 = AcpProviderCapabilitiesV2;

const OH_MY_PI_OWNED_CONFIG_OPTION_IDS = ["thinking", "reasoning", "reasoningEffort"] as const;

export interface OhMyPiAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: OhMyPiSettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly crypto: Crypto.Crypto;
  readonly selfInvocation: SelfInvocation;
  readonly fileSystem: FileSystem.FileSystem;
  readonly idAllocator: IdAllocatorV2["Service"];
  readonly serverConfig: ServerConfig["Service"];
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly onUsageLimits?: (
    update: ProviderUsageLimitsUpdate & { readonly checkedAt: string },
  ) => Effect.Effect<void>;
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    Crypto.Crypto | Scope.Scope
  >;
}

function requestedOhMyPiModelId(model: string): string | undefined {
  const requested = normalizeStandardAcpModel(model, OH_MY_PI_PROVIDER);
  if (requested.length === 0 || requested === "auto" || requested === "default") {
    return undefined;
  }
  return requested;
}

export function makeOhMyPiAcpAdapterFlavor(options: OhMyPiAdapterV2Options): AcpAdapterV2Flavor {
  const launch = ohMyPiLaunchCommand(options.settings);
  return {
    driver: OH_MY_PI_PROVIDER,
    runtimeHarness: "OhMyPi",
    capabilities: OhMyPiProviderCapabilitiesV2,
    // Thinking aliases and plan mode are applied by the flavor. The shared
    // configurator must not also write the raw boolean or alias option.
    ownedConfigOptionIds: OH_MY_PI_OWNED_CONFIG_OPTION_IDS,
    standardFormElicitation: true,
    rememberSessionApprovals: true,
    applyModelSelection: ({ runtime, startResult, modelSelection }) =>
      applyOhMyPiAcpSelection({
        runtime,
        currentModelId: currentStandardAcpConfigOptionModelFromSetup(
          startResult.sessionSetupResult,
        ),
        requestedModelId: requestedOhMyPiModelId(modelSelection.model),
        currentModelOptions: currentOhMyPiOptionsFromSetup(startResult.sessionSetupResult),
        requestedModelOptions: requestedOhMyPiOptionsFromSelection(modelSelection),
        mapError: (cause) => cause,
      }),
    makeRuntime:
      options.makeRuntime ??
      ((input) => {
        const { processEnvironment, ...runtimeInput } = input;
        return makeStandardAcpCliRuntime({
          ...runtimeInput,
          command: launch.command,
          args: launch.args,
          environment: {
            ...options.environment,
            ...processEnvironment,
          },
          childProcessSpawner: options.childProcessSpawner,
          resolveAuthMethodId: resolveOhMyPiAuthMethodId,
        });
      }),
  };
}

export function makeOhMyPiAdapterV2(options: OhMyPiAdapterV2Options) {
  return makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor: makeOhMyPiAcpAdapterFlavor(options),
    crypto: options.crypto,
    fileSystem: options.fileSystem,
    idAllocator: options.idAllocator,
    serverConfig: options.serverConfig,
    selfInvocation: options.selfInvocation,
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
    ...(options.onUsageLimits === undefined ? {} : { onUsageLimits: options.onUsageLimits }),
  });
}

export interface CreateOhMyPiAdapterV2Input {
  readonly instanceId: OhMyPiAdapterV2Options["instanceId"];
  readonly settings: OhMyPiSettings;
  readonly environment: ProviderInstanceEnvironment;
  readonly onUsageLimits?: OhMyPiAdapterV2Options["onUsageLimits"];
}

export const createOhMyPiAdapterV2 = Effect.fn("createOhMyPiAdapterV2")(function* (
  input: CreateOhMyPiAdapterV2Input,
) {
  const hostEnvironment = yield* HostProcessEnvironment;
  const selfInvocation = yield* resolveSelfInvocation();
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const idAllocator = yield* IdAllocatorV2;
  const providerEventLoggers = yield* ProviderEventLoggers;
  const serverConfig = yield* ServerConfig;
  const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
  return makeOhMyPiAdapterV2({
    instanceId: input.instanceId,
    settings: input.settings,
    environment: mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
    childProcessSpawner,
    crypto,
    fileSystem,
    idAllocator,
    serverConfig,
    selfInvocation,
    ...(input.onUsageLimits === undefined ? {} : { onUsageLimits: input.onUsageLimits }),
    nativeLogging: (threadId) =>
      makeNativeLogger({
        nativeEventLogger: providerEventLoggers.native,
        provider: OH_MY_PI_PROVIDER,
        threadId,
      }),
  });
});

export type OhMyPiAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | Crypto.Crypto
  | FileSystem.FileSystem
  | IdAllocatorV2
  | Path.Path
  | ProviderEventLoggers
  | ServerConfig;

export const OhMyPiAdapterV2Driver: ProviderAdapterDriver<
  OhMyPiSettings,
  OhMyPiAdapterV2DriverEnv
> = {
  driverKind: OH_MY_PI_DRIVER_KIND,
  configSchema: OhMyPiSettings,
  defaultConfig: (): OhMyPiSettings => DEFAULT_OH_MY_PI_SETTINGS,
  create: Effect.fn("OhMyPiAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<OhMyPiSettings>) {
      return yield* createOhMyPiAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: input.environment,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: OH_MY_PI_DRIVER_KIND,
              instanceId: input.instanceId,
              detail: "Failed to create Oh My Pi ACP adapter.",
              cause,
            }),
        ),
      ),
  ),
};
