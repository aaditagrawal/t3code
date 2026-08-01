// FILE: rateLimits.ts
// Purpose: Normalizes provider-specific account rate-limit payloads into a canonical
// window list so the server ingestion layer and every client surface agree on one shape.

import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

export interface RateLimitWindow {
  window: string;
  usedPercent?: number;
  utilization?: number;
  resetsAt?: string;
  windowDurationMins?: number;
}

export interface NormalizedRateLimits {
  limits: RateLimitWindow[];
  status?: string;
}

const WINDOW_ORDER = new Map([
  ["5h", 0],
  ["Weekly", 1],
  ["Sonnet", 2],
  ["Current", 3],
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function clampPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

function toUsedPercent(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return clampPercent(value <= 1 ? value * 100 : value);
}

export function resolveUsedPercent(values: {
  usedPercent?: unknown;
  utilization?: unknown;
}): number | undefined {
  if (typeof values.usedPercent === "number") return clampPercent(values.usedPercent);
  if (typeof values.utilization === "number") return toUsedPercent(values.utilization);
  return undefined;
}

function toResetString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}

// Codex reports resets as epoch seconds; every other surface expects ISO.
function toIsoReset(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Option.match(DateTime.make(value * 1000), {
      onNone: () => undefined,
      onSome: DateTime.formatIso,
    });
  }
  return toResetString(value);
}

function windowLabelFromDuration(windowDurationMins: number | undefined): string | undefined {
  if (windowDurationMins === 300) return "5h";
  if (windowDurationMins === 10_080) return "Weekly";
  return undefined;
}

export function normalizeRateLimitLabel(
  label: string | undefined,
  windowDurationMins?: number,
): string {
  const durationLabel = windowLabelFromDuration(windowDurationMins);
  if (durationLabel) return durationLabel;
  if (!label) return "Current";

  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, "_");
  if (normalized === "session" || normalized === "five_hour" || normalized === "5h") {
    return "5h";
  }
  if (normalized === "weekly" || normalized === "seven_day" || normalized === "7d") {
    return "Weekly";
  }
  if (
    normalized === "seven_day_sonnet" ||
    normalized === "weekly_sonnet" ||
    normalized === "sonnet"
  ) {
    return "Sonnet";
  }
  return label;
}

export function compareWindowLabels(a: string, b: string): number {
  return (WINDOW_ORDER.get(a) ?? 99) - (WINDOW_ORDER.get(b) ?? 99);
}

function normalizeLimitWindow(
  label: string,
  rawWindow: Record<string, unknown>,
): RateLimitWindow | null {
  const usedPercent = resolveUsedPercent(rawWindow);
  const windowDurationMins =
    typeof rawWindow.windowDurationMins === "number" ? rawWindow.windowDurationMins : undefined;
  const resetsAt = toIsoReset(rawWindow.resetsAt);

  if (usedPercent === undefined && !resetsAt) return null;

  const window: RateLimitWindow = {
    window: normalizeRateLimitLabel(label, windowDurationMins),
  };
  if (usedPercent !== undefined) {
    window.usedPercent = usedPercent;
  }
  if (resetsAt) {
    window.resetsAt = resetsAt;
  }
  if (windowDurationMins !== undefined) {
    window.windowDurationMins = windowDurationMins;
  }
  return window;
}

function extractLimitsFromById(payload: Record<string, unknown>): RateLimitWindow[] | undefined {
  const rateLimitsByLimitId = asRecord(payload.rateLimitsByLimitId);
  if (!rateLimitsByLimitId) return undefined;

  const limits = Object.values(rateLimitsByLimitId)
    .map((entry) => asRecord(entry))
    .flatMap((entry) => {
      if (!entry) return [];
      const primary = asRecord(entry.primary);
      if (!primary) return [];
      const label =
        typeof entry.label === "string"
          ? entry.label
          : typeof entry.window === "string"
            ? entry.window
            : "";
      const normalized = normalizeLimitWindow(label, primary);
      return normalized ? [normalized] : [];
    });

  return limits.length > 0 ? limits : undefined;
}

function extractLimitsFromArray(payload: Record<string, unknown>): RateLimitWindow[] | undefined {
  if (!Array.isArray(payload.limits)) return undefined;

  const limits = payload.limits
    .map((entry) => asRecord(entry))
    .flatMap((entry) => {
      if (!entry || typeof entry.window !== "string") return [];
      const normalized = normalizeLimitWindow(entry.window, entry);
      return normalized ? [normalized] : [];
    });

  return limits.length > 0 ? limits : undefined;
}

