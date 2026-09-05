/**
 * AmpAdapter — per-instance Amp provider adapter factory.
 *
 * Replaces the old `Layer.effect(AmpAdapter, ...)` singleton pattern with
 * a `makeAmpAdapter(config, options)` factory that returns an
 * `Effect<ProviderAdapterShape>` scoped to the caller. Each call yields an
 * independent `AmpServerManager` whose lifetime is tied to the registry's
 * scope; closing the scope tears down every spawned Amp child process.
 *
 * @module AmpAdapter
 */
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type GenericProviderSettings,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { AmpServerManager } from "../../ampServerManager.ts";
import { ProviderAdapterValidationError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";

const PROVIDER = ProviderDriverKind.make("amp");
const { toRequestError } = makeErrorHelpers("amp");

export interface AmpAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

export interface AmpAdapterLiveOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  /** Optional pre-built manager (used by tests). */
  readonly manager?: AmpServerManager;
  /** Optional manager factory (used by tests). */
  readonly makeManager?: () => AmpServerManager;
}

export const makeAmpAdapter = Effect.fn("makeAmpAdapter")(function* (
  ampSettings: GenericProviderSettings,
  options?: AmpAdapterLiveOptions,
) {
  const manager = options?.manager ?? options?.makeManager?.() ?? new AmpServerManager();
  const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();

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

  // Configure the per-instance binary path on the manager up front. Settings
  // are immutable for the lifetime of the instance — registries replace the
  // instance whenever config changes.
  manager.binaryPath = ampSettings.binaryPath.trim() || undefined;

  const service: AmpAdapterShape = {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    startSession: (input) =>
      Effect.gen(function* () {
        if (!ampSettings.enabled) {
          return yield* new ProviderAdapterValidationError({
            provider: "amp",
            operation: "startSession",
            issue: "AMP provider is disabled in server settings.",
          });
        }
        return yield* Effect.tryPromise({
          try: () => manager.startSession(input),
          catch: (cause) => toRequestError(input.threadId, "session/start", cause),
        });
      }),
    sendTurn: (input) => {
      if ((input.attachments?.length ?? 0) > 0) {
        return Effect.fail(
          new ProviderAdapterValidationError({
            provider: "amp",
            operation: "sendTurn",
            issue: "AMP attachments are not supported yet.",
          }),
        );
      }

      return Effect.tryPromise({
        try: () => manager.sendTurn(input),
        catch: (cause) => toRequestError(input.threadId, "session/prompt", cause),
      });
    },
    interruptTurn: (threadId) =>
      Effect.tryPromise({
        try: () => manager.interruptTurn(threadId),
        catch: (cause) => toRequestError(threadId, "session/interrupt", cause),
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
            provider: "amp",
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          }),
        );
      }

      return Effect.tryPromise({
        try: () => manager.rollbackThread(threadId),
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
