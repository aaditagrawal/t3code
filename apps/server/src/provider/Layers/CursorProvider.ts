import type {
  CursorSettings,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
} from "@t3tools/contracts";
import { ProviderDriverKind } from "@t3tools/contracts";
import { causeErrorTag } from "@t3tools/shared/observability";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import {
  buildServerProvider,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import {
  enrichProviderSnapshotWithVersionAdvisory,
  type ProviderMaintenanceCapabilities,
} from "../providerMaintenance.ts";
import { toMessage } from "../toMessage.ts";
import {
  liveCursorSdkClient,
  type CursorSdkClient,
  type CursorSdkUser,
} from "../cursor/CursorSdkClient.ts";
import {
  cursorSdkApiKey,
  CURSOR_FALLBACK_MODELS,
  EMPTY_CURSOR_CAPABILITIES,
  buildCursorDiscoveredModelsFromSdkModels,
} from "../cursor/CursorSdkMappings.ts";

const PROVIDER = ProviderDriverKind.make("cursor");
const CURSOR_PRESENTATION = {
  displayName: "Cursor",
  badgeLabel: "SDK",
  showInteractionModeToggle: true,
} as const;

const CURSOR_AUTH_TIMEOUT_MS = 10_000;
const CURSOR_MODEL_DISCOVERY_TIMEOUT_MS = 15_000;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

class CursorSdkProviderProbeError extends Data.TaggedError("CursorSdkProviderProbeError")<{
  readonly detail: string;
  readonly cause?: unknown;
}> {}

function probeErrorDetail(cause: unknown, fallback: string): string {
  return cause instanceof CursorSdkProviderProbeError ? cause.detail : toMessage(cause, fallback);
}

function authFromSdkUser(user: CursorSdkUser): ServerProviderAuth {
  const labelParts = [user.apiKeyName, user.userFirstName, user.userLastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return {
    status: "authenticated",
    type: "api_key",
    ...(labelParts.length > 0 ? { label: labelParts.join(" - ") } : {}),
    ...(user.userEmail ? { email: user.userEmail } : {}),
  };
}

function modelDiscoveryWarning(cause: unknown): string {
  return `Cursor SDK model discovery failed: ${probeErrorDetail(
    cause,
    "Unknown Cursor SDK error.",
  )}`;
}

export function getCursorFallbackModels(
  cursorSettings: Pick<CursorSettings, "customModels">,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    CURSOR_FALLBACK_MODELS,
    cursorSettings.customModels,
    EMPTY_CURSOR_CAPABILITIES,
  );
}

export function buildInitialCursorProviderSnapshot(
  cursorSettings: CursorSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* nowIso;
    const models = getCursorFallbackModels(cursorSettings);

    if (!cursorSettings.enabled) {
      return buildServerProvider({
        presentation: CURSOR_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Cursor is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: CURSOR_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Cursor SDK availability...",
      },
    });
  });
}

export function buildCursorProviderSnapshot(input: {
  readonly checkedAt: string;
  readonly cursorSettings: CursorSettings;
  readonly installed: boolean;
  readonly status: "ready" | "warning" | "error";
  readonly auth: ServerProviderAuth;
  readonly message?: string;
  readonly version?: string | null;
  readonly discoveredModels?: ReadonlyArray<ServerProviderModel>;
}): ServerProviderDraft {
  const models =
    input.discoveredModels && input.discoveredModels.length > 0
      ? input.discoveredModels
      : getCursorFallbackModels(input.cursorSettings);

  return buildServerProvider({
    presentation: CURSOR_PRESENTATION,
    enabled: input.cursorSettings.enabled,
    checkedAt: input.checkedAt,
    models,
    probe: {
      installed: input.installed,
      version: input.version ?? null,
      status: input.status,
      auth: input.auth,
      ...(input.message ? { message: input.message } : {}),
    },
  });
}

