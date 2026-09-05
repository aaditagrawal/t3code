// @effect-diagnostics globalDate:off globalDateInEffect:off - Tests build timestamped provider events.
import * as NodeAssert from "node:assert/strict";

import {
  EventId,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
} from "@t3tools/contracts";
import { it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { GenericProviderSettings } from "@t3tools/contracts";

import { KiloServerManager } from "../../kiloServerManager.ts";
import { makeKiloAdapter } from "./KiloAdapter.ts";

const asThreadId = (value: string): ThreadId => ThreadId.make(value);
const asTurnId = (value: string): TurnId => TurnId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asItemId = (value: string): RuntimeItemId => RuntimeItemId.make(value);

class FakeKiloManager extends KiloServerManager {
  public startSessionImpl = vi.fn(async (threadId: ThreadId): Promise<ProviderSession> => {
    const now = new Date().toISOString();
    return {
      provider: "kilo",
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

  override startSession(input: { threadId: ThreadId }): Promise<ProviderSession> {
    return this.startSessionImpl(input.threadId);
  }

  override sendTurn(input: { threadId: ThreadId }): Promise<ProviderTurnStartResult> {
    return this.sendTurnImpl(input.threadId);
  }

  override interruptTurn(_threadId: ThreadId): Promise<void> {
    return Promise.resolve();
  }

  override readThread(threadId: ThreadId) {
    return Promise.resolve({ threadId, turns: [] });
  }

  override rollbackThread(threadId: ThreadId) {
    return Promise.resolve({ threadId, turns: [] });
  }

  override stopSession(_threadId: ThreadId): void {}

  override listSessions(): ProviderSession[] {
    return [];
  }

  override hasSession(_threadId: ThreadId): boolean {
    return false;
  }

  override stopAll(): void {}
}

const enabledSettings = Schema.decodeSync(GenericProviderSettings)({ enabled: true });

it.effect("makeKiloAdapter delegates session startup to the manager", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeKiloManager();
      const adapter = yield* makeKiloAdapter(enabledSettings, { manager });

      const session = yield* adapter.startSession({
        threadId: asThreadId("thread-1"),
        runtimeMode: "full-access",
      });

      NodeAssert.equal(session.provider, "kilo");
      NodeAssert.equal(manager.startSessionImpl.mock.calls[0]?.[0], asThreadId("thread-1"));
    }),
  ),
);

it.effect("makeKiloAdapter rejects attachments until Kilo wiring exists", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const adapter = yield* makeKiloAdapter(enabledSettings, { manager: new FakeKiloManager() });

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
    }),
  ),
);

it.effect("makeKiloAdapter forwards manager runtime events through the stream", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const manager = new FakeKiloManager();
      const adapter = yield* makeKiloAdapter(enabledSettings, { manager });

      const event = {
        type: "content.delta",
        eventId: asEventId("evt-kilo-delta"),
        provider: "kilo",
        createdAt: new Date().toISOString(),
        threadId: asThreadId("thread-1"),
        turnId: asTurnId("turn-1"),
        itemId: asItemId("item-1"),
        payload: {
          streamKind: "assistant_text",
          delta: "hello",
        },
      } as unknown as ProviderRuntimeEvent;

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
    }),
  ),
);

const disabledKiloSettings = Schema.decodeSync(GenericProviderSettings)({ enabled: false });

it.effect("makeKiloAdapter rejects startSession when disabled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const adapter = yield* makeKiloAdapter(disabledKiloSettings, {
        manager: new FakeKiloManager(),
      });

      const result = yield* adapter
        .startSession({ threadId: asThreadId("thread-disabled"), runtimeMode: "full-access" })
        .pipe(Effect.result);

      NodeAssert.equal(result._tag, "Failure");
      if (result._tag !== "Failure") {
        return;
      }
      NodeAssert.equal(result.failure._tag, "ProviderAdapterValidationError");
    }),
  ),
);
