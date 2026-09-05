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
import { it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { AmpServerManager } from "../../ampServerManager.ts";
import { makeAmpAdapter } from "./AmpAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asItemId = (value: string): RuntimeItemId => RuntimeItemId.make(value);

class FakeAmpManager extends AmpServerManager {
  public startSessionImpl = vi.fn(async (threadId: ThreadId): Promise<ProviderSession> => {
    const now = new Date().toISOString();
    return {
      provider: "amp",
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

const enabledAmpSettings = Schema.decodeSync(GenericProviderSettings)({
  enabled: true,
  binaryPath: "",
  configDir: "",
  customModels: [],
});

const disabledAmpSettings = Schema.decodeSync(GenericProviderSettings)({
  enabled: false,
  binaryPath: "",
  configDir: "",
  customModels: [],
});

it.effect("AmpAdapter delegates session startup to the manager", () =>
  Effect.gen(function* () {
    const manager = new FakeAmpManager();
    const adapter = yield* makeAmpAdapter(enabledAmpSettings, { manager });
    NodeAssert.equal(adapter.capabilities.supportsConversationRollback, false);

    const session = yield* adapter.startSession({
      threadId: asThreadId("thread-1"),
      runtimeMode: "full-access",
    });

    NodeAssert.equal(session.provider, "amp");
    NodeAssert.equal(manager.startSessionImpl.mock.calls[0]?.[0], asThreadId("thread-1"));
  }).pipe(Effect.scoped),
);

it.effect("AmpAdapter rejects startSession when provider is disabled", () =>
  Effect.gen(function* () {
    const manager = new FakeAmpManager();
    const adapter = yield* makeAmpAdapter(disabledAmpSettings, { manager });

    const result = yield* adapter
      .startSession({
        threadId: asThreadId("thread-disabled"),
        runtimeMode: "full-access",
      })
      .pipe(Effect.result);

    NodeAssert.equal(result._tag, "Failure");
    if (result._tag !== "Failure") {
      return;
    }
    NodeAssert.equal(result.failure._tag, "ProviderAdapterValidationError");
  }).pipe(Effect.scoped),
);

it.effect("AmpAdapter rejects attachments until AMP attachment wiring exists", () =>
  Effect.gen(function* () {
    const manager = new FakeAmpManager();
    const adapter = yield* makeAmpAdapter(enabledAmpSettings, { manager });

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
  }).pipe(Effect.scoped),
);

it.effect("AmpAdapter rejects rollbackThread with non-positive numTurns", () =>
  Effect.gen(function* () {
    const manager = new FakeAmpManager();
    const adapter = yield* makeAmpAdapter(enabledAmpSettings, { manager });

    const result = yield* adapter
      .rollbackThread(asThreadId("thread-rollback"), 0)
      .pipe(Effect.result);

    NodeAssert.equal(result._tag, "Failure");
    if (result._tag !== "Failure") {
      return;
    }
    NodeAssert.equal(result.failure._tag, "ProviderAdapterValidationError");
  }).pipe(Effect.scoped),
);

it.effect("AmpAdapter forwards interruptTurn calls to the manager", () =>
  Effect.gen(function* () {
    const manager = new FakeAmpManager();
    const adapter = yield* makeAmpAdapter(enabledAmpSettings, { manager });

    yield* adapter.interruptTurn(asThreadId("thread-interrupt"));

    NodeAssert.equal(manager.interruptTurnImpl.mock.calls.length, 1);
  }).pipe(Effect.scoped),
);

it.effect("AmpAdapter forwards manager runtime events through the adapter stream", () =>
  Effect.gen(function* () {
    const manager = new FakeAmpManager();
    const adapter = yield* makeAmpAdapter(enabledAmpSettings, { manager });

    const event = {
      type: "content.delta",
      eventId: asEventId("evt-amp-delta"),
      provider: "amp",
      createdAt: new Date().toISOString(),
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-1"),
      itemId: asItemId("item-1"),
      payload: {
        streamKind: "assistant_text",
        delta: "hello",
      },
    } as unknown as ProviderRuntimeEvent;

    // Emit first — the event is buffered in the unbounded queue via the
    // listener that was registered during adapter construction.
    manager.emit("event", event);

    // Now consume the head. Since the queue already has an item, this
    // resolves immediately without a race condition.
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
