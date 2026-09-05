// @effect-diagnostics globalDate:off globalDateInEffect:off - Provider snapshot DTOs use ISO timestamps.
/**
 * CopilotProvider — snapshot probe for the GitHub Copilot driver.
 *
 * Mirrors the shape of `ClaudeProvider` / `OpenCodeProvider`: exports a
 * `checkCopilotProviderStatus` Effect that probes the resolved binary
 * (version) and best-effort auth state via the Copilot SDK, plus a
 * `makePendingCopilotProvider` snapshot used until the first probe lands.
 *
 * The probe purposefully tolerates failure — Copilot is often optional and
 * a missing CLI / unauthenticated SDK should still produce a valid (but
 * not-ready) snapshot rather than tear the driver down.
 */
import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
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
import {
  resolveBundledCopilotCliPath,
  resolveCopilotSdkCliPath,
  withSanitizedCopilotDesktopEnv,
} from "./copilotCliPath.ts";
import type { CopilotSettings } from "../Drivers/CopilotSettings.ts";

const PROVIDER = ProviderDriverKind.make("copilot");

const COPILOT_PRESENTATION = {
  displayName: "GitHub Copilot",
  showInteractionModeToggle: true,
} as const;

/**
 * GitHub Copilot exposes a per-model reasoning effort (low/medium/high/xhigh).
 * The adapter already reads, validates (against the live model's
 * `supportedReasoningEfforts`) and forwards a selected effort end-to-end; the
 * only missing link was this descriptor, without which the trait never
 * rendered. The descriptor is intentionally opt-in — no `isDefault` /
 * `currentValue` — because these capabilities are global (stamped onto every
 * Copilot model) while effort support is decided per-model at session start.
 * Forcing a default would auto-dispatch it and get rejected by
 * `validateSessionConfiguration` on any model that does not list that effort.
 * Leaving it unset keeps the selection `undefined` until the user picks one,
 * which the adapter treats as "no effort" (its prior behavior).
 */
const DEFAULT_COPILOT_MODEL_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select" as const,
      options: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
    },
  ],
});

/**
 * Resolve the binary path the runtime would actually invoke for the given
 * settings. An explicit `binaryPath` always wins; otherwise we fall back
 * to the bundled CLI (Electron desktop builds ship one per platform).
 */
function resolveCopilotBinaryPath(settings: CopilotSettings): string | undefined {
  const explicit = settings.binaryPath.trim();
  if (explicit.length > 0) {
    return explicit;
  }
  return resolveBundledCopilotCliPath();
}

const runCopilotVersionCommand = Effect.fn("runCopilotVersionCommand")(function* (
  binaryPath: string,
  environment: NodeJS.ProcessEnv,
) {
  const command = ChildProcess.make(binaryPath, ["--version"], {
    env: environment,
    // oxlint-disable-next-line t3code/no-global-process-runtime -- Provider snapshot probes are pure process spawns outside the Effect runtime service graph.
    shell: process.platform === "win32",
  });
  return yield* spawnAndCollect(binaryPath, command);
});

interface CopilotAuthProbeResult {
  readonly authenticated: boolean;
  readonly login?: string;
  readonly detail?: string;
}

/**
 * Best-effort SDK probe: starts a transient `CopilotClient` against the
 * resolved binary just long enough to enumerate models. A non-empty model
 * list implies an authenticated GitHub account; failure (any kind) is
 * folded back into "unknown auth" without surfacing as a driver error.
 *
 * Uses `withSanitizedCopilotDesktopEnv` so the Electron host environment
 * (`ELECTRON_RUN_AS_NODE` etc.) doesn't leak into the spawned binary.
 */
