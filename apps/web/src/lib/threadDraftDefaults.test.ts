import { ProjectId, ThreadId, type TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { resolveDraftThreadDefaults } from "./threadDraftDefaults";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "../types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    provider: "codex",
    model: "gpt-5.4",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: undefined,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function completedTurn(completedAt: string) {
  return {
    turnId: "turn-1" as TurnId,
    state: "completed" as const,
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  };
}

describe("resolveDraftThreadDefaults", () => {
  it("prefers the most recent thread from the active project", () => {
    const defaults = resolveDraftThreadDefaults({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-project"),
          projectId: ProjectId.makeUnsafe("project-1"),
          provider: "cursor",
          model: "composer-1.5",
          createdAt: "2026-03-08T10:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-other-project"),
          projectId: ProjectId.makeUnsafe("project-2"),
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          createdAt: "2026-03-09T10:00:00.000Z",
        }),
      ],
      projectId: ProjectId.makeUnsafe("project-1"),
      fallbackModel: "gpt-5.4",
    });

    expect(defaults).toEqual({
      provider: "cursor",
      model: "composer-1.5",
    });
  });

  it("falls back to the most recent thread overall when the project has no history", () => {
    const defaults = resolveDraftThreadDefaults({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-older"),
          provider: "codex",
          model: "gpt-5.4",
          createdAt: "2026-03-08T10:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-newest"),
          projectId: ProjectId.makeUnsafe("project-2"),
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          createdAt: "2026-03-09T10:00:00.000Z",
        }),
      ],
      projectId: ProjectId.makeUnsafe("project-3"),
      fallbackModel: "gpt-5.4",
    });

    expect(defaults).toEqual({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
    });
  });

  it("uses the most recently visited conversation instead of the newest created thread", () => {
    const defaults = resolveDraftThreadDefaults({
      threads: [
        makeThread({
          id: ThreadId.makeUnsafe("thread-revisited"),
          provider: "cursor",
          model: "composer-1.5",
          createdAt: "2026-03-01T10:00:00.000Z",
          lastVisitedAt: "2026-03-09T11:00:00.000Z",
          latestTurn: completedTurn("2026-03-09T10:59:00.000Z"),
        }),
        makeThread({
          id: ThreadId.makeUnsafe("thread-newer"),
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          createdAt: "2026-03-08T10:00:00.000Z",
        }),
      ],
      projectId: ProjectId.makeUnsafe("project-1"),
      fallbackModel: "gpt-5.4",
    });

    expect(defaults).toEqual({
      provider: "cursor",
      model: "composer-1.5",
    });
  });

  it("falls back to the supplied model when there is no previous conversation", () => {
    const defaults = resolveDraftThreadDefaults({
      threads: [],
      projectId: ProjectId.makeUnsafe("project-1"),
      fallbackModel: "claude-sonnet-4-6",
    });

    expect(defaults).toEqual({
      provider: "claudeAgent",
      model: "claude-sonnet-4-6",
    });
  });
});
