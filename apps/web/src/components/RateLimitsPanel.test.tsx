import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

import {
  deriveAccountRateLimits,
  deriveVisibleRateLimitRows,
  formatRateLimitRemainingPercent,
} from "~/lib/rateLimits";

function makeActivity(
  id: string,
  kind: string,
  payload: unknown,
  createdAt = "2099-04-08T18:00:00.000Z",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt,
  };
}

describe("RateLimitsPanel helpers", () => {
  it("expires unchanged activity snapshots when the subscribed clock advances", () => {
    const threads = [
      {
        activities: [
          makeActivity("clock-window", "account.rate-limits.updated", {
            provider: "codex",
            limits: [
              {
                window: "5h",
                usedPercent: 90,
                resetsAt: "2099-04-08T20:00:00.000Z",
                windowDurationMins: 300,
              },
            ],
          }),
        ],
      },
    ];
    expect(deriveAccountRateLimits(threads, Date.parse("2099-04-08T19:59:00.000Z"))).toHaveLength(
      1,
    );
    expect(deriveAccountRateLimits(threads, Date.parse("2099-04-08T20:01:00.000Z"))).toEqual([]);
  });

  it("normalizes direct rate-limit snapshots into visible 5h and Weekly rows", () => {
    const rateLimits = deriveAccountRateLimits([
      {
        activities: [
          makeActivity("activity-1", "account.rate-limits.updated", {
            provider: "codex",
            rateLimitsByLimitId: {
              short: {
                primary: {
                  usedPercent: 12,
                  windowDurationMins: 300,
                  resetsAt: "2099-04-08T20:43:00.000Z",
                },
              },
              weekly: {
                primary: {
                  usedPercent: 8,
                  windowDurationMins: 10_080,
                  resetsAt: "2099-04-15T00:00:00.000Z",
                },
              },
            },
          }),
        ],
      },
    ]);

    const rows = deriveVisibleRateLimitRows(rateLimits);

    expect(rows).toEqual([
      {
        id: "codex-5h",
        label: "5h",
        remainingPercent: 88,
        resetsAt: "2099-04-08T20:43:00.000Z",
        windowDurationMins: 300,
      },
      {
        id: "codex-Weekly",
        label: "Weekly",
        remainingPercent: 92,
        resetsAt: "2099-04-15T00:00:00.000Z",
        windowDurationMins: 10080,
      },
    ]);
    expect(formatRateLimitRemainingPercent(rows[0]?.remainingPercent)).toBe("88%");
  });

  it("keeps the most constrained row when multiple providers report the same window", () => {
    const rows = deriveVisibleRateLimitRows([
      {
        provider: "codex",
        updatedAt: "2099-04-08T18:00:00.000Z",
        limits: [
          {
            window: "Weekly",
            usedPercent: 8,
            resetsAt: "2099-04-15T00:00:00.000Z",
            windowDurationMins: 10080,
          },
        ],
      },
      {
        provider: "claudeAgent",
        updatedAt: "2099-04-08T18:05:00.000Z",
        limits: [
          {
            window: "Weekly",
            usedPercent: 20,
            resetsAt: "2099-04-14T20:00:00.000Z",
            windowDurationMins: 10080,
          },
        ],
      },
    ]);

    expect(rows).toEqual([
      {
        id: "claudeAgent-Weekly",
        label: "Weekly",
        remainingPercent: 80,
        resetsAt: "2099-04-14T20:00:00.000Z",
        windowDurationMins: 10080,
      },
    ]);
  });

  it("reads nested codex runtime payloads like the app-server notifications", () => {
    const rateLimits = deriveAccountRateLimits([
      {
        activities: [
          makeActivity("activity-1", "account.rate-limits.updated", {
            provider: "codex",
            rateLimits: {
              limitId: "codex",
              primary: {
                usedPercent: 12,
                windowDurationMins: 300,
                resetsAt: "2099-04-08T20:43:00.000Z",
              },
              secondary: {
                usedPercent: 8,
                windowDurationMins: 10_080,
                resetsAt: "2099-04-15T00:00:00.000Z",
              },
            },
          }),
        ],
      },
    ]);

    const rows = deriveVisibleRateLimitRows(rateLimits);

    expect(rows).toEqual([
      {
        id: "codex-5h",
        label: "5h",
        remainingPercent: 88,
        resetsAt: "2099-04-08T20:43:00.000Z",
        windowDurationMins: 300,
      },
      {
        id: "codex-Weekly",
        label: "Weekly",
        remainingPercent: 92,
        resetsAt: "2099-04-15T00:00:00.000Z",
        windowDurationMins: 10080,
      },
    ]);
  });

  it("reads doubly nested codex runtime payloads from provider logs", () => {
    const rateLimits = deriveAccountRateLimits([
      {
        activities: [
          makeActivity("activity-1", "account.rate-limits.updated", {
            provider: "codex",
            rateLimits: {
              rateLimits: {
                primary: {
                  usedPercent: 20,
                  windowDurationMins: 300,
                  resetsAt: 4_079_388_780,
                },
                secondary: {
                  usedPercent: 10,
                  windowDurationMins: 10_080,
                  resetsAt: 4_079_880_000,
                },
              },
            },
          }),
        ],
      },
    ]);

    expect(deriveVisibleRateLimitRows(rateLimits)).toEqual([
      {
        id: "codex-5h",
        label: "5h",
        remainingPercent: 80,
        resetsAt: "2099-04-09T03:33:00.000Z",
        windowDurationMins: 300,
      },
      {
        id: "codex-Weekly",
        label: "Weekly",
        remainingPercent: 90,
        resetsAt: "2099-04-14T20:00:00.000Z",
        windowDurationMins: 10080,
      },
    ]);
  });

  it("reads claude rate_limit_info payloads from runtime telemetry", () => {
    const rateLimits = deriveAccountRateLimits([
      {
        activities: [
          makeActivity("activity-1", "account.rate-limits.updated", {
            provider: "claudeAgent",
            rate_limit_info: {
              status: "allowed_warning",
              rateLimitType: "five_hour",
              utilization: 0.9,
              resetsAt: 4_078_972_980,
            },
          }),
        ],
      },
    ]);

    const rows = deriveVisibleRateLimitRows(rateLimits);

    expect(rows).toEqual([
      {
        id: "claudeAgent-5h",
        label: "5h",
        remainingPercent: 10,
        resetsAt: "2099-04-04T08:03:00.000Z",
        windowDurationMins: 300,
      },
    ]);
  });

  it("merges sparse rolling updates instead of dropping the untouched window", () => {
    // Codex sends sparse rolling updates: a later notification can carry only
    // one window, and the other must stay visible.
    const rateLimits = deriveAccountRateLimits([
      {
        activities: [
          makeActivity(
            "activity-full",
            "account.rate-limits.updated",
            {
              provider: "codex",
              limits: [
                { window: "5h", usedPercent: 20, windowDurationMins: 300 },
                { window: "Weekly", usedPercent: 40, windowDurationMins: 10_080 },
              ],
            },
            "2099-04-08T18:00:00.000Z",
          ),
          makeActivity(
            "activity-sparse",
            "account.rate-limits.updated",
            {
              provider: "codex",
              limits: [{ window: "5h", usedPercent: 35, windowDurationMins: 300 }],
            },
            "2099-04-08T19:00:00.000Z",
          ),
        ],
      },
    ]);

    expect(deriveVisibleRateLimitRows(rateLimits)).toEqual([
      { id: "codex-5h", label: "5h", remainingPercent: 65, windowDurationMins: 300 },
      { id: "codex-Weekly", label: "Weekly", remainingPercent: 60, windowDurationMins: 10_080 },
    ]);
  });

  it("keeps distinct Codex buckets apart and shows the most constrained window", () => {
    const rateLimits = deriveAccountRateLimits([
      {
        activities: [
          makeActivity(
            "activity-bucket-a",
            "account.rate-limits.updated",
            {
              provider: "codex",
              limits: [
                { limitId: "codex", window: "5h", usedPercent: 80, windowDurationMins: 300 },
              ],
            },
            "2099-04-08T18:00:00.000Z",
          ),
          makeActivity(
            "activity-bucket-b",
            "account.rate-limits.updated",
            {
              provider: "codex",
              limits: [
                { limitId: "codex-mini", window: "5h", usedPercent: 10, windowDurationMins: 300 },
              ],
            },
            "2099-04-08T19:00:00.000Z",
          ),
        ],
      },
    ]);

    // The later, roomier bucket must not mask the constrained one.
    expect(deriveVisibleRateLimitRows(rateLimits)).toEqual([
      { id: "codex-5h", label: "5h", remainingPercent: 20, windowDurationMins: 300 },
    ]);
  });

  it("expires a merged window with no reset once its duration has elapsed", () => {
    const rateLimits = deriveAccountRateLimits([
      {
        activities: [
          makeActivity(
            "activity-expired",
            "account.rate-limits.updated",
            {
              provider: "codex",
              limits: [{ window: "5h", usedPercent: 90, windowDurationMins: 300 }],
            },
            "2020-01-01T00:00:00.000Z",
          ),
        ],
      },
    ]);

    expect(rateLimits).toEqual([]);
  });
});
