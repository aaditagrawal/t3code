import * as NodeServices from "@effect/platform-node/NodeServices";
import { createModelSelection } from "@t3tools/shared/model";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  ApprovalRequestId,
  CursorSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  ThreadId,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import type {
  CursorSdkAgent,
  CursorSdkAgentOptions,
  CursorSdkClient,
  CursorSdkMessage,
  CursorSdkRequestOptions,
  CursorSdkRun,
  CursorSdkRunOperation,
  CursorSdkRunResult,
  CursorSdkSendOptions,
  CursorSdkUserMessage,
} from "../cursor/CursorSdkClient.ts";
import type { CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { makeCursorAdapter } from "./CursorAdapter.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const TestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-cursor-sdk-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

class FakeRun implements CursorSdkRun {
  public cancelled = false;
  public status: CursorSdkRun["status"] = "running";
  public readonly id: string;
  public readonly agentId: string;
  private readonly messages: ReadonlyArray<CursorSdkMessage>;
  private readonly waitResult: CursorSdkRunResult;

  public constructor(
    id: string,
    agentId: string,
    messages: ReadonlyArray<CursorSdkMessage>,
    waitResult: CursorSdkRunResult = { id, status: "finished" },
  ) {
    this.id = id;
    this.agentId = agentId;
    this.messages = messages;
    this.waitResult = waitResult;
  }

  supports(operation: CursorSdkRunOperation): boolean {
    return operation === "stream" || operation === "wait" || operation === "cancel";
  }

  async *stream(): AsyncGenerator<CursorSdkMessage, void> {
    for (const message of this.messages) {
      yield message;
    }
  }

  async wait(): Promise<CursorSdkRunResult> {
    this.status = this.waitResult.status;
    return this.cancelled ? { id: this.id, status: "cancelled" } : this.waitResult;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.status = "cancelled";
  }
}

class BlockingRun extends FakeRun {
  override async wait(): Promise<CursorSdkRunResult> {
    await new Promise(() => undefined);
    return { id: this.id, status: "cancelled" };
  }
}

class FakeAgent implements CursorSdkAgent {
  public readonly send = vi.fn(
    async (_message: string | CursorSdkUserMessage, _options?: CursorSdkSendOptions) =>
      this.nextRun,
  );
  public readonly close = vi.fn();
  public readonly reload = vi.fn(async () => undefined);

  public readonly agentId: string;
  public nextRun: CursorSdkRun;

  public constructor(agentId: string, nextRun: CursorSdkRun) {
    this.agentId = agentId;
    this.nextRun = nextRun;
  }
}

class FakeCursorSdkClient implements CursorSdkClient {
  public readonly createAgent = vi.fn(async (options: CursorSdkAgentOptions) => {
    this.createAgentOptions.push(options);
    return this.agent;
  });
  public readonly resumeAgent = vi.fn(async (agentId: string, options?: CursorSdkAgentOptions) => {
    this.resumeAgentCalls.push(options ? { agentId, options } : { agentId });
    return this.agent;
  });
  public readonly prompt = vi.fn(async () => ({ id: "prompt-run", status: "finished" as const }));
  public readonly listModels = vi.fn(async (_options?: CursorSdkRequestOptions) => []);
  public readonly getCurrentUser = vi.fn(async (_options?: CursorSdkRequestOptions) => ({
    apiKeyName: "test-key",
    createdAt: "2026-05-24T00:00:00.000Z",
  }));

  public readonly createAgentOptions: CursorSdkAgentOptions[] = [];
  public readonly resumeAgentCalls: Array<{
    readonly agentId: string;
    readonly options?: CursorSdkAgentOptions;
  }> = [];

  public readonly agent: FakeAgent;

  public constructor(agent: FakeAgent) {
    this.agent = agent;
  }
}

function makeSdkMessage(partial: Record<string, unknown>): CursorSdkMessage {
  return {
    agent_id: "agent-1",
    run_id: "run-1",
    ...partial,
  } as CursorSdkMessage;
}

function localPermissionState(options: CursorSdkAgentOptions | undefined): {
  readonly sandboxEnabled: boolean | undefined;
  readonly autoReview: boolean | undefined;
} {
  const local = options?.local as
    | (NonNullable<CursorSdkAgentOptions["local"]> & { readonly autoReview?: boolean })
    | undefined;
  return {
    sandboxEnabled: local?.sandboxOptions?.enabled,
    autoReview: local?.autoReview,
  };
}

function runTest<A, E>(
  effect: Effect.Effect<
    A,
    E,
    Crypto.Crypto | FileSystem.FileSystem | Path.Path | ServerConfig | Scope.Scope
  >,
) {
  return Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestLayer)));
}

function collectThroughTurnCompleted(
  adapter: CursorAdapterShape,
): Effect.Effect<Fiber.Fiber<ReadonlyArray<ProviderRuntimeEvent>, never>, never, Scope.Scope> {
  return adapter.streamEvents.pipe(
    Stream.takeUntil((event) => event.type === "turn.completed"),
    Stream.runCollect,
    Effect.map((events) => events as ReadonlyArray<ProviderRuntimeEvent>),
    Effect.forkScoped,
  );
}

