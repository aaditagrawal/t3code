import type { CustomModelSetting } from "@t3tools/contracts";
import type {
  ModelCapabilities,
  ProviderDriverKind,
  ServerProviderModel,
  ServerProviderSkill,
  ServerProviderSlashCommand,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  firstAdvertisedAuthMethod,
  makeStandardAcpCliRuntime,
  normalizeStandardAcpModel,
} from "../acp/StandardAcpCliSupport.ts";
import {
  collectSessionConfigOptionValues,
  type AcpAvailableCommand,
} from "../acp/AcpRuntimeModel.ts";
import type * as AcpSessionRuntime from "../acp/AcpSessionRuntime.ts";
import {
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
const COMMAND_DISCOVERY_TIMEOUT_MS = 1_500;
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });

export interface StandardAcpCliProviderConfig {
  readonly provider: ProviderDriverKind;
  readonly displayName: string;
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly enabled: boolean;
  readonly customModels: ReadonlyArray<CustomModelSetting>;
  readonly environment: NodeJS.ProcessEnv;
  readonly setupHint: string;
  readonly missingCommandMessage: string;
  readonly excludedAuthMethodIds?: ReadonlySet<string>;
  readonly resolveAuthMethodId?: (
    initializeResult: EffectAcpSchema.InitializeResponse,
  ) => string | undefined;
  readonly unauthenticatedWhenNoDiscoveredModels?: boolean;
  readonly discoverSkills?: Effect.Effect<
    ReadonlyArray<ServerProviderSkill>,
    never,
    FileSystem.FileSystem | Path.Path
  >;
}

export interface StandardAcpCliProviderCheckOptions {
  readonly prepareArgs?: Effect.Effect<
    ReadonlyArray<string>,
    PlatformError.PlatformError,
    FileSystem.FileSystem | Scope.Scope
  >;
}

function modelsFromSessionState(
  state: EffectAcpSchema.SessionModelState | null | undefined,
  provider: ProviderDriverKind,
): ReadonlyArray<ServerProviderModel> {
  if (!state) return [];
  const seen = new Set<string>();
  return state.availableModels.flatMap((model) => {
    const slug = normalizeStandardAcpModel(model.modelId, provider);
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    return [
      {
        slug,
        name: model.name.trim() || slug,
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      } satisfies ServerProviderModel,
    ];
  });
}

function modelsFromConfigOptions(
  options: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  provider: ProviderDriverKind,
): ReadonlyArray<ServerProviderModel> {
  const modelOption = options?.find(
    (option) => option.category === "model" || option.id.trim() === "model",
  );
  if (!modelOption || modelOption.type !== "select") return [];
  return collectSessionConfigOptionValues(modelOption).flatMap((modelId) => {
    const slug = normalizeStandardAcpModel(modelId, provider);
    return slug ? [{ slug, name: slug, isCustom: false, capabilities: EMPTY_CAPABILITIES }] : [];
  });
}

function slashCommandsFromAcpCommands(
  commands: ReadonlyArray<AcpAvailableCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const seen = new Set<string>();
  const result: Array<ServerProviderSlashCommand> = [];
  for (const command of commands) {
    const name = command.name.trim().replace(/^\//, "");
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push({
      name,
      ...(command.description ? { description: command.description } : {}),
      ...(command.inputHint ? { input: { hint: command.inputHint } } : {}),
    });
  }
  return result;
}

const waitForAvailableCommands = (
  runtime: Pick<AcpSessionRuntime.AcpSessionRuntime["Service"], "awaitAvailableCommands">,
) => runtime.awaitAvailableCommands.pipe(Effect.timeoutOption(COMMAND_DISCOVERY_TIMEOUT_MS));

function agentVersionFromInitialize(result: EffectAcpSchema.InitializeResponse): string | null {
  return result.agentInfo?.version?.trim() || null;
}

function hasMissingCommandCause(cause: unknown, seen = new WeakSet<object>()): boolean {
  if (!cause || typeof cause !== "object" || seen.has(cause)) return false;
  seen.add(cause);
  if (Array.isArray(cause)) {
    return cause.some((entry) => hasMissingCommandCause(entry, seen));
  }
  const record = cause as Record<string, unknown>;
  if (record._tag === "AcpSpawnError") {
    return hasNotFoundCause(record.cause);
  }
  return Object.values(record).some((entry) => hasMissingCommandCause(entry, seen));
}

function hasNotFoundCause(cause: unknown, seen = new WeakSet<object>()): boolean {
  if (!cause || typeof cause !== "object" || seen.has(cause)) return false;
  seen.add(cause);
  if (Array.isArray(cause)) {
    return cause.some((entry) => hasNotFoundCause(entry, seen));
  }
  const record = cause as Record<string, unknown>;
  if (record.code === "ENOENT") return true;
  if (record._tag === "PlatformError") {
    const reason = record.reason;
    if (
      reason &&
      typeof reason === "object" &&
      (reason as Record<string, unknown>)._tag === "NotFound"
    ) {
      return true;
    }
  }
  return Object.values(record).some((entry) => hasNotFoundCause(entry, seen));
}

export function buildInitialStandardAcpCliProviderSnapshot(
  config: StandardAcpCliProviderConfig,
): Effect.Effect<ServerProviderDraft> {
  return Effect.map(DateTime.now, (now) =>
    buildServerProvider({
      presentation: {
        displayName: config.displayName,
        badgeLabel: "Early Access",
        showInteractionModeToggle: true,
        requiresNewThreadForModelChange: false,
      },
      enabled: config.enabled,
      checkedAt: DateTime.formatIso(now),
      models: providerModelsFromSettings([], config.customModels, EMPTY_CAPABILITIES),
      probe: config.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: `Checking ${config.displayName} ACP availability...`,
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: `${config.displayName} is disabled in T3 Code settings.`,
          },
    }),
  );
}

