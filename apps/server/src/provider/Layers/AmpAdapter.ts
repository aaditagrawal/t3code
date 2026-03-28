import { type ProviderRuntimeEvent } from "@t3tools/contracts";
import { Effect, Layer, Queue, Stream } from "effect";

import { AmpServerManager } from "../../ampServerManager.ts";
import { ProviderAdapterProcessError, ProviderAdapterValidationError } from "../Errors.ts";
import { getProviderCapabilities } from "../Services/ProviderAdapter.ts";
import { AmpAdapter, type AmpAdapterShape } from "../Services/AmpAdapter.ts";
import { makeErrorHelpers } from "./ProviderAdapterUtils.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const PROVIDER = "amp" as const;
const { toRequestError } = makeErrorHelpers(PROVIDER);

export interface AmpAdapterLiveOptions {
  readonly manager?: AmpServerManager;
  readonly makeManager?: () => AmpServerManager;
}

export function makeAmpAdapterLive(options: AmpAdapterLiveOptions = {}) {
  return Layer.effect(
    AmpAdapter,
    Effect.gen(function* () {
      const manager = options.manager ?? options.makeManager?.() ?? new AmpServerManager();
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
              Effect.map((s) => s.providers.amp),
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
                issue: "AMP provider is disabled in server settings.",
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
      } satisfies AmpAdapterShape;

      return service;
    }),
  );
}

export const AmpAdapterLive = makeAmpAdapterLive();
