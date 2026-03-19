import { ApprovalRequestId, ThreadId, TurnId, type ProviderRuntimeEvent } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { KiloServerManager } from "./kiloServerManager.ts";
import {
  PROVIDER,
  type KiloClient,
  type KiloProviderSession,
  type KiloSessionContext,
} from "./kilo/types.ts";

class TestKiloServerManager extends KiloServerManager {
  seedSession(context: KiloSessionContext) {
    (this as unknown as { sessions: Map<ThreadId, KiloSessionContext> }).sessions.set(
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
  } satisfies KiloClient;
}

function createContext(client: KiloClient): KiloSessionContext {
  const now = new Date().toISOString();
  return {
    threadId: ThreadId.makeUnsafe("thread-kilo"),
    directory: process.cwd(),
    workspace: "/workspace/project",
    client,
    providerSessionId: "session-kilo",
    pendingPermissions: new Map([
      [
        ApprovalRequestId.makeUnsafe("approval-kilo"),
        {
          requestId: ApprovalRequestId.makeUnsafe("approval-kilo"),
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
      threadId: ThreadId.makeUnsafe("thread-kilo"),
      createdAt: now,
      updatedAt: now,
      resumeCursor: { sessionId: "session-kilo" },
      activeTurnId: TurnId.makeUnsafe("turn-kilo"),
    } as KiloProviderSession,
    activeTurnId: TurnId.makeUnsafe("turn-kilo"),
    lastError: undefined,
  };
}

describe("KiloServerManager.respondToRequest", () => {
  it("aborts the active turn when the user cancels a pending approval", async () => {
    const manager = new TestKiloServerManager();
    const client = createClient();
    const context = createContext(client);
    const events: ProviderRuntimeEvent[] = [];
    manager.on("event", (event) => {
      events.push(event);
    });
    manager.seedSession(context);

    await manager.respondToRequest(
      context.threadId,
      ApprovalRequestId.makeUnsafe("approval-kilo"),
      "cancel",
    );

    expect(client.permission.reply).toHaveBeenCalledWith({
      requestID: "approval-kilo",
      workspace: "/workspace/project",
      reply: "reject",
    });
    expect(client.session.abort).toHaveBeenCalledWith({
      sessionID: "session-kilo",
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
    const manager = new TestKiloServerManager();
    const client = createClient();
    const context = createContext(client);
    manager.seedSession(context);

    await manager.respondToRequest(
      context.threadId,
      ApprovalRequestId.makeUnsafe("approval-kilo"),
      "decline",
    );

    expect(client.permission.reply).toHaveBeenCalledWith({
      requestID: "approval-kilo",
      workspace: "/workspace/project",
      reply: "reject",
    });
    expect(client.session.abort).not.toHaveBeenCalled();
    expect(context.activeTurnId).toBe(TurnId.makeUnsafe("turn-kilo"));
  });
});
