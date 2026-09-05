/**
 * PrimeAgentProvider — snapshot probe for the Prime Agent provider.
 *
 * The probe is intentionally minimal because Prime Agent's ACP mode exposes no
 * model catalogue and no auth handshake:
 *
 *  - **Installation** is confirmed by running `prime-agent --version`, which
 *    prints a bare semver line (`0.7.0`). A missing binary is distinguished
 *    from an installed-but-broken one via `isCommandMissingCause`.
 *  - **Auth** is never probed. Prime Agent resolves credentials lazily from
 *    env vars, `~/.prime/agent/auth.json`, or an OAuth subscription, and
 *    implements no ACP `authenticate` method, so there is nothing to check
 *    before the first session.
 *  - **Models** come from user-supplied `customModels` only. ACP mode neither
 *    lists models nor supports switching them, so the slug is passed straight
 *    through to `prime-agent --model` at spawn time.
 *
 * Two helpers are exported:
 *   - `checkPrimeAgentProviderStatus`   — full probe used by the driver's
 *     `makeManagedServerProvider` refresh.
 *   - `buildInitialPrimeAgentProviderSnapshot` — the "checking…" snapshot
 *     published before the first probe resolves.
 *
 * @module provider/Layers/PrimeAgentProvider
 */
import {
  type CustomModelSetting,
  type ModelCapabilities,
  type PrimeAgentSettings,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { createModelCapabilities } from "@t3tools/shared/model";
import { resolveSpawnCommand } from "@t3tools/shared/shell";

import {
  buildServerProvider,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  spawnAndCollect,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";

const PRIME_AGENT_PRESENTATION = {
  displayName: "Prime Agent",
  badgeLabel: "Early Access",
  showInteractionModeToggle: false,
  // The model is a spawn argument, so changing it needs a fresh session.
  requiresNewThreadForModelChange: true,
} as const;

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

const VERSION_PROBE_TIMEOUT_MS = 4_000;
const DEFAULT_BINARY = "prime-agent";

/**
 * Prime Agent ships no fixed model catalogue: the CLI resolves slugs against
 * whichever providers the user has credentials for. Everything the UI offers
 * therefore comes from `customModels`.
 */
function primeAgentModelsFromSettings(
  customModels: ReadonlyArray<CustomModelSetting> | undefined,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings([], customModels ?? [], EMPTY_CAPABILITIES);
}

export function buildInitialPrimeAgentProviderSnapshot(
  primeAgentSettings: PrimeAgentSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = primeAgentModelsFromSettings(primeAgentSettings.customModels);

    if (!primeAgentSettings.enabled) {
      return buildServerProvider({
        presentation: PRIME_AGENT_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Prime Agent is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: PRIME_AGENT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Prime Agent CLI availability...",
      },
    });
  });
}

const runPrimeAgentVersionCommand = (
  primeAgentSettings: PrimeAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const command = primeAgentSettings.binaryPath?.trim() || DEFAULT_BINARY;
    const spawnCommand = yield* resolveSpawnCommand(command, ["--version"], {
      env: environment,
    });
    return yield* spawnAndCollect(
      command,
      ChildProcess.make(spawnCommand.command, spawnCommand.args, {
        env: environment,
        shell: spawnCommand.shell,
      }),
    );
  });

export const checkPrimeAgentProviderStatus = Effect.fn("checkPrimeAgentProviderStatus")(function* (
  primeAgentSettings: PrimeAgentSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const models = primeAgentModelsFromSettings(primeAgentSettings.customModels);

  if (!primeAgentSettings.enabled) {
    return buildServerProvider({
      presentation: PRIME_AGENT_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Prime Agent is disabled in T3 Code settings.",
      },
    });
  }

  const versionResult = yield* runPrimeAgentVersionCommand(primeAgentSettings, environment).pipe(
    Effect.timeoutOption(VERSION_PROBE_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionResult)) {
    const error = versionResult.failure;
    const missing = isCommandMissingCause(error);
    yield* Effect.logWarning("Prime Agent CLI health check failed.", {
      errorTag: error._tag,
    });
    return buildServerProvider({
      presentation: PRIME_AGENT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: !missing,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: missing
          ? "Prime Agent CLI (`prime-agent`) is not installed or not on PATH."
          : "Failed to execute Prime Agent CLI health check.",
      },
    });
  }

  if (Option.isNone(versionResult.success)) {
    return buildServerProvider({
      presentation: PRIME_AGENT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message:
          "Prime Agent CLI is installed but timed out while running `prime-agent --version`.",
      },
    });
  }

  const versionOutput = versionResult.success.value;
  // `prime-agent --version` prints a bare semver line, e.g. `0.7.0`.
  const version = parseGenericCliVersion(`${versionOutput.stdout}\n${versionOutput.stderr}`);
  if (versionOutput.code !== 0) {
    yield* Effect.logWarning("Prime Agent CLI version probe exited with a non-zero status.", {
      exitCode: versionOutput.code,
      stdoutLength: versionOutput.stdout.length,
      stderrLength: versionOutput.stderr.length,
    });
    return buildServerProvider({
      presentation: PRIME_AGENT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version,
        status: "error",
        auth: { status: "unknown" },
        message: "Prime Agent CLI is installed but failed to run.",
      },
    });
  }

  return buildServerProvider({
    presentation: PRIME_AGENT_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version,
      status: "ready",
      auth: { status: "unknown" },
      message: version ? `Prime Agent v${version} detected.` : "Prime Agent CLI detected.",
    },
  });
});

export const enrichPrimeAgentSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  readonly httpClient: HttpClient.HttpClient;
}): Effect.Effect<void> => {
  const { snapshot, publishSnapshot } = input;

  return enrichProviderSnapshotWithVersionAdvisory(snapshot, input.maintenanceCapabilities, {
    enableProviderUpdateChecks: input.enableProviderUpdateChecks,
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, input.httpClient),
    Effect.flatMap((enrichedSnapshot) => publishSnapshot(enrichedSnapshot)),
    Effect.catchCause((cause) =>
      Effect.logWarning("Prime Agent version advisory enrichment failed", {
        errorTag: causeErrorTag(cause),
      }),
    ),
    Effect.asVoid,
  );
};
