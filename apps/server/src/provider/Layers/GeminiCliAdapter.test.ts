// @effect-diagnostics globalDate:off globalDateInEffect:off - Tests build timestamped provider events.
import * as NodeAssert from "node:assert/strict";

import {
  ApprovalRequestId,
  EventId,
  GenericProviderSettings,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderApprovalDecision,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
} from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import { GeminiCliServerManager } from "../../geminiCliServerManager.ts";
import { makeGeminiCliAdapter, type GeminiCliAdapterShape } from "./GeminiCliAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asItemId = (value: string): RuntimeItemId => RuntimeItemId.make(value);

// Test-local service tag mirroring the OpenCode/Claude adapter test pattern:
// the new factory returns a shape directly, so tests inject it through a
// throwaway Context.Service tag.
class GeminiCliAdapter extends Context.Service<GeminiCliAdapter, GeminiCliAdapterShape>()(
  "t3/provider/Layers/GeminiCliAdapter.test/GeminiCliAdapter",
) {}

class FakeGeminiCliManager extends GeminiCliServerManager {
  public startSessionImpl = vi.fn(async (threadId: ThreadId): Promise<ProviderSession> => {
    const now = new Date().toISOString();
    return {
      provider: "geminiCli",
      status: "ready",
      runtimeMode: "full-access",
      threadId,
      cwd: process.cwd(),
      createdAt: now,
      updatedAt: now,
      resumeCursor: { sessionId: `session-${threadId}` },
    } as unknown as ProviderSession;
  });

  public sendTurnImpl = vi.fn(async (threadId: ThreadId): Promise<ProviderTurnStartResult> => ({
    threadId,
    turnId: asTurnId(`turn-${threadId}`),
  }));

  public interruptTurnImpl = vi.fn(async (): Promise<void> => undefined);
  public respondToRequestImpl = vi.fn(async (): Promise<void> => undefined);
  public respondToUserInputImpl = vi.fn(async (): Promise<void> => undefined);
  public readThreadImpl = vi.fn(async (threadId: ThreadId) => ({ threadId, turns: [] }));
  public rollbackThreadImpl = vi.fn(async (threadId: ThreadId) => ({ threadId, turns: [] }));
  public stopAllImpl = vi.fn(() => undefined);

  override startSession(input: { threadId: ThreadId }): Promise<ProviderSession> {
    return this.startSessionImpl(input.threadId);
  }

  override sendTurn(input: { threadId: ThreadId }): Promise<ProviderTurnStartResult> {
    return this.sendTurnImpl(input.threadId);
  }

  override interruptTurn(_threadId: ThreadId): Promise<void> {
    return this.interruptTurnImpl();
  }

  override respondToRequest(
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _decision: ProviderApprovalDecision,
  ): Promise<void> {
    return this.respondToRequestImpl();
  }

  override respondToUserInput(
    _threadId: ThreadId,
    _requestId: ApprovalRequestId,
    _answers: ProviderUserInputAnswers,
  ): Promise<void> {
    return this.respondToUserInputImpl();
  }

  override readThread(threadId: ThreadId) {
    return this.readThreadImpl(threadId);
  }

  override rollbackThread(threadId: ThreadId) {
    return this.rollbackThreadImpl(threadId);
  }

  override stopSession(_threadId: ThreadId): void {}

  override listSessions(): ProviderSession[] {
    return [];
  }

  override hasSession(_threadId: ThreadId): boolean {
    return false;
  }

  override stopAll(): void {
    this.stopAllImpl();
  }
}

const enabledConfig = Schema.decodeSync(GenericProviderSettings)({ enabled: true });
const disabledConfig = Schema.decodeSync(GenericProviderSettings)({ enabled: false });

const makeAdapterLayer = (manager: FakeGeminiCliManager, config = enabledConfig) =>
  Layer.effect(GeminiCliAdapter, makeGeminiCliAdapter(config, { manager }));

it.effect("delegates session startup to the manager", () =>
  Effect.gen(function* () {
    const manager = new FakeGeminiCliManager();
    const adapter = yield* makeGeminiCliAdapter(enabledConfig, { manager });
    NodeAssert.equal(adapter.capabilities.supportsConversationRollback, false);

    const session = yield* adapter.startSession({
      threadId: asThreadId("thread-1"),
      runtimeMode: "full-access",
    });

    NodeAssert.equal(session.provider, "geminiCli");
    NodeAssert.equal(manager.startSessionImpl.mock.calls[0]?.[0], asThreadId("thread-1"));
  }).pipe(Effect.scoped),
);

it.effect("returns validation error when the provider is disabled", () =>
  Effect.gen(function* () {
    const adapter = yield* GeminiCliAdapter;

    const result = yield* adapter
      .startSession({
        threadId: asThreadId("thread-disabled"),
        runtimeMode: "full-access",
      })
      .pipe(Effect.result);

    NodeAssert.equal(result._tag, "Failure");
    if (result._tag !== "Failure") return;
    NodeAssert.equal(result.failure._tag, "ProviderAdapterValidationError");
  }).pipe(
    Effect.provide(makeAdapterLayer(new FakeGeminiCliManager(), disabledConfig)),
    Effect.scoped,
  ),
);

it.effect("rejects attachments until Gemini CLI attachment wiring exists", () =>
  Effect.gen(function* () {
    const adapter = yield* GeminiCliAdapter;
    const result = yield* adapter
      .sendTurn({
        threadId: asThreadId("thread-attachments"),
        input: "hello",
        attachments: [{ id: "attachment-1" }] as never,
      })
      .pipe(Effect.result);

    NodeAssert.equal(result._tag, "Failure");
    if (result._tag !== "Failure") {
      return;
    }
    NodeAssert.equal(result.failure._tag, "ProviderAdapterValidationError");
  }).pipe(Effect.provide(makeAdapterLayer(new FakeGeminiCliManager())), Effect.scoped),
);

it.effect("forwards manager runtime events through the adapter stream", () =>
  Effect.gen(function* () {
    const manager = new FakeGeminiCliManager();
    const adapter = yield* makeGeminiCliAdapter(enabledConfig, { manager });

    const event = {
      type: "content.delta",
      eventId: asEventId("evt-gemini-delta"),
      provider: "geminiCli",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-1"),
      itemId: asItemId("item-1"),
      payload: {
        streamKind: "assistant_text",
        delta: "hello",
      },
    } as unknown as ProviderRuntimeEvent;

    // Event must be emitted AFTER the listener is attached (i.e. after the
    // layer is built and the adapter is yielded); the buffered queue then
    // holds the event so the subsequent `runHead` resolves immediately.
    manager.emit("event", event);

    const received = yield* Stream.runHead(adapter.streamEvents);

    NodeAssert.equal(received._tag, "Some");
    if (received._tag !== "Some") {
      return;
    }
    NodeAssert.equal(received.value.type, "content.delta");
    if (received.value.type !== "content.delta") {
      return;
    }
    NodeAssert.equal(received.value.payload.delta, "hello");
  }).pipe(Effect.scoped),
);
