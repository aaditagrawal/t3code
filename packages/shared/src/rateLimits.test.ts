import { describe, expect, it } from "vite-plus/test";

import { normalizeProviderRateLimitPayload, normalizeRateLimitLabel } from "./rateLimits.ts";

describe("normalizeProviderRateLimitPayload", () => {
  it("unwraps the Codex double-nested snapshot and converts epoch resets", () => {
    const normalized = normalizeProviderRateLimitPayload({
      rateLimits: {
        rateLimits: {
          primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_785_848_123 },
          secondary: { usedPercent: 53, windowDurationMins: 10_080 },
        },
      },
    });

    expect(normalized).toEqual({
      limits: [
        {
          window: "5h",
          usedPercent: 12,
          resetsAt: "2026-08-04T12:55:23.000Z",
          windowDurationMins: 300,
        },
        { window: "Weekly", usedPercent: 53, windowDurationMins: 10_080 },
      ],
    });
  });

  it("reads the Claude rate_limit_event message nested under rateLimits", () => {
    const normalized = normalizeProviderRateLimitPayload({
      rateLimits: {
        type: "rate_limit_event",
        rate_limit_info: {
          rateLimitType: "seven_day",
          utilization: 0.9,
          resetsAt: "2026-08-05T00:00:00.000Z",
          status: "allowed_warning",
        },
      },
    });

    expect(normalized).toEqual({
      limits: [
        {
          window: "Weekly",
          usedPercent: 90,
          resetsAt: "2026-08-05T00:00:00.000Z",
          windowDurationMins: 10_080,
        },
      ],
      status: "allowed_warning",
    });
  });

  it("round-trips an already-normalized limits array", () => {
    const limits = [{ window: "5h", usedPercent: 30, windowDurationMins: 300 }];
    expect(normalizeProviderRateLimitPayload({ provider: "codex", limits })).toEqual({ limits });
  });

  it("preserves a top-level status when re-normalizing a persisted payload", () => {
    // The persisted activity shape takes the `limits` branch, which never sees
    // `rate_limit_info`, so the status must be read back from the top level.
    const limits = [{ window: "5h", usedPercent: 30, windowDurationMins: 300 }];
    expect(
      normalizeProviderRateLimitPayload({
        provider: "claudeAgent",
        limits,
        status: "allowed_warning",
      }),
    ).toEqual({ limits, status: "allowed_warning" });
  });

  it("reads a keyed rateLimitsByLimitId snapshot", () => {
    const normalized = normalizeProviderRateLimitPayload({
      rateLimitsByLimitId: {
        short: { primary: { usedPercent: 12, windowDurationMins: 300 } },
        weekly: { primary: { usedPercent: 8, windowDurationMins: 10_080 } },
      },
    });

    expect(normalized?.limits.map((limit) => limit.window)).toEqual(["5h", "Weekly"]);
    // The bucket key is the limit id; it has to survive so two buckets sharing a
    // window label stay distinguishable downstream.
    expect(normalized?.limits.map((limit) => limit.limitId)).toEqual(["short", "weekly"]);
  });

  it("returns undefined when no window carries usage or a reset", () => {
    expect(normalizeProviderRateLimitPayload(undefined)).toBeUndefined();
    expect(normalizeProviderRateLimitPayload({})).toBeUndefined();
    expect(normalizeProviderRateLimitPayload({ rateLimits: {} })).toBeUndefined();
    expect(
      normalizeProviderRateLimitPayload({ rateLimits: { rateLimits: { primary: null } } }),
    ).toBeUndefined();
  });
});

describe("normalizeRateLimitLabel", () => {
  it("prefers the window duration over the raw label", () => {
    expect(normalizeRateLimitLabel("whatever", 300)).toBe("5h");
    expect(normalizeRateLimitLabel("whatever", 10_080)).toBe("Weekly");
  });

  it("normalizes known provider label spellings", () => {
    expect(normalizeRateLimitLabel("five_hour")).toBe("5h");
    expect(normalizeRateLimitLabel("seven_day")).toBe("Weekly");
    expect(normalizeRateLimitLabel("seven-day-sonnet")).toBe("Sonnet");
    expect(normalizeRateLimitLabel(undefined)).toBe("Current");
  });
});
