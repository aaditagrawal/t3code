import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { handleEvent } from "./eventHandlers.ts";
import {
  PROVIDER,
  type OpenCodeProviderRuntimeEvent,
  type OpenCodeProviderSession,
  type OpenCodeSessionContext,
} from "./types.ts";

function createContext(): OpenCodeSessionContext {
  const now = new Date().toISOString();
  return {
    threadId: ThreadId.makeUnsafe("thread-opencode"),
    directory: process.cwd(),
    providerSessionId: "session-opencode",
    client: {
      session: {
        get: async () => ({}),
        create: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => [],
        revert: async () => ({}),
        unrevert: async () => ({}),
      },
      permission: {
        reply: async () => ({}),
      },
      question: {
        reply: async () => ({}),
      },
      provider: {
        list: async () => ({ data: { all: [], connected: [] } }),
      },
      config: {
        providers: async () => ({ data: { providers: [] } }),
      },
      event: {
        subscribe: async () => ({ stream: (async function* () {})() }),
      },
    },
    pendingPermissions: new Map(),
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
    } as OpenCodeProviderSession,
    activeTurnId: TurnId.makeUnsafe("turn-opencode"),
    lastError: undefined,
  };
}

function createEmitter() {
  const events: OpenCodeProviderRuntimeEvent[] = [];
  return {
    events,
    emitRuntimeEvent(event: OpenCodeProviderRuntimeEvent) {
      events.push(event);
    },
  };
}

describe("handleEvent tool updates", () => {
  it("suppresses redundant terminal tool events when a running update already showed the tool detail", () => {
    const context = createContext();
    const emitter = createEmitter();

    handleEvent(emitter, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-1",
          sessionID: "session-opencode",
          type: "tool",
          tool: "glob",
          state: {
            status: "running",
            title: "/Users/mav/sandbox/slop/slopbox/dna_to_rna.pl",
          },
        },
      },
    });
    handleEvent(emitter, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-1",
          sessionID: "session-opencode",
          type: "tool",
          tool: "glob",
          state: {
            status: "running",
            title: "/Users/mav/sandbox/slop/slopbox/dna_to_rna.pl",
          },
        },
      },
    });
    handleEvent(emitter, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-1",
          sessionID: "session-opencode",
          type: "tool",
          tool: "glob",
          state: {
            status: "completed",
            title: "Completed",
          },
        },
      },
    });

    expect(emitter.events.map((event) => event.type)).toEqual(["item.started", "item.updated"]);
  });

  it("keeps the terminal tool event when completion adds new detail", () => {
    const context = createContext();
    const emitter = createEmitter();

    handleEvent(emitter, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-2",
          sessionID: "session-opencode",
          type: "tool",
          tool: "read",
          state: {
            status: "running",
            title: "/tmp/example.ts",
          },
        },
      },
    });
    handleEvent(emitter, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-2",
          sessionID: "session-opencode",
          type: "tool",
          tool: "read",
          state: {
            status: "running",
            title: "/tmp/example.ts",
          },
        },
      },
    });
    handleEvent(emitter, context, {
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-2",
          sessionID: "session-opencode",
          type: "tool",
          tool: "read",
          state: {
            status: "completed",
            title: "Completed",
            output: "#!/usr/bin/env bun",
          },
        },
      },
    });

    expect(emitter.events.map((event) => event.type)).toEqual([
      "item.started",
      "item.updated",
      "item.completed",
      "tool.summary",
    ]);
    const completedEvent = emitter.events.find((event) => event.type === "item.completed");
    expect(completedEvent).toBeDefined();
    expect((completedEvent as { payload: { detail?: string } }).payload.detail).toBe(
      "#!/usr/bin/env bun",
    );
  });
});
