import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

function rateLimitEvent(
  provider: "codex" | "claudeAgent",
  rateLimits: unknown,
  turnId?: string,
): ProviderRuntimeEvent {
  return {
    type: "account.rate-limits.updated",
    eventId: EventId.make("event-rate-limits"),
    provider: ProviderDriverKind.make(provider),
    providerInstanceId: ProviderInstanceId.make(provider),
    threadId: ThreadId.make("thread-1"),
    createdAt: "2026-07-29T00:00:00.000Z",
    ...(turnId ? { turnId: TurnId.make(turnId) } : {}),
    payload: { rateLimits },
  };
}

describe("runtimeEventToActivities account.rate-limits.updated", () => {
  it("maps a Codex app-server snapshot into a persisted activity", () => {
    // Shape reported by Codex CLI 0.145.0: the notification body is itself
    // nested under `rateLimits`, so the adapter wrapper doubles the key.
    const activities = runtimeEventToActivities(
      rateLimitEvent("codex", {
        rateLimits: {
          limitId: "codex",
          planType: "plus",
          primary: {
            usedPercent: 53,
            windowDurationMins: 10_080,
            resetsAt: 1_785_848_123,
          },
          secondary: null,
        },
      }),
    );

    expect(activities).toHaveLength(1);
    const activity = activities[0]!;
    expect(activity.kind).toBe("account.rate-limits.updated");
    expect(activity.tone).toBe("info");
    expect(activity.id).toBe("event-rate-limits");
    expect(activity.payload).toEqual({
      provider: "codex",
      providerInstanceId: "codex",
      limits: [
        {
          limitId: "codex",
          window: "Weekly",
          usedPercent: 53,
          resetsAt: "2026-08-04T12:55:23.000Z",
          windowDurationMins: 10_080,
        },
      ],
    });
  });

  it("maps a Claude rate_limit_event message into a persisted activity", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent("claudeAgent", {
        type: "rate_limit_event",
        rate_limit_info: {
          rateLimitType: "five_hour",
          utilization: 0.42,
          resetsAt: "2026-07-29T05:00:00.000Z",
          status: "warning",
        },
      }),
    );

    expect(activities).toHaveLength(1);
    expect(activities[0]!.payload).toEqual({
      provider: "claudeAgent",
      providerInstanceId: "claudeAgent",
      limits: [
        {
          window: "5h",
          usedPercent: 42,
          resetsAt: "2026-07-29T05:00:00.000Z",
          windowDurationMins: 300,
        },
      ],
      status: "warning",
    });
  });

  it("drops snapshots that carry no usable window", () => {
    expect(runtimeEventToActivities(rateLimitEvent("codex", {}))).toEqual([]);
    expect(
      runtimeEventToActivities(rateLimitEvent("codex", { rateLimits: { primary: null } })),
    ).toEqual([]);
  });

  it("keeps the activity outside turn scope so a revert cannot erase account usage", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent(
        "claudeAgent",
        {
          type: "rate_limit_event",
          rate_limit_info: { rateLimitType: "five_hour", utilization: 0.42 },
        },
        "turn-1",
      ),
    );

    expect(activities).toHaveLength(1);
    expect(activities[0]!.turnId).toBeNull();
  });

  it("preserves the Codex bucket id so two buckets cannot mask each other", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent("codex", {
        rateLimits: {
          limitId: "codex-mini",
          primary: { usedPercent: 12, windowDurationMins: 300 },
          secondary: null,
        },
      }),
    );

    expect(activities[0]!.payload).toEqual({
      provider: "codex",
      providerInstanceId: "codex",
      limits: [{ limitId: "codex-mini", window: "5h", usedPercent: 12, windowDurationMins: 300 }],
    });
  });
});
