// FILE: rateLimits.ts
// Purpose: Derives account rate-limit rows from orchestration thread activities and
// formats them for presentation. Payload normalization lives in
// `@t3tools/shared/rateLimits` so the server ingestion layer and every client agree.

import type { OrchestrationThread } from "@t3tools/contracts";
import {
  compareWindowLabels,
  normalizeProviderRateLimitPayload,
  normalizeRateLimitLabel,
  type RateLimitWindow,
  resolveUsedPercent,
} from "@t3tools/shared/rateLimits";

export { normalizeRateLimitLabel };
export type { RateLimitWindow };

export interface ProviderRateLimit {
  provider: string;
  updatedAt: string;
  limits?: RateLimitWindow[];
  usedPercent?: number;
  utilization?: number;
  resetsAt?: string;
  windowDurationMins?: number;
  status?: string;
}

export interface VisibleRateLimitRow {
  id: string;
  label: string;
  remainingPercent: number;
  resetsAt?: string;
  windowDurationMins?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isUpcomingReset(resetsAt: string | undefined, nowMs: number): boolean {
  if (!resetsAt) return true;
  const resetMs = Date.parse(resetsAt);
  return Number.isNaN(resetMs) || resetMs >= nowMs;
}

interface AccumulatedRateLimits {
  updatedAt: string;
  status?: string;
  windows: Map<string, { limit: RateLimitWindow; observedAt: string }>;
}

export function deriveAccountRateLimits(
  threads: ReadonlyArray<Pick<OrchestrationThread, "activities">>,
): ProviderRateLimit[] {
  const byProvider = new Map<string, AccumulatedRateLimits>();
  const nowMs = Date.now();

  for (const thread of threads) {
    for (const activity of thread.activities) {
      if (
        activity.kind !== "account.rate-limits.updated" &&
        activity.kind !== "account.rate-limited"
      ) {
        continue;
      }

      const payload = asRecord(activity.payload);
      if (!payload) continue;

      const normalized = normalizeProviderRateLimitPayload(payload);
      if (!normalized) continue;

      const provider = typeof payload.provider === "string" ? payload.provider : "unknown";
      let accumulated = byProvider.get(provider);
      if (!accumulated) {
        accumulated = { updatedAt: activity.createdAt, windows: new Map() };
        byProvider.set(provider, accumulated);
      }

      // Codex documents these notifications as sparse rolling updates: one may
      // carry only the 5h window and the next only the weekly one. Replacing the
      // whole provider snapshot would make the untouched window vanish from the
      // panel, so merge the newest value per window instead.
      for (const limit of normalized.limits) {
        const existing = accumulated.windows.get(limit.window);
        if (!existing || existing.observedAt <= activity.createdAt) {
          accumulated.windows.set(limit.window, { limit, observedAt: activity.createdAt });
        }
      }

      if (accumulated.updatedAt <= activity.createdAt) {
        accumulated.updatedAt = activity.createdAt;
        if (normalized.status) {
          accumulated.status = normalized.status;
        }
      }
    }
  }

  const rateLimits: ProviderRateLimit[] = [];
  for (const [provider, accumulated] of byProvider) {
    // A window whose reset has already passed is stale rather than merely old,
    // which also bounds how long a merged-forward window can survive.
    const limits = Array.from(accumulated.windows.values(), (entry) => entry.limit)
      .filter((limit) => isUpcomingReset(limit.resetsAt, nowMs))
      .toSorted((a, b) => compareWindowLabels(a.window, b.window));
    if (limits.length === 0) continue;

    rateLimits.push({
      provider,
      updatedAt: accumulated.updatedAt,
      limits,
      ...(accumulated.status ? { status: accumulated.status } : {}),
    });
  }

  return rateLimits;
}

export function deriveVisibleRateLimitRows(
  rateLimits: ReadonlyArray<ProviderRateLimit>,
): VisibleRateLimitRow[] {
  const rowsByLabel = new Map<string, VisibleRateLimitRow & { usedPercent: number }>();

  for (const rateLimit of rateLimits) {
    const limits =
      rateLimit.limits && rateLimit.limits.length > 0
        ? rateLimit.limits
        : [
            {
              window: normalizeRateLimitLabel(undefined, rateLimit.windowDurationMins),
              ...(() => {
                const usedPercent = resolveUsedPercent(rateLimit);
                return usedPercent !== undefined ? { usedPercent } : {};
              })(),
              ...(rateLimit.resetsAt ? { resetsAt: rateLimit.resetsAt } : {}),
              ...(typeof rateLimit.windowDurationMins === "number"
                ? { windowDurationMins: rateLimit.windowDurationMins }
                : {}),
            },
          ];

    for (const limit of limits) {
      const usedPercent = resolveUsedPercent(limit);
      if (usedPercent === undefined) continue;

      const label = normalizeRateLimitLabel(limit.window, limit.windowDurationMins);
      const row = {
        id: `${rateLimit.provider}-${label}`,
        label,
        remainingPercent: Math.round(100 - usedPercent),
        ...(limit.resetsAt ? { resetsAt: limit.resetsAt } : {}),
        ...(typeof limit.windowDurationMins === "number"
          ? { windowDurationMins: limit.windowDurationMins }
          : {}),
        usedPercent,
      };

      const existing = rowsByLabel.get(label);
      if (!existing || usedPercent > existing.usedPercent) {
        rowsByLabel.set(label, row);
      }
    }
  }

  return Array.from(rowsByLabel.values())
    .toSorted((a, b) => compareWindowLabels(a.label, b.label))
    .map(({ usedPercent: _usedPercent, ...row }) => row);
}

export function formatRateLimitRemainingPercent(remainingPercent: number | undefined): string {
  if (remainingPercent === undefined) return "—";
  return `${Math.round(Math.min(100, Math.max(0, remainingPercent)))}%`;
}

export function formatRateLimitResetTime(resetsAt: string): string {
  const resetMs = Date.parse(resetsAt);
  if (Number.isNaN(resetMs)) return "";
  const diffMs = resetMs - Date.now();

  if (diffMs > 0 && diffMs < 24 * 60 * 60 * 1000) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(resetMs);
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(resetMs);
}

export function deriveRateLimitLearnMoreHref(
  rateLimits: ReadonlyArray<ProviderRateLimit>,
): string | null {
  const providers = new Set(rateLimits.map((rateLimit) => rateLimit.provider));
  if (providers.size !== 1) return null;

  const [provider] = providers;
  if (provider === "codex") return "https://platform.openai.com/usage";
  if (provider === "claudeAgent") {
    return "https://docs.anthropic.com/en/docs/about-claude/models#rate-limits";
  }
  return null;
}

function mergeRateLimitWindowSets(
  preferred: ReadonlyArray<RateLimitWindow>,
  fallback: ReadonlyArray<RateLimitWindow>,
): RateLimitWindow[] {
  const merged = new Map<string, RateLimitWindow>();

  for (const limit of fallback) {
    const label = normalizeRateLimitLabel(limit.window, limit.windowDurationMins);
    merged.set(label, {
      ...limit,
      window: label,
    });
  }

  for (const limit of preferred) {
    const label = normalizeRateLimitLabel(limit.window, limit.windowDurationMins);
    const existing = merged.get(label);
    merged.set(label, {
      ...existing,
      ...limit,
      window: label,
    });
  }

  return Array.from(merged.values()).toSorted((a, b) => compareWindowLabels(a.window, b.window));
}

function mergeProviderRateLimit(
  preferred: ProviderRateLimit,
  fallback: ProviderRateLimit | undefined,
): ProviderRateLimit {
  if (!fallback) return preferred;

  return {
    provider: preferred.provider,
    updatedAt: preferred.updatedAt,
    limits: mergeRateLimitWindowSets(preferred.limits ?? [], fallback.limits ?? []),
    ...((preferred.status ?? fallback.status)
      ? { status: preferred.status ?? fallback.status }
      : {}),
  };
}

export function mergeProviderRateLimits(
  preferred: ReadonlyArray<ProviderRateLimit>,
  fallback: ReadonlyArray<ProviderRateLimit>,
): ProviderRateLimit[] {
  const merged = new Map<string, ProviderRateLimit>();

  for (const rateLimit of fallback) {
    merged.set(rateLimit.provider, rateLimit);
  }

  for (const rateLimit of preferred) {
    merged.set(
      rateLimit.provider,
      mergeProviderRateLimit(rateLimit, merged.get(rateLimit.provider)),
    );
  }

  return Array.from(merged.values());
}