export const checkCursorProviderStatus = Effect.fn("checkCursorProviderStatus")(function* (
  cursorSettings: CursorSettings,
  environment: NodeJS.ProcessEnv = process.env,
  sdkClient: CursorSdkClient = liveCursorSdkClient,
) {
  const checkedAt = yield* nowIso;

  if (!cursorSettings.enabled) {
    return buildCursorProviderSnapshot({
      checkedAt,
      cursorSettings,
      installed: false,
      status: "warning",
      auth: { status: "unknown" },
      message: "Cursor is disabled in T3 Code settings.",
    });
  }

  const apiKey = cursorSdkApiKey(environment);
  if (!apiKey) {
    return buildCursorProviderSnapshot({
      checkedAt,
      cursorSettings,
      installed: true,
      status: "error",
      auth: { status: "unauthenticated" },
      message:
        "Cursor SDK requires CURSOR_API_KEY in the provider environment or process environment.",
    });
  }

  const userProbe = yield* Effect.tryPromise({
    try: () => sdkClient.getCurrentUser({ apiKey }),
    catch: (cause) =>
      new CursorSdkProviderProbeError({
        detail: toMessage(cause, "Cursor SDK authentication failed."),
        cause,
      }),
  }).pipe(Effect.timeoutOption(CURSOR_AUTH_TIMEOUT_MS), Effect.exit);

  if (Exit.isFailure(userProbe)) {
    const cause = Cause.squash(userProbe.cause);
    return buildCursorProviderSnapshot({
      checkedAt,
      cursorSettings,
      installed: true,
      status: "error",
      auth: { status: "unauthenticated" },
      message: `Cursor SDK authentication failed: ${probeErrorDetail(
        cause,
        "Unknown Cursor SDK error.",
      )}`,
    });
  }

  if (Option.isNone(userProbe.value)) {
    return buildCursorProviderSnapshot({
      checkedAt,
      cursorSettings,
      installed: true,
      status: "error",
      auth: { status: "unknown" },
      message: `Cursor SDK authentication timed out after ${CURSOR_AUTH_TIMEOUT_MS}ms.`,
    });
  }

  const auth = authFromSdkUser(userProbe.value.value);
  let discoveredModels: ReadonlyArray<ServerProviderModel> | undefined;
  let warning: string | undefined;

  const modelProbe = yield* Effect.tryPromise({
    try: () => sdkClient.listModels({ apiKey }),
    catch: (cause) =>
      new CursorSdkProviderProbeError({
        detail: toMessage(cause, "Cursor SDK model discovery failed."),
        cause,
      }),
  }).pipe(Effect.timeoutOption(CURSOR_MODEL_DISCOVERY_TIMEOUT_MS), Effect.exit);

  if (Exit.isSuccess(modelProbe) && Option.isSome(modelProbe.value)) {
    discoveredModels = buildCursorDiscoveredModelsFromSdkModels(
      modelProbe.value.value,
      cursorSettings.customModels,
    );
    if (discoveredModels.filter((model) => !model.isCustom).length === 0) {
      warning = "Cursor SDK model discovery returned no built-in models.";
      discoveredModels = undefined;
    }
  } else if (Exit.isSuccess(modelProbe) && Option.isNone(modelProbe.value)) {
    warning = `Cursor SDK model discovery timed out after ${CURSOR_MODEL_DISCOVERY_TIMEOUT_MS}ms.`;
  } else if (Exit.isFailure(modelProbe)) {
    warning = modelDiscoveryWarning(Cause.squash(modelProbe.cause));
    yield* Effect.logWarning("Cursor SDK model discovery failed", {
      errorTag: causeErrorTag(modelProbe.cause),
    });
  }

  return buildCursorProviderSnapshot({
    checkedAt,
    cursorSettings,
    installed: true,
    status: warning ? "warning" : "ready",
    auth,
    ...(warning ? { message: warning } : { message: "Cursor SDK is ready." }),
    ...(discoveredModels ? { discoveredModels } : {}),
  });
});

export function hasUncapturedCursorModels(_snapshot: Pick<ServerProvider, "models">): boolean {
  return false;
}

export const enrichCursorSnapshot = (input: {
  readonly settings: CursorSettings;
  readonly snapshot: ServerProvider;
  readonly maintenanceCapabilities?: ProviderMaintenanceCapabilities;
  readonly enableProviderUpdateChecks?: boolean;
  readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    if (!input.settings.enabled || input.snapshot.auth.status === "unauthenticated") {
      return;
    }

    const enriched = yield* enrichProviderSnapshotWithVersionAdvisory(
      input.snapshot,
      input.maintenanceCapabilities,
      {
        enableProviderUpdateChecks: input.enableProviderUpdateChecks,
      },
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Cursor version advisory enrichment failed", {
          errorTag: causeErrorTag(cause),
        }).pipe(Effect.as(input.snapshot)),
      ),
    );

    if (enriched !== input.snapshot) {
      yield* input.publishSnapshot(enriched);
    }
  });
