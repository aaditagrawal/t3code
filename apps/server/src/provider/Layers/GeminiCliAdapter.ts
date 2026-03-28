import { type ProviderRuntimeEvent } from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import { GeminiCliServerManager } from "../../geminiCliServerManager.ts";
import { ProviderAdapterProcessError, ProviderAdapterValidationError } from "../Errors.ts";
import { getProviderCapabilities } from "../Services/ProviderAdapter.ts";
import { GeminiCliAdapter, type GeminiCliAdapterShape } from "../Services/GeminiCliAdapter.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const PROVIDER = "geminiCli" as const;
const { toRequestError } = makeErrorHelpers(PROVIDER, {
  sessionNotFoundHints: ["unknown gemini cli session", "unknown session"],
});

export interface GeminiCliAdapterLiveOptions {
  readonly manager?: GeminiCliServerManager;
  readonly makeManager?: () => GeminiCliServerManager;
}

export function makeGeminiCliAdapterLive(options: GeminiCliAdapterLiveOptions = {}) {
  return Layer.effect(
    GeminiCliAdapter,
    Effect.gen(function* () {
      const manager = options.manager ?? options.makeManager?.() ?? new GeminiCliServerManager();
      const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
      const serverSettingsService = yield* ServerSettingsService;

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

      const service = {
        provider: PROVIDER,
        capabilities: getProviderCapabilities(PROVIDER),
        startSession: (input) =>
          Effect.gen(function* () {
            const providerSettings = yield* serverSettingsService.getSettings.pipe(
              Effect.map((s) => s.providers.geminiCli),
              Effect.mapError(
                (error) =>
                  new ProviderAdapterProcessError({
                    provider: PROVIDER,
                    threadId: input.threadId,
                    detail: error.message,
                    cause: error,
                  }),
              ),
            );
            if (!providerSettings.enabled) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "startSession",
                issue: "Gemini CLI provider is disabled in server settings.",
              });
            }
            manager.binaryPath = providerSettings.binaryPath.trim() || undefined;
            return yield* Effect.tryPromise({
              try: () => manager.startSession(input),
              catch: (cause) => toRequestError(input.threadId, "session/start", cause),
            });
          }),
        sendTurn: (input) => {
          if ((input.attachments?.length ?? 0) > 0) {
            return Effect.fail(
              new ProviderAdapterValidationError({
                provider: PROVIDER,
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
                provider: PROVIDER,
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
      } satisfies GeminiCliAdapterShape;

      return service;
    }),
  );
}

export const GeminiCliAdapterLive = makeGeminiCliAdapterLive();
