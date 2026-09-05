/**
 * GeminiCliAdapter — per-instance Gemini CLI provider adapter.
 *
 * Mirrors the Amp/Kilo pattern but exposes a `makeGeminiCliAdapter(config, options)`
 * factory (instead of the old `Layer.effect` + service-tag setup) so the
 * `GeminiCliDriver` can capture one adapter per instance.
 *
 * The underlying `GeminiCliServerManager` is a pure EventEmitter that owns
 * all per-instance state — sessions, child processes, usage accumulator —
 * so two `makeGeminiCliAdapter` calls with different configs produce two
 * fully isolated adapters with no shared mutable state.
 *
 * @module provider/Layers/GeminiCliAdapter
 */
import {
  type GenericProviderSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { GeminiCliServerManager } from "../../geminiCliServerManager.ts";
import { ProviderAdapterValidationError, type ProviderAdapterError } from "../Errors.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";
import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";

const PROVIDER = ProviderDriverKind.make("geminiCli");
const { toRequestError } = makeErrorHelpers("geminiCli", {
  sessionNotFoundHints: ["unknown gemini cli session", "unknown session"],
});

export interface GeminiCliAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

export interface GeminiCliAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogger?: EventNdjsonLogger;
  /**
   * Inject a pre-built manager. Test-only — the driver always constructs its
   * own. Mutually exclusive with `makeManager`.
   */
  readonly manager?: GeminiCliServerManager;
  /**
   * Lazy manager factory used by tests that want a fresh manager but still
   * want the adapter to call the constructor.
   */
  readonly makeManager?: () => GeminiCliServerManager;
}

/**
 * Build one Gemini CLI adapter bound to the given config and options.
 *
 * Closes over a private `GeminiCliServerManager` so that two instances of
 * the same driver cannot reach into each other's session tables. Adds an
 * Effect finalizer that detaches the manager event listener and stops every
 * remaining session when the surrounding scope closes.
 */
export const makeGeminiCliAdapter = Effect.fn("makeGeminiCliAdapter")(function* (
  config: GenericProviderSettings,
  options: GeminiCliAdapterOptions = {},
) {
  const _boundInstanceId = options.instanceId ?? ProviderInstanceId.make("geminiCli");
  const trimmedBinary = config.binaryPath.trim();
  const manager =
    options.manager ??
    options.makeManager?.() ??
    new GeminiCliServerManager(trimmedBinary.length > 0 ? { binaryPath: trimmedBinary } : {});
  // Keep the manager's binary path in sync with the latest config — drivers
  // recreate the adapter when settings change, but tests may pass a manager
  // with an empty default that should pick up the config value.
  if (trimmedBinary.length > 0 && !manager.binaryPath) {
    manager.binaryPath = trimmedBinary;
  }

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

  const adapter: GeminiCliAdapterShape = {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    startSession: (input) =>
      Effect.gen(function* () {
        if (!config.enabled) {
          return yield* new ProviderAdapterValidationError({
            provider: "geminiCli",
            operation: "startSession",
            issue: "Gemini CLI provider is disabled in server settings.",
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
            provider: "geminiCli",
            operation: "sendTurn",
            issue: "Gemini CLI attachments are not supported yet.",
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
            provider: "geminiCli",
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

  return adapter;
});