async function withAdapter<A>(
  fakeClient: FakeCursorSdkClient,
  effect: (adapter: CursorAdapterShape) => Effect.Effect<A, ProviderAdapterError, Scope.Scope>,
): Promise<A> {
  return runTest(
    Effect.gen(function* () {
      const adapter = yield* makeCursorAdapter(decodeCursorSettings({ enabled: true }), {
        environment: { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        sdkClient: fakeClient,
      });
      return yield* effect(adapter);
    }),
  );
}

describe("CursorAdapter SDK", () => {
  it("rejects rollback without changing the retained conversation", async () => {
    const run = new FakeRun("run-rollback", "agent-rollback", [
      makeSdkMessage({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      }),
    ]);
    const fakeClient = new FakeCursorSdkClient(new FakeAgent("agent-rollback", run));
    await withAdapter(fakeClient, (adapter) =>
      Effect.gen(function* () {
        expect(adapter.capabilities.supportsConversationRollback).toBe(false);
        const threadId = asThreadId("thread-rollback");
        yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "full-access" });
        const events = yield* collectThroughTurnCompleted(adapter);
        yield* adapter.sendTurn({ threadId, input: "hello", attachments: [] });
        yield* Fiber.join(events);
        const before = yield* adapter.readThread(threadId);
        expect(before.turns).toHaveLength(1);
        const rollback = yield* adapter.rollbackThread(threadId, 1).pipe(Effect.exit);
        expect(rollback._tag).toBe("Failure");
        expect(yield* adapter.readThread(threadId)).toEqual(before);
        expect((yield* adapter.readThread(threadId)).turns).toHaveLength(1);
      }),
    );
  });

  it("creates local SDK agents, applies model params, and emits canonical runtime events", async () => {
    const run = new FakeRun("run-1", "agent-1", [
      makeSdkMessage({ type: "status", status: "RUNNING" }),
      makeSdkMessage({ type: "thinking", text: "checking" }),
      makeSdkMessage({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      }),
      makeSdkMessage({
        type: "tool_call",
        call_id: "tool-1",
        name: "shell",
        status: "running",
        args: { command: "bun lint" },
      }),
      makeSdkMessage({
        type: "tool_call",
        call_id: "tool-1",
        name: "shell",
        status: "completed",
        result: "ok",
      }),
      makeSdkMessage({ type: "status", status: "FINISHED" }),
    ]);
    const agent = new FakeAgent("agent-1", run);
    const fakeClient = new FakeCursorSdkClient(agent);

    await withAdapter(fakeClient, (adapter) =>
      Effect.gen(function* () {
        const session = yield* adapter.startSession({
          threadId: asThreadId("thread-sdk"),
          provider: ProviderDriverKind.make("cursor"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "composer", [
            { id: "reasoning", value: "high" },
          ]),
        });
        expect(session.resumeCursor).toEqual({ schemaVersion: 2, agentId: "agent-1" });
        expect(fakeClient.createAgentOptions[0]?.model).toEqual({
          id: "composer-2.5",
          params: [{ id: "effort", value: "high" }],
        });

        const eventFiber = yield* collectThroughTurnCompleted(adapter);
        yield* Effect.yieldNow;
        const turn = yield* adapter.sendTurn({
          threadId: asThreadId("thread-sdk"),
          input: "Implement it",
          modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "gpt-5.4", [
            { id: "fastMode", value: true },
            { id: "contextWindow", value: "272k" },
          ]),
        });
        expect(turn.resumeCursor).toEqual({ schemaVersion: 2, agentId: "agent-1" });
        expect(agent.send).toHaveBeenCalledWith("Implement it", {
          idempotencyKey: `thread-sdk:${turn.turnId}`,
          model: {
            id: "gpt-5.4",
            params: [
              { id: "fast", value: "true" },
              { id: "context", value: "272k" },
            ],
          },
        });

        const events = yield* Fiber.join(eventFiber);
        expect(events.map((event: ProviderRuntimeEvent) => event.type)).toEqual([
          "turn.started",
          "session.state.changed",
          "item.started",
          "content.delta",
          "item.started",
          "content.delta",
          "item.started",
          "item.updated",
          "item.completed",
          "session.state.changed",
          "item.completed",
          "item.completed",
          "turn.completed",
        ]);
        expect(events.at(-1)?.payload).toEqual({
          state: "completed",
          stopReason: "finished",
        });
      }),
    );
  });

  it("resumes SDK agents from the persisted Cursor resume cursor", async () => {
    const run = new FakeRun("run-2", "agent-2", []);
    const agent = new FakeAgent("agent-2", run);
    const fakeClient = new FakeCursorSdkClient(agent);

    await withAdapter(fakeClient, (adapter) =>
      Effect.gen(function* () {
        const session = yield* adapter.startSession({
          threadId: asThreadId("thread-resume"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
          resumeCursor: { schemaVersion: 2, agentId: "existing-agent" },
        });
        expect(session.resumeCursor).toEqual({ schemaVersion: 2, agentId: "agent-2" });
        expect(fakeClient.createAgent).not.toHaveBeenCalled();
        expect(fakeClient.resumeAgentCalls[0]?.agentId).toBe("existing-agent");
      }),
    );
  });

  it("interrupts the active SDK run", async () => {
    const run = new BlockingRun("run-3", "agent-3", []);
    const agent = new FakeAgent("agent-3", run);
    const fakeClient = new FakeCursorSdkClient(agent);

    await withAdapter(fakeClient, (adapter) =>
      Effect.gen(function* () {
        yield* adapter.startSession({
          threadId: asThreadId("thread-interrupt"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
        yield* adapter.sendTurn({
          threadId: asThreadId("thread-interrupt"),
          input: "run",
        });
        yield* adapter.interruptTurn(asThreadId("thread-interrupt"));
        expect(run.cancelled).toBe(true);
      }),
    );
  });

  it("surfaces SDK interactive requests but rejects programmatic responses", async () => {
    const run = new FakeRun("run-4", "agent-4", [
      makeSdkMessage({ type: "request", request_id: "request-1" }),
    ]);
    const agent = new FakeAgent("agent-4", run);
    const fakeClient = new FakeCursorSdkClient(agent);

    await expect(
      withAdapter(fakeClient, (adapter) =>
        Effect.gen(function* () {
          const eventFiber = yield* collectThroughTurnCompleted(adapter);
          yield* adapter.startSession({
            threadId: asThreadId("thread-request"),
            cwd: process.cwd(),
            runtimeMode: "approval-required",
          });
          yield* adapter.sendTurn({
            threadId: asThreadId("thread-request"),
            input: "needs approval",
          });
          yield* Fiber.join(eventFiber);
          yield* adapter.respondToRequest(
            asThreadId("thread-request"),
            ApprovalRequestId.make("request-1"),
            "accept",
          );
        }),
      ),
    ).rejects.toThrow("does not expose a programmatic response API");
  });

  it("rejects sessions without CURSOR_API_KEY", async () => {
    const run = new FakeRun("run-5", "agent-5", []);
    const agent = new FakeAgent("agent-5", run);
    const fakeClient = new FakeCursorSdkClient(agent);

    await runTest(
      Effect.gen(function* () {
        const adapter = yield* makeCursorAdapter(decodeCursorSettings({ enabled: true }), {
          environment: {} as NodeJS.ProcessEnv,
          sdkClient: fakeClient,
        });
        yield* adapter.startSession({
          threadId: asThreadId("thread-no-key"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        });
      }),
    ).then(
      () => {
        throw new Error("Expected startSession to fail");
      },
      (error: unknown) => {
        expect(String(error)).toContain("CURSOR_API_KEY");
      },
    );
  });

  it("disables the SDK sandbox in full-access mode", async () => {
    const run = new FakeRun("run-full-access", "agent-full-access", []);
    const agent = new FakeAgent("agent-full-access", run);
    const fakeClient = new FakeCursorSdkClient(agent);

    await withAdapter(fakeClient, (adapter) =>
      adapter.startSession({
        threadId: asThreadId("thread-full-access"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      }),
    );

    expect(localPermissionState(fakeClient.createAgentOptions[0])).toEqual({
      sandboxEnabled: false,
      autoReview: undefined,
    });
  });

  it("enables Cursor auto-review in auto mode", async () => {
    const run = new FakeRun("run-auto", "agent-auto", []);
    const agent = new FakeAgent("agent-auto", run);
    const fakeClient = new FakeCursorSdkClient(agent);

    await withAdapter(fakeClient, (adapter) =>
      adapter.startSession({
        threadId: asThreadId("thread-auto"),
        cwd: process.cwd(),
        runtimeMode: "auto",
      }),
    );

    expect(localPermissionState(fakeClient.createAgentOptions[0])).toEqual({
      sandboxEnabled: true,
      autoReview: true,
    });
  });

  it.each(["approval-required", "auto-accept-edits", "medium-access"] as const)(
    "does not relax approval in %s mode",
    async (runtimeMode) => {
      const run = new FakeRun(`run-${runtimeMode}`, `agent-${runtimeMode}`, []);
      const agent = new FakeAgent(`agent-${runtimeMode}`, run);
      const fakeClient = new FakeCursorSdkClient(agent);

      await withAdapter(fakeClient, (adapter) =>
        adapter.startSession({
          threadId: asThreadId(`thread-${runtimeMode}`),
          cwd: process.cwd(),
          runtimeMode,
        }),
      );

      expect(localPermissionState(fakeClient.createAgentOptions[0])).toEqual({
        sandboxEnabled: true,
        autoReview: undefined,
      });
    },
  );
});
