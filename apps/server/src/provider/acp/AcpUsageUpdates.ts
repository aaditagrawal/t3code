import type {
  ProviderUsageLimitsUpdate,
  ServerProviderUsageWindow,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import { clampPercent } from "../providerUsageLimits.ts";

const MONTH_MINS = 30 * 24 * 60;
const WEEK_MINS = 7 * 24 * 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isoFromEpochMillis(value: number): string | undefined {
  if (value <= 0) return undefined;
  const dt = DateTime.make(value);
  return Option.isSome(dt) ? DateTime.formatIso(dt.value) : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
  const millis = finiteNumber(value);
  if (millis !== undefined) {
    return isoFromEpochMillis(millis);
  }
  const encoded = trimmedString(value);
  if (!encoded) return undefined;
  const parsed = Date.parse(encoded);
  return Number.isFinite(parsed) ? isoFromEpochMillis(parsed) : undefined;
}

function windowKind(value: unknown): ServerProviderUsageWindow["kind"] | undefined {
  return value === "session" || value === "weekly" || value === "monthly" || value === "other"
    ? value
    : undefined;
}

function kindFromDurationMins(mins: number | undefined): ServerProviderUsageWindow["kind"] {
  if (mins === undefined || !Number.isFinite(mins) || mins <= 0) return "other";
  if (mins >= MONTH_MINS) return "monthly";
  if (mins >= WEEK_MINS) return "weekly";
  return "session";
}

function kindFromWindowId(id: string | undefined): ServerProviderUsageWindow["kind"] | undefined {
  if (!id) return undefined;
  const normalized = id.toLowerCase();
  if (normalized === "monthly" || normalized === "month" || /\b30d\b/.test(normalized)) {
    return "monthly";
  }
  if (
    normalized === "weekly" ||
    normalized === "7d" ||
    normalized === "seven_day" ||
    /\bweek/.test(normalized)
  ) {
    return "weekly";
  }
  if (
    normalized === "session" ||
    normalized === "5h" ||
    normalized === "five_hour" ||
    /\bhour/.test(normalized)
  ) {
    return "session";
  }
  return undefined;
}

function durationMinsFromMs(durationMs: number | undefined): number | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  return Math.max(0, Math.round(durationMs / 60_000));
}

function usedPercentFromAmount(amount: Record<string, unknown> | undefined): number | undefined {
  if (!amount) return undefined;
  const usedFraction = finiteNumber(amount.usedFraction);
  if (usedFraction !== undefined) return usedFraction * 100;
  const used = finiteNumber(amount.used);
  const limit = finiteNumber(amount.limit);
  if (used !== undefined && limit !== undefined && limit > 0) {
    return (used / limit) * 100;
  }
  if (amount.unit === "percent" && used !== undefined) return used;
  const remainingFraction = finiteNumber(amount.remainingFraction);
  if (remainingFraction !== undefined) return (1 - remainingFraction) * 100;
  return undefined;
}

function parseNormalizedWindow(value: unknown): ServerProviderUsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const id = trimmedString(value.id);
  const label = trimmedString(value.label);
  const kind = windowKind(value.kind);
  const usedPercent = finiteNumber(value.usedPercent);
  if (!id || !label || !kind || usedPercent === undefined) {
    return undefined;
  }
  const windowDurationMins = finiteNumber(value.windowDurationMins);
  const resetsAt = isoTimestamp(value.resetsAt);
  return {
    id,
    kind,
    label,
    usedPercent: clampPercent(usedPercent),
    ...(resetsAt ? { resetsAt } : {}),
    ...(windowDurationMins !== undefined && windowDurationMins >= 0
      ? { windowDurationMins: Math.floor(windowDurationMins) }
      : {}),
  };
}

function parseOhMyPiLimit(value: unknown): ServerProviderUsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const id = trimmedString(value.id);
  if (!id) return undefined;
  const window = isRecord(value.window) ? value.window : undefined;
  const amount = isRecord(value.amount) ? value.amount : undefined;
  const usedPercent = usedPercentFromAmount(amount);
  if (usedPercent === undefined) return undefined;
  const durationMins = durationMinsFromMs(finiteNumber(window?.durationMs));
  const kind =
    kindFromWindowId(trimmedString(window?.id)) ??
    kindFromWindowId(id) ??
    kindFromDurationMins(durationMins);
  const label = trimmedString(window?.label) ?? trimmedString(value.label) ?? id;
  const resetsAt = isoTimestamp(window?.resetsAt);
  return {
    id,
    kind,
    label,
    usedPercent: clampPercent(usedPercent),
    ...(resetsAt ? { resetsAt } : {}),
    ...(durationMins !== undefined ? { windowDurationMins: durationMins } : {}),
  };
}

function collectWindowsFromMeta(meta: unknown): ServerProviderUsageWindow[] {
  if (!isRecord(meta)) return [];
  const windows: ServerProviderUsageWindow[] = [];
  const pushParsed = (parsed: ServerProviderUsageWindow | undefined) => {
    if (parsed) windows.push(parsed);
  };
  if (Array.isArray(meta.windows)) {
    for (const window of meta.windows) {
      pushParsed(parseNormalizedWindow(window));
    }
  }
  if (Array.isArray(meta.limits)) {
    for (const limit of meta.limits) {
      pushParsed(parseOhMyPiLimit(limit));
    }
  }
  if (Array.isArray(meta.reports)) {
    for (const report of meta.reports) {
      if (!isRecord(report) || !Array.isArray(report.limits)) continue;
      for (const limit of report.limits) {
        pushParsed(parseOhMyPiLimit(limit));
      }
    }
  }
  return windows;
}

function dedupeWindows(
  windows: ReadonlyArray<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  const byId = new Map<string, ServerProviderUsageWindow>();
  for (const window of windows) {
    byId.set(window.id, window);
  }
  return [...byId.values()];
}

/**
 * ACP `usage_update` reports tokens currently in context (`used`) and the
 * context-window size (`size`). Map that onto the fork's thread usage snapshot
 * so the context-window meter can render without driver-specific payload.
 */
export function acpUsageUpdateToTokenUsageSnapshot(input: {
  readonly used: number;
  readonly size: number;
}): ThreadTokenUsageSnapshot | undefined {
  if (!Number.isFinite(input.used) || input.used < 0) {
    return undefined;
  }
  const usedTokens = Math.floor(input.used);
  const size = Number.isFinite(input.size) ? Math.floor(input.size) : 0;
  return {
    usedTokens,
    ...(size >= 1 ? { maxTokens: size } : {}),
  };
}

/**
 * Rate-limit windows ride ACP `usage_update` `_meta` (normalized windows, Oh My
 * Pi `limits`, or `reports`). Adapters emit `ProviderUsageLimitsUpdate` so
 * existing ingestion can fold them into the fork rate-limit panel.
 */
export function acpUsageUpdateToUsageLimits(
  rawPayload: unknown,
): ProviderUsageLimitsUpdate | undefined {
  if (!isRecord(rawPayload)) return undefined;
  const update = isRecord(rawPayload.update) ? rawPayload.update : undefined;
  const windows = dedupeWindows([
    ...collectWindowsFromMeta(rawPayload._meta),
    ...collectWindowsFromMeta(update?._meta),
  ]);
  if (windows.length === 0) {
    return undefined;
  }
  return { windows };
}

export function acpNotificationSessionId(rawPayload: unknown): string | undefined {
  if (!isRecord(rawPayload)) return undefined;
  return trimmedString(rawPayload.sessionId);
}