export const checkStandardAcpCliProviderStatus = Effect.fn("checkStandardAcpCliProviderStatus")(
  function* (
    config: StandardAcpCliProviderConfig,
    options?: StandardAcpCliProviderCheckOptions,
  ): Effect.fn.Return<
    ServerProviderDraft,
    never,
    ChildProcessSpawner.ChildProcessSpawner | Crypto.Crypto | FileSystem.FileSystem | Path.Path
  > {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const fallbackModels = providerModelsFromSettings([], config.customModels, EMPTY_CAPABILITIES);
    const presentation = {
      displayName: config.displayName,
      badgeLabel: "Early Access",
      showInteractionModeToggle: true,
      requiresNewThreadForModelChange: false,
    } as const;

    if (!config.enabled) {
      return buildServerProvider({
        presentation,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: `${config.displayName} is disabled in T3 Code settings.`,
        },
      });
    }

    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const discovery = yield* Effect.gen(function* () {
      const args = options?.prepareArgs ? yield* options.prepareArgs : config.args;
      const runtime = yield* makeStandardAcpCliRuntime({
        childProcessSpawner,
        command: config.command,
        ...(args ? { args } : {}),
        cwd: process.cwd(),
        environment: config.environment,
        clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
        ...(config.resolveAuthMethodId
          ? { resolveAuthMethodId: config.resolveAuthMethodId }
          : config.excludedAuthMethodIds
            ? {
                resolveAuthMethodId: (initializeResult) =>
                  firstAdvertisedAuthMethod(initializeResult, config.excludedAuthMethodIds),
              }
            : {}),
      });
      const started = yield* runtime.start();
      const models = modelsFromSessionState(started.sessionSetupResult.models, config.provider);
      const resolvedModels =
        models.length > 0
          ? models
          : modelsFromConfigOptions(started.sessionSetupResult.configOptions, config.provider);
      const commands = yield* waitForAvailableCommands(runtime).pipe(
        Effect.map(Option.getOrElse((): ReadonlyArray<AcpAvailableCommand> => [])),
      );
      return {
        models: resolvedModels,
        commands,
        version: agentVersionFromInitialize(started.initializeResult),
      };
    }).pipe(Effect.scoped, Effect.timeoutOption(MODEL_DISCOVERY_TIMEOUT_MS), Effect.exit);

    if (Exit.isSuccess(discovery) && Option.isSome(discovery.value)) {
      const discovered = discovery.value.value;
      const discoveredModels = discovered.models;
      const skills = yield* (config.discoverSkills ?? Effect.succeed([])).pipe(
        Effect.catchCause(() => Effect.succeed<ReadonlyArray<ServerProviderSkill>>([])),
      );
      const unauthenticated =
        config.unauthenticatedWhenNoDiscoveredModels === true && discoveredModels.length === 0;
      return buildServerProvider({
        presentation,
        enabled: true,
        checkedAt,
        models:
          discoveredModels.length > 0
            ? providerModelsFromSettings(discoveredModels, config.customModels, EMPTY_CAPABILITIES)
            : fallbackModels,
        skills,
        slashCommands: slashCommandsFromAcpCommands(discovered.commands),
        probe: unauthenticated
          ? {
              installed: true,
              version: discovered.version,
              status: "error",
              auth: { status: "unauthenticated" },
              message: config.setupHint,
            }
          : {
              installed: true,
              version: discovered.version,
              status: "ready",
              auth: { status: "unknown" },
            },
      });
    }

    const missing = Exit.isFailure(discovery) && hasMissingCommandCause(discovery.cause);
    return buildServerProvider({
      presentation,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !missing,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: missing
          ? config.missingCommandMessage
          : `${config.displayName} ACP startup failed or timed out. ${config.setupHint}`,
      },
    });
  },
);

/** Exposed for focused provider-discovery and error-classification tests. */
export const __testing = {
  hasMissingCommandCause,
  agentVersionFromInitialize,
  modelsFromConfigOptions,
  slashCommandsFromAcpCommands,
  waitForAvailableCommands,
};