function extractLimitsFromCodexPayload(
  payload: Record<string, unknown>,
): RateLimitWindow[] | undefined {
  const rateLimitsRoot = asRecord(payload.rateLimits);
  const nestedRateLimits =
    rateLimitsRoot && asRecord(rateLimitsRoot.rateLimits)
      ? asRecord(rateLimitsRoot.rateLimits)
      : (rateLimitsRoot ?? payload);
  if (!nestedRateLimits) return undefined;

  const primary = asRecord(nestedRateLimits.primary);
  const secondary = asRecord(nestedRateLimits.secondary);
  const limits: RateLimitWindow[] = [];

  if (primary) {
    const normalized = normalizeLimitWindow("Session", {
      usedPercent: primary.usedPercent,
      resetsAt: primary.resetsAt,
      windowDurationMins: primary.windowDurationMins,
    });
    if (normalized) limits.push(normalized);
  }

  if (secondary) {
    const normalized = normalizeLimitWindow("Weekly", {
      usedPercent: secondary.usedPercent,
      resetsAt: secondary.resetsAt,
      windowDurationMins: secondary.windowDurationMins,
    });
    if (normalized) limits.push(normalized);
  }

  return limits.length > 0 ? limits : undefined;
}

function extractLimitsFromClaudePayload(
  payload: Record<string, unknown>,
): { limits?: RateLimitWindow[]; status?: string } | undefined {
  const info = asRecord(payload.rate_limit_info);
  if (!info) return undefined;

  const rateLimitType = typeof info.rateLimitType === "string" ? info.rateLimitType : undefined;
  const windowDurationMins =
    rateLimitType === "five_hour" ? 300 : rateLimitType === "seven_day" ? 10_080 : undefined;
  const normalized = normalizeLimitWindow(rateLimitType ?? "Current", {
    utilization: info.utilization,
    resetsAt: info.resetsAt,
    windowDurationMins,
  });

  return {
    ...(normalized ? { limits: [normalized] } : {}),
    ...(typeof info.status === "string" ? { status: info.status } : {}),
  };
}

function extractFallbackLimits(payload: Record<string, unknown>): RateLimitWindow[] | undefined {
  const usedPercent = resolveUsedPercent(payload);
  const resetsAt = toIsoReset(payload.resetsAt);
  const windowDurationMins =
    typeof payload.windowDurationMins === "number" ? payload.windowDurationMins : undefined;

  if (usedPercent === undefined && !resetsAt) return undefined;

  return [
    {
      window: normalizeRateLimitLabel(undefined, windowDurationMins),
      ...(usedPercent !== undefined ? { usedPercent } : {}),
      ...(resetsAt ? { resetsAt } : {}),
      ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
    },
  ];
}

/**
 * Providers wrap their snapshot at different depths: Codex nests it under
 * `rateLimits.rateLimits`, Claude emits the raw `rate_limit_event` message under
 * `rateLimits`, and already-normalized activity payloads carry `limits` at the root.
 * Walking the wrappers outside-in lets one extractor chain serve all of them.
 */
function candidateRoots(payload: unknown): Record<string, unknown>[] {
  const roots: Record<string, unknown>[] = [];
  let current = asRecord(payload);
  while (current && roots.length < 3) {
    roots.push(current);
    current = asRecord(current.rateLimits);
  }
  return roots;
}

/**
 * Normalizes any provider rate-limit payload into a canonical window list.
 * Returns `undefined` when the payload carries no usable window, so callers can
 * skip persisting or rendering empty snapshots.
 */
export function normalizeProviderRateLimitPayload(
  payload: unknown,
): NormalizedRateLimits | undefined {
  for (const root of candidateRoots(payload)) {
    const claude = extractLimitsFromClaudePayload(root);
    const limits =
      extractLimitsFromById(root) ??
      extractLimitsFromArray(root) ??
      extractLimitsFromCodexPayload(root) ??
      claude?.limits ??
      extractFallbackLimits(root);

    if (limits && limits.length > 0) {
      return {
        limits: limits.toSorted((a, b) => compareWindowLabels(a.window, b.window)),
        ...(claude?.status ? { status: claude.status } : {}),
      };
    }
  }

  return undefined;
}
