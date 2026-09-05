import { describe, expect, it } from "vite-plus/test";

import {
  acpNotificationSessionId,
  acpUsageUpdateToTokenUsageSnapshot,
  acpUsageUpdateToUsageLimits,
} from "./AcpUsageUpdates.ts";

describe("ACP usage_update mapping", () => {
  it("maps used/size tokens onto the fork context-window snapshot", () => {
    expect(acpUsageUpdateToTokenUsageSnapshot({ used: 1_200.9, size: 128_000 })).toEqual({
      usedTokens: 1_200,
      maxTokens: 128_000,
    });
    expect(acpUsageUpdateToTokenUsageSnapshot({ used: 0, size: 0 })).toEqual({
      usedTokens: 0,
    });
    expect(acpUsageUpdateToTokenUsageSnapshot({ used: -1, size: 128_000 })).toBeUndefined();
  });

  it("maps normalized _meta windows into ProviderUsageLimitsUpdate", () => {
    expect(
      acpUsageUpdateToUsageLimits({
        sessionId: "omp-session",
        update: {
          sessionUpdate: "usage_update",
          used: 1_200,
          size: 128_000,
          _meta: {
            windows: [
              {
                id: "five_hour",
                kind: "session",
                label: "Session",
                usedPercent: 37,
                windowDurationMins: 300,
                resetsAt: "2026-09-05T12:00:00.000Z",
              },
            ],
          },
        },
      }),
    ).toEqual({
      windows: [
        {
          id: "five_hour",
          kind: "session",
          label: "Session",
          usedPercent: 37,
          windowDurationMins: 300,
          resetsAt: "2026-09-05T12:00:00.000Z",
        },
      ],
    });
  });

  it("maps Oh My Pi usage reports in notification _meta onto limit windows", () => {
    expect(
      acpUsageUpdateToUsageLimits({
        sessionId: "omp-session",
        _meta: {
          reports: [
            {
              provider: "anthropic",
              fetchedAt: 1,
              limits: [
                {
                  id: "anthropic:5h",
                  label: "Claude 5 Hour",
                  window: {
                    id: "5h",
                    label: "5 Hour",
                    durationMs: 5 * 60 * 60 * 1_000,
                    resetsAt: Date.parse("2026-09-05T12:00:00.000Z"),
                  },
                  amount: { used: 42, limit: 100, unit: "tokens" },
                },
              ],
            },
          ],
        },
        update: { sessionUpdate: "usage_update", used: 10, size: 100 },
      }),
    ).toEqual({
      windows: [
        {
          id: "anthropic:5h",
          kind: "session",
          label: "5 Hour",
          usedPercent: 42,
          windowDurationMins: 300,
          resetsAt: "2026-09-05T12:00:00.000Z",
        },
      ],
    });
  });

  it("does not invent rate-limit windows from context usage alone", () => {
    expect(
      acpUsageUpdateToUsageLimits({
        sessionId: "omp-session",
        update: { sessionUpdate: "usage_update", used: 1_200, size: 128_000 },
      }),
    ).toBeUndefined();
  });

  it("reads the ACP notification sessionId for child-session isolation", () => {
    expect(acpNotificationSessionId({ sessionId: " mock-child-session-1 " })).toBe(
      "mock-child-session-1",
    );
    expect(acpNotificationSessionId({ update: { sessionUpdate: "usage_update" } })).toBeUndefined();
  });
});
