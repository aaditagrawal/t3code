import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ServerProviderUsageWindow,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

function rateLimitEvent(
  provider: "codex" | "claudeAgent" | "ohMyPi",
  windows: readonly ServerProviderUsageWindow[],
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
    payload: { limits: { windows } },
  };
}

describe("runtimeEventToActivities account.rate-limits.updated", () => {
  it("maps a Codex usage-limit update into a persisted activity", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent("codex", [
        {
          id: "primary",
          kind: "weekly",
          label: "Weekly",
          usedPercent: 53,
          resetsAt: "2026-08-04T12:55:23.000Z",
          windowDurationMins: 10_080,
        },
      ]),
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
          limitId: "primary",
          window: "Weekly",
          usedPercent: 53,
          resetsAt: "2026-08-04T12:55:23.000Z",
          windowDurationMins: 10_080,
        },
      ],
    });
  });

  it("maps a Claude session window into a persisted activity", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent("claudeAgent", [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 42,
          resetsAt: "2026-07-29T05:00:00.000Z",
          windowDurationMins: 300,
        },
      ]),
    );

    expect(activities).toHaveLength(1);
    expect(activities[0]!.payload).toEqual({
      provider: "claudeAgent",
      providerInstanceId: "claudeAgent",
      limits: [
        {
          limitId: "five_hour",
          window: "5h",
          usedPercent: 42,
          resetsAt: "2026-07-29T05:00:00.000Z",
          windowDurationMins: 300,
        },
      ],
    });
  });

  it("drops snapshots that carry no usable window", () => {
    expect(runtimeEventToActivities(rateLimitEvent("codex", []))).toEqual([]);
  });

  it("keeps the activity outside turn scope so a revert cannot erase account usage", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent(
        "claudeAgent",
        [
          {
            id: "five_hour",
            kind: "session",
            label: "Session",
            usedPercent: 42,
            windowDurationMins: 300,
          },
        ],
        "turn-1",
      ),
    );

    expect(activities).toHaveLength(1);
    expect(activities[0]!.turnId).toBeNull();
  });

  it("preserves the Codex bucket id so two buckets cannot mask each other", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent("codex", [
        {
          id: "codex-mini",
          kind: "session",
          label: "Session",
          usedPercent: 12,
          windowDurationMins: 300,
        },
      ]),
    );

    expect(activities[0]!.payload).toEqual({
      provider: "codex",
      providerInstanceId: "codex",
      limits: [{ limitId: "codex-mini", window: "5h", usedPercent: 12, windowDurationMins: 300 }],
    });
  });

  it("maps an Oh My Pi usage-limit update into a persisted activity", () => {
    const activities = runtimeEventToActivities(
      rateLimitEvent("ohMyPi", [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 37,
          resetsAt: "2026-09-05T12:00:00.000Z",
          windowDurationMins: 300,
        },
      ]),
    );

    expect(activities).toHaveLength(1);
    expect(activities[0]!.kind).toBe("account.rate-limits.updated");
    expect(activities[0]!.turnId).toBeNull();
    expect(activities[0]!.payload).toEqual({
      provider: "ohMyPi",
      providerInstanceId: "ohMyPi",
      limits: [
        {
          limitId: "five_hour",
          window: "5h",
          usedPercent: 37,
          resetsAt: "2026-09-05T12:00:00.000Z",
          windowDurationMins: 300,
        },
      ],
    });
  });
});
