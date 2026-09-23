/**
 * KiloAdapter — per-instance Kilo provider adapter.
 *
 * The adapter owns a fresh `KiloServerManager` per `ProviderInstance`, so two
 * Kilo instances never share session state, server processes, or runtime
 * event queues. The factory `makeKiloAdapter` is invoked from
 * {@link ../Drivers/KiloDriver} inside the registry's per-instance scope; the
 * scope finalizer registered here calls `manager.stopAll()` and shuts down
 * the runtime event queue.
 *
 * @module provider/Layers/KiloAdapter
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { KiloServerManager } from "../../kiloServerManager.ts";
import type { KiloSessionStartInput } from "../../kilo/types.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { ProviderAdapterError } from "../Errors.ts";
import { ProviderAdapterRequestError, ProviderAdapterValidationError } from "../Errors.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";
import type { KiloSettings } from "./KiloProvider.ts";

const PROVIDER = ProviderDriverKind.make("kilo");
const { toRequestError } = makeErrorHelpers("kilo");

export interface KiloAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  /** Optional injection point used by tests to swap in a fake manager. */
  readonly manager?: KiloServerManager;
  readonly makeManager?: () => KiloServerManager;
}

/**
 * KiloAdapterShape — per-instance Kilo adapter contract. Reuses the
 * OpenCode adapter shape (Kilo is API-compatible) and is keyed by the
 * `kilo` driver kind.
 */
export interface KiloAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

export const makeKiloAdapter = Effect.fn("makeKiloAdapter")(function* (
  kiloSettings: KiloSettings,
  options?: KiloAdapterOptions,
) {
  const _instanceId = options?.instanceId ?? ProviderInstanceId.make("kilo");
  void _instanceId; // reserved for future per-instance tagging
  const manager = options?.manager ?? options?.makeManager?.() ?? new KiloServerManager();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

  // Acquire the manager event listener at scope start, release at scope close.
  // Closing the registry-owned scope tears down sessions, the spawned Kilo
  // server child process, and the runtime event queue exactly once.
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const listener = (event: ProviderRuntimeEvent) => {
        Effect.runFork(Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid));
      };
      manager.on("event", listener);
      return listener;
    }),
    (listener) =>
      Effect.gen(function* () {
        manager.off("event", listener);
        manager.stopAll();
        yield* Queue.shutdown(runtimeEventQueue);
      }),
  );

  const resolveBinaryPath = (): string => kiloSettings.binaryPath.trim() || "kilo";

  const service: KiloAdapterShape = {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session" },
    startSession: (input) =>
      Effect.gen(function* () {
        if (!kiloSettings.enabled) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "startSession",
            issue: "Kilo provider is disabled in server settings.",
          });
        }
        const binaryPath = resolveBinaryPath();
        return yield* Effect.tryPromise({
          try: () =>
            manager.startSession({
              ...input,
              kilo: { binaryPath },
            } as KiloSessionStartInput),
          catch: (cause) => toRequestError(input.threadId, "session/start", cause),
        });
      }),
    sendTurn: (input) => {
      if ((input.attachments?.length ?? 0) > 0) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Kilo attachments are not wired yet.",
          }),
        );
      }

      return Effect.tryPromise({
        try: () => manager.sendTurn(input),
        catch: (cause) => toRequestError(input.threadId, "session/prompt_async", cause),
      });
    },
    interruptTurn: (threadId) =>
      Effect.tryPromise({
        try: () => manager.interruptTurn(threadId),
        catch: (cause) => toRequestError(threadId, "session/abort", cause),
      }),
    respondToRequest: (threadId, requestId, decision) =>
      Effect.tryPromise({
        try: () => manager.respondToRequest(threadId, requestId, decision),
        catch: (cause) => toRequestError(threadId, "permission/reply", cause),
      }),
    respondToUserInput: (threadId, requestId, answers) =>
      Effect.tryPromise({
        try: () => manager.respondToUserInput(threadId, requestId, answers),
        catch: (cause) => toRequestError(threadId, "question/reply", cause),
      }),
    stopSession: (threadId) =>
      Effect.sync(() => {
        manager.stopSession(threadId);
      }),
    listSessions: () => Effect.sync(() => manager.listSessions()),
    hasSession: (threadId) => Effect.sync(() => manager.hasSession(threadId)),
    readThread: (threadId) =>
      Effect.tryPromise({
        try: () => manager.readThread(threadId),
        catch: (cause) => toRequestError(threadId, "session/messages", cause),
      }),
    rollbackThread: (threadId, numTurns) => {
      if (!Number.isInteger(numTurns) || numTurns < 1) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          }),
        );
      }

      return Effect.tryPromise({
        try: () => manager.rollbackThread(threadId, numTurns),
        catch: (cause) => toRequestError(threadId, "session/revert", cause),
      });
    },
    stopAll: () =>
      Effect.sync(() => {
        manager.stopAll();
      }),
    streamEvents: Stream.fromQueue(runtimeEventQueue),
  };

  return service;
});

// Re-export so callers using the public symbol name still resolve.
export { ProviderAdapterRequestError };
