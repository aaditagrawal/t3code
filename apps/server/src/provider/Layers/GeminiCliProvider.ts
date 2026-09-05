// @effect-diagnostics globalDate:off globalDateInEffect:off - Provider snapshot DTOs use ISO timestamps.
/**
 * GeminiCliProvider — snapshot probe for the Gemini CLI provider.
 *
 * Mirrors `ClaudeProvider` / `OpenCodeProvider`: exposes
 * `checkGeminiCliStatus(config, env)` which spawns `gemini --version` and
 * returns a `ServerProviderDraft`, plus `makePendingGeminiCliProvider(config)`
 * which returns the placeholder shape used before the first probe completes.
 *
 * Drivers stamp `instanceId` / `driver` / `displayName` onto the draft via
 * `withInstanceIdentity` in `GeminiCliDriver`.
 *
 * @module provider/Layers/GeminiCliProvider
 */
import {
  type GenericProviderSettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { createModelCapabilities } from "@t3tools/shared/model";

import {
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const GEMINI_PRESENTATION = {
  displayName: "Gemini CLI",
  showInteractionModeToggle: true,
} as const;

/**
 * Capabilities for known Gemini models.
 *
 * A `thinkingBudget` selector used to live here, but it was inert: the chosen
 * value was never read by the adapter and never reached the Gemini CLI (which
 * exposes no per-invocation thinking flag), so it rendered a control that did
 * nothing. It has been removed rather than ship a misleading trait. Reinstate
 * it only together with real wiring (e.g. a per-turn settings.json
 * `thinkingConfig` override) verified against an actual Gemini CLI.
 */
const DEFAULT_GEMINI_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
  {
    slug: "gemini-3-flash",
    name: "Gemini 3 Flash",
    isCustom: false,
    capabilities: DEFAULT_GEMINI_MODEL_CAPABILITIES,
  },
];

/** Resolve the configured binary path, or fall back to `"gemini"`. */
function resolveBinary(config: GenericProviderSettings): string {
  const trimmed = config.binaryPath.trim();
  return trimmed.length > 0 ? trimmed : "gemini";
}

const runGeminiCommand = Effect.fn("runGeminiCommand")(function* (
  config: GenericProviderSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binaryPath = resolveBinary(config);
  const command = ChildProcess.make(binaryPath, [...args], {
    env: environment,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Provider snapshot probes are pure process spawns outside the Effect runtime service graph.
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(binaryPath, command);
});

export const checkGeminiCliStatus = Effect.fn("checkGeminiCliStatus")(function* (
  config: GenericProviderSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = new Date().toISOString();
  const allModels = providerModelsFromSettings(
    BUILT_IN_MODELS,
    config.customModels,
    DEFAULT_GEMINI_MODEL_CAPABILITIES,
  );

  if (!config.enabled) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Gemini CLI is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runGeminiCommand(config, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: config.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Gemini CLI (`gemini`) is not installed or not on PATH."
          : `Failed to execute Gemini CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: config.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Gemini CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: config.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Gemini CLI is installed but failed to run. ${detail}`
          : "Gemini CLI is installed but failed to run.",
      },
    });
  }

  return buildServerProvider({
    presentation: GEMINI_PRESENTATION,
    enabled: config.enabled,
    checkedAt,
    models: allModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status: "authenticated",
        type: "geminiCli",
        label: "Gemini CLI",
      },
    },
  });
});

export const makePendingGeminiCliProvider = (
  config: GenericProviderSettings,
): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    config.customModels,
    DEFAULT_GEMINI_MODEL_CAPABILITIES,
  );

  if (!config.enabled) {
    return buildServerProvider({
      presentation: GEMINI_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Gemini CLI is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: GEMINI_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Gemini CLI provider status has not been checked in this session yet.",
    },
  });
};

export { BUILT_IN_MODELS as GEMINI_BUILT_IN_MODELS, DEFAULT_GEMINI_MODEL_CAPABILITIES };
