import { ApprovalRequestId, ThreadId, TurnId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { OpenCodeServerManager } from "./opencodeServerManager.ts";
import {
  PROVIDER,
  type OpencodeClient,
  type OpenCodeProviderSession,
  type OpenCodeSessionContext,
} from "./opencode/types.ts";

class TestOpenCodeServerManager extends OpenCodeServerManager {
  seedSession(context: OpenCodeSessionContext) {
    (this as unknown as { sessions: Map<ThreadId, OpenCodeSessionContext> }).sessions.set(
      context.threadId,
      context,
    );
  }
}

function createClient() {
  return {
    session: {
      get: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
      promptAsync: vi.fn(async () => ({})),
      abort: vi.fn(async () => ({})),
      messages: vi.fn(async () => []),
      revert: vi.fn(async () => ({})),
      unrevert: vi.fn(async () => ({})),
    },
    permission: {
      reply: vi.fn(async () => ({})),
    },
    question: {
      reply: vi.fn(async () => ({})),
    },
    provider: {
      list: vi.fn(async () => ({ data: { all: [], connected: [] } })),
    },
    config: {
      providers: vi.fn(async () => ({ data: { providers: [] } })),
    },
    event: {
      subscribe: vi.fn(async () => ({ stream: (async function* () {})() })),
    },
  } satisfies OpencodeClient;
}

function createContext(client: OpencodeClient): OpenCodeSessionContext {
  const now = new Date().toISOString();
  return {
    threadId: ThreadId.makeUnsafe("thread-opencode"),
    directory: process.cwd(),
    workspace: "/workspace/project",
    client,
    providerSessionId: "session-opencode",
    pendingPermissions: new Map([
      [
        ApprovalRequestId.makeUnsafe("approval-opencode"),
        {
          requestId: ApprovalRequestId.makeUnsafe("approval-opencode"),
          requestType: "exec_command_approval",
        },
      ],
    ]),
    pendingQuestions: new Map(),
    partStreamById: new Map(),
    messageIds: [],
    streamAbortController: new AbortController(),
    streamTask: Promise.resolve(),
    session: {
      provider: PROVIDER,
      status: "running",
      runtimeMode: "approval-required",
      threadId: ThreadId.makeUnsafe("thread-opencode"),
      createdAt: now,
      updatedAt: now,
      resumeCursor: { sessionId: "session-opencode" },
      activeTurnId: TurnId.makeUnsafe("turn-opencode"),
    } as OpenCodeProviderSession,
    activeTurnId: TurnId.makeUnsafe("turn-opencode"),
    lastError: undefined,
  };
}

describe("OpenCodeServerManager.respondToRequest", () => {
  it("aborts the active turn when the user cancels a pending approval", async () => {
    const manager = new TestOpenCodeServerManager();
    const client = createClient();
    const context = createContext(client);
    const events: ProviderRuntimeEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });
    manager.seedSession(context);

    await manager.respondToRequest(
      context.threadId,
      ApprovalRequestId.makeUnsafe("approval-opencode"),
      "cancel",
    );

    expect(client.permission.reply).toHaveBeenCalledWith({
      requestID: "approval-opencode",
      workspace: "/workspace/project",
      reply: "reject",
    });
    expect(client.session.abort).toHaveBeenCalledWith({
      sessionID: "session-opencode",
      workspace: "/workspace/project",
    });
    expect(client.permission.reply.mock.invocationCallOrder[0]).toBeLessThan(
      client.session.abort.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
    expect(context.activeTurnId).toBeUndefined();
    expect(context.session.status).toBe("ready");
    expect(events.some((event) => event.type === "turn.completed")).toBe(true);
  });

  it("does not abort the turn for a normal rejection", async () => {
    const manager = new TestOpenCodeServerManager();
    const client = createClient();
    const context = createContext(client);
    manager.seedSession(context);

    await manager.respondToRequest(
      context.threadId,
      ApprovalRequestId.makeUnsafe("approval-opencode"),
      "decline",
    );

    expect(client.permission.reply).toHaveBeenCalledWith({
      requestID: "approval-opencode",
      workspace: "/workspace/project",
      reply: "reject",
    });
    expect(client.session.abort).not.toHaveBeenCalled();
    expect(context.activeTurnId).toBe(TurnId.makeUnsafe("turn-opencode"));
  });
});
