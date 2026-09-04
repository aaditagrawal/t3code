// @effect-diagnostics globalDate:off globalDateInEffect:off - Provider snapshot DTOs use ISO timestamps.
/**
 * KiloProvider — snapshot probe for the Kilo Code provider.
 *
 * Kilo is a fork of OpenCode and exposes the same HTTP+SSE API. The probe
 * is per-instance: it uses the per-driver `KiloSettings` (currently
 * `GenericProviderSettings`) to resolve `binaryPath`, then runs
 * `kilo --version` to confirm the binary is installed. Authentication is
 * not validated here — the Kilo server handles that lazily on first
 * session. Custom models are surfaced via `customModels`.
 *
 * Two helpers are exported:
 *   - `checkKiloProviderStatus`   — full probe used by the driver's
 *     `makeManagedServerProvider` refresh.
 *   - `makePendingKiloProvider`   — synchronous "checking…" snapshot that
 *     `makeManagedServerProvider` publishes as the initial value.
 *
 * @module provider/Layers/KiloProvider
 */
import {
  ProviderDriverKind,
  type GenericProviderSettings,
  type ModelCapabilities,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
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
import { fetchKiloModels, type KiloDiscoveredModel } from "../../kiloServerManager.ts";

const PROVIDER = ProviderDriverKind.make("kilo");
const KILO_PRESENTATION = {
  displayName: "Kilo Code",
  showInteractionModeToggle: true,
} as const;

const DEFAULT_KILO_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export type KiloSettings = GenericProviderSettings;

class KiloModelDiscoveryError extends Data.TaggedError("KiloModelDiscoveryError")<{
  readonly message: string;
}> {}

/**
 * Map Kilo's discovered models into the contract `ServerProviderModel` shape
 * the snapshot consumes. Mirrors OpenCode's `flattenOpenCodeModels`: discovered
 * models are `isCustom: false` and carry the default capabilities so the trait
 * picker still renders. The `connected` flag is informational — Kilo lists all
 * configured providers, so we surface every discovered model (the user can pick
 * one before its upstream provider connects).
 */
export function kiloDiscoveredToServerModels(
  discovered: ReadonlyArray<KiloDiscoveredModel>,
): ReadonlyArray<ServerProviderModel> {
  return discovered.map((model) => ({
    slug: model.slug,
    name: model.name,
    isCustom: false,
    capabilities: DEFAULT_KILO_MODEL_CAPABILITIES,
  }));
}

/**
 * Best-effort dynamic model discovery. `fetchKiloModels` spins up and tears
 * down its own throwaway `KiloServerManager` to query the live Kilo server.
 * Any failure — Kilo not installed, server unreachable, SDK error, or timeout —
 * degrades to an empty list so the snapshot still publishes with just the
 * custom models (the pre-wire-up behavior). Bounded by `DEFAULT_TIMEOUT_MS`.
 */
const discoverKiloModels = (
  kiloSettings: KiloSettings,
): Effect.Effect<ReadonlyArray<KiloDiscoveredModel>> =>
  Effect.tryPromise({
    try: () => {
      const binaryPath = kiloSettings.binaryPath.trim();
      return fetchKiloModels(binaryPath ? { binaryPath } : {});
    },
    catch: (cause) =>
      new KiloModelDiscoveryError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  }).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
    Effect.map((result): ReadonlyArray<KiloDiscoveredModel> =>
      Result.isSuccess(result) && Option.isSome(result.success) ? result.success.value : [],
    ),
  );

const runKiloCommand = Effect.fn("runKiloCommand")(function* (
  kiloSettings: KiloSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const binaryPath = kiloSettings.binaryPath.trim() || "kilo";
  const command = ChildProcess.make(binaryPath, [...args], {
    env: environment,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Provider snapshot probes are pure process spawns outside the Effect runtime service graph.
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(binaryPath, command);
});

export const checkKiloProviderStatus = Effect.fn("checkKiloProviderStatus")(function* (
  kiloSettings: KiloSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<
  ServerProviderDraft,
  never,
  ChildProcessSpawner.ChildProcessSpawner | Path.Path
> {
  const checkedAt = new Date().toISOString();
  const allModels = providerModelsFromSettings(
    [],
    kiloSettings.customModels,
    DEFAULT_KILO_MODEL_CAPABILITIES,
  );

  if (!kiloSettings.enabled) {
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: false,
      checkedAt,
      models: allModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kilo is disabled in T3 Code settings.",
      },
    });
  }

  const versionProbe = yield* runKiloCommand(kiloSettings, ["--version"], environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: kiloSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "Kilo CLI (`kilo`) is not installed or not on PATH."
          : `Failed to execute Kilo CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: kiloSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "Kilo CLI is installed but failed to run. Timed out while running command.",
      },
    });
  }

  const version = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${version.stdout}\n${version.stderr}`);
  if (version.code !== 0) {
    const detail = detailFromResult(version);
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: kiloSettings.enabled,
      checkedAt,
      models: allModels,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `Kilo CLI is installed but failed to run. ${detail}`
          : "Kilo CLI is installed but failed to run.",
      },
    });
  }

  // The CLI is healthy — query the live Kilo server for its configured models
  // and merge them (deduped by slug) with any user-supplied custom slugs.
  const discovered = yield* discoverKiloModels(kiloSettings);
  const readyModels = providerModelsFromSettings(
    kiloDiscoveredToServerModels(discovered),
    kiloSettings.customModels,
    DEFAULT_KILO_MODEL_CAPABILITIES,
  );

  return buildServerProvider({
    presentation: KILO_PRESENTATION,
    enabled: true,
    checkedAt,
    models: readyModels,
    probe: {
      installed: true,
      version: parsedVersion,
      status: "ready",
      auth: {
        status: "authenticated",
        type: "kilo",
      },
      message: parsedVersion ? `Kilo v${parsedVersion} detected.` : "Kilo CLI detected.",
    },
  });
});

export const makePendingKiloProvider = (kiloSettings: KiloSettings): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    [],
    kiloSettings.customModels,
    DEFAULT_KILO_MODEL_CAPABILITIES,
  );

  if (!kiloSettings.enabled) {
    return buildServerProvider({
      presentation: KILO_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Kilo is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: KILO_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Kilo provider status has not been checked in this session yet.",
    },
  });
};
