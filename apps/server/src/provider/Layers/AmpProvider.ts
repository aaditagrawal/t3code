// @effect-diagnostics globalDate:off globalDateInEffect:off - Provider snapshot DTOs use ISO timestamps.
/**
 * AmpProvider — snapshot probe for the Amp CLI provider.
 *
 * Mirrors the Claude / Cursor / OpenCode provider modules: exposes a
 * `checkAmpStatus` effect that runs `amp --version` to detect the binary
 * and a `makePendingAmpProvider` initial-snapshot helper for the loading
 * state surfaced before the first probe completes.
 *
 * @module AmpProvider
 */
import {
  ProviderDriverKind,
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
  buildSelectOptionDescriptor,
  buildServerProvider,
  DEFAULT_TIMEOUT_MS,
  detailFromResult,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";

const PROVIDER = ProviderDriverKind.make("amp");
const AMP_PRESENTATION = {
  displayName: "Amp",
  showInteractionModeToggle: true,
} as const;

const DEFAULT_AMP_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const AMP_MODE_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    buildSelectOptionDescriptor({
      id: "mode",
      label: "Mode",
      options: [
        { value: "smart", label: "Smart", isDefault: true },
        { value: "rush", label: "Rush" },
        { value: "deep", label: "Deep" },
        { value: "free", label: "Free" },
      ],
    }),
  ],
});

const BUILT_IN_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "smart",
    name: "Amp Smart",
    isCustom: false,
    capabilities: AMP_MODE_CAPABILITIES,
  },
];

function defaultBinaryPath(settings: GenericProviderSettings): string {
  const trimmed = settings.binaryPath.trim();
  return trimmed.length > 0 ? trimmed : "amp";
}

const runAmpCommand = Effect.fn("runAmpCommand")(function* (
  ampSettings: GenericProviderSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binaryPath = defaultBinaryPath(ampSettings);
  const command = ChildProcess.make(binaryPath, [...args], {
    env: environment,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Provider snapshot probes are pure process spawns outside the Effect runtime service graph.
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(binaryPath, command);
});

export const checkAmpStatus = Effect.fn("checkAmpStatus")(function* (
  ampSettings: GenericProviderSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = new Date().toISOString();
  const allModels = providerModelsFromSettings(
    BUILT_IN_MODELS,
    ampSettings.customModels,
    DEFAULT_AMP_MODEL_CAPABILITIES,
  );

  if (!ampSettings.enabled) {
    return buildServerProvider({
      presentation: AMP_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Amp is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runAmpCommand(ampSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: AMP_PRESENTATION,
      enabled: ampSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Amp CLI (`amp`) is not installed or not on PATH."
          : `Failed to execute Amp CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: AMP_PRESENTATION,
      enabled: ampSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Amp CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: AMP_PRESENTATION,
      enabled: ampSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Amp CLI is installed but failed to run. ${detail}`
          : "Amp CLI is installed but failed to run.",
      },
    });
  }

  return buildServerProvider({
    presentation: AMP_PRESENTATION,
    enabled: ampSettings.enabled,
    checkedAt,
    models: allModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: { status: "unknown" },
    },
  });
});

export const makePendingAmpProvider = (
  ampSettings: GenericProviderSettings,
): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    BUILT_IN_MODELS,
    ampSettings.customModels,
    DEFAULT_AMP_MODEL_CAPABILITIES,
  );

  if (!ampSettings.enabled) {
    return buildServerProvider({
      presentation: AMP_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Amp is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: AMP_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Amp provider status has not been checked in this session yet.",
    },
  });
};