class CopilotAuthProbeError extends Data.TaggedError("CopilotAuthProbeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const probeCopilotAuth = (binaryPath: string | undefined): Effect.Effect<CopilotAuthProbeResult> =>
  Effect.tryPromise({
    try: async (): Promise<CopilotAuthProbeResult> => {
      const { CopilotClient } = await import("@github/copilot-sdk");
      const cliPath = resolveCopilotSdkCliPath(binaryPath);
      const client = new CopilotClient({
        ...(cliPath ? { cliPath } : {}),
        logLevel: "error",
      });
      try {
        await withSanitizedCopilotDesktopEnv(() => client.start());
        const models = await withSanitizedCopilotDesktopEnv(() =>
          client.listModels().catch(() => undefined),
        );
        const authenticated = !!(models && models.length > 0);
        return { authenticated };
      } finally {
        await client.stop().catch(() => undefined);
      }
    },
    catch: (cause) =>
      new CopilotAuthProbeError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  }).pipe(
    Effect.timeoutOption("8 seconds"),
    Effect.result,
    Effect.map((result): CopilotAuthProbeResult => {
      if (Result.isFailure(result)) {
        return {
          authenticated: false,
          detail: result.failure.message,
        };
      }
      return Option.isSome(result.success)
        ? result.success.value
        : { authenticated: false, detail: "Copilot SDK probe timed out." };
    }),
  );

export const makePendingCopilotProvider = (settings: CopilotSettings): ServerProviderDraft => {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    [],
    settings.customModels,
    DEFAULT_COPILOT_MODEL_CAPABILITIES,
  );

  if (!settings.enabled) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "GitHub Copilot is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    presentation: COPILOT_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "GitHub Copilot status has not been checked in this session yet.",
    },
  });
};

export const checkCopilotProviderStatus = Effect.fn("checkCopilotProviderStatus")(function* (
  settings: CopilotSettings,
  environment: NodeJS.ProcessEnv = process.env,
): Effect.fn.Return<ServerProviderDraft, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    [],
    settings.customModels,
    DEFAULT_COPILOT_MODEL_CAPABILITIES,
  );

  if (!settings.enabled) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "GitHub Copilot is disabled in T3 Code settings.",
      },
    });
  }

  const binaryPath = resolveCopilotBinaryPath(settings);
  if (!binaryPath) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message:
          "GitHub Copilot CLI is not installed and no binary path is configured. " +
          "Install the GitHub Copilot CLI or set a binary path in settings.",
      },
    });
  }

  const versionProbe = yield* runCopilotVersionCommand(binaryPath, environment).pipe(
    Effect.timeoutOption(DEFAULT_TIMEOUT_MS),
    Effect.result,
  );

  if (Result.isFailure(versionProbe)) {
    const error = versionProbe.failure;
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: !isCommandMissingCause(error),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause(error)
          ? "GitHub Copilot CLI (`copilot`) is not installed or not on PATH."
          : `Failed to execute GitHub Copilot CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
      },
    });
  }

  if (Option.isNone(versionProbe.success)) {
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: "GitHub Copilot CLI is installed but timed out while reporting its version.",
      },
    });
  }

  const versionResult = versionProbe.success.value;
  const parsedVersion = parseGenericCliVersion(`${versionResult.stdout}\n${versionResult.stderr}`);
  if (versionResult.code !== 0) {
    const detail = detailFromResult(versionResult);
    return buildServerProvider({
      presentation: COPILOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: parsedVersion,
        status: "error",
        auth: { status: "unknown" },
        message: detail
          ? `GitHub Copilot CLI is installed but failed to run. ${detail}`
          : "GitHub Copilot CLI is installed but failed to run.",
      },
    });
  }

  const auth = yield* probeCopilotAuth(binaryPath);

  return buildServerProvider({
    presentation: COPILOT_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: parsedVersion,
      status: auth.authenticated ? "ready" : "warning",
      auth: auth.authenticated
        ? { status: "authenticated", type: "github" }
        : { status: "unknown" },
      ...(auth.authenticated
        ? {}
        : {
            message:
              auth.detail ??
              "GitHub Copilot CLI is installed but no signed-in account was detected. Run `copilot auth login`.",
          }),
    },
  });
});

export type { ServerProviderModel };
