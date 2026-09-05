import * as NodeCrypto from "node:crypto";
import {
  type AskUserRequestParams,
  type AskUserResult,
  createSession,
  type MessageOptions,
  resumeSession,
  ToolConfirmationOutcome,
  type RequestPermissionRequestParams,
} from "@factory/droid-sdk";
import {
  ApprovalRequestId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type DroidSettings,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@t3tools/contracts";
import { getModelSelectionStringOptionValue } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { resolveDroidImages } from "../droid/DroidAttachmentResolver.ts";
import {
  DROID_PROVIDER,
  type DroidAdapterOptions,
  type DroidAdapterShape,
  type DroidContext,
} from "../droid/DroidAdapterTypes.ts";
import {
  handleDroidMessage,
  makeDroidEventBase,
  nowIso,
  updateDroidContextSession,
} from "../droid/DroidRuntimeEvents.ts";
import {
  DroidInteractionMode,
  normalizeAskUserQuestions,
  permissionDetail,
  toAskUserResult,
  toAutonomyLevel,
  toAutonomyLevelForRuntimeMode,
  toModelId,
  toOutcome,
  toReasoningEffort,
  toRequestType,
} from "../droid/DroidSdkMappings.ts";

export type { DroidAdapterOptions } from "../droid/DroidAdapterTypes.ts";

export function makeDroidAdapter(settings: DroidSettings, options?: DroidAdapterOptions) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const serverConfig = yield* ServerConfig;
    const sdk = options?.sdk ?? { createSession, resumeSession };
    const instanceId = options?.instanceId ?? ProviderInstanceId.make("droid");
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const sessions = new Map<ThreadId, DroidContext>();
    const env = Object.fromEntries(
      Object.entries({ ...process.env, ...options?.environment }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    const runtimeContext = yield* Effect.context<never>();
    const runPromise = Effect.runPromiseWith(runtimeContext);
    const emit = (event: ProviderRuntimeEvent) =>
      Queue.offer(runtimeEvents, event).pipe(Effect.asVoid);
    const emitNow = (event: ProviderRuntimeEvent) => runPromise(emit(event));
    const eventBase = makeDroidEventBase(instanceId);
    const settlePendingInteractions = (context: DroidContext) =>
      Effect.gen(function* () {
        for (const [requestId, pending] of context.pendingPermissions) {
          context.pendingPermissions.delete(requestId);
          pending.resolve(ToolConfirmationOutcome.Cancel);
          yield* emit({
            ...eventBase(context, { requestId }),
            type: "request.resolved",
            payload: { requestType: pending.requestType, decision: "cancel" },
          });
        }
        for (const [requestId, pending] of context.pendingUserInputs) {
          context.pendingUserInputs.delete(requestId);
          pending.resolve({ cancelled: true, answers: [] });
          yield* emit({
            ...eventBase(context, { requestId }),
            type: "user-input.resolved",
            payload: { answers: {} },
          });
        }
      });
    const abortContext = (context: DroidContext) =>
      Effect.gen(function* () {
        context.activeAbort?.abort();
        context.activeAbort = undefined;
        yield* settlePendingInteractions(context);
      });
    const closeContext = (context: DroidContext) =>
      Effect.gen(function* () {
        yield* abortContext(context);
        yield* Effect.tryPromise(() => context.droid.close()).pipe(Effect.ignore);
      });

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        const contexts = [...sessions.values()];
        sessions.clear();
        yield* Effect.forEach(contexts, (context) => closeContext(context), {
          concurrency: "unbounded",
          discard: true,
        });
        yield* Queue.shutdown(runtimeEvents);
      }),
    );

    const requireSession = Effect.fn("requireDroidSession")(function* (threadId: ThreadId) {
      const context = sessions.get(threadId);
      if (!context) {
        return yield* new ProviderAdapterSessionNotFoundError({
          provider: DROID_PROVIDER,
          threadId,
        });
      }
      return context;
    });

    const startSession: DroidAdapterShape["startSession"] = Effect.fn("startDroidSession")(
      function* (input) {
        const existingContext = sessions.get(input.threadId);
        if (existingContext) {
          sessions.delete(input.threadId);
          yield* closeContext(existingContext);
        }

        let contextRef: DroidContext | undefined;
        const permissionHandler = (params: RequestPermissionRequestParams) =>
          new Promise<ToolConfirmationOutcome>((resolve) => {
            const context = contextRef;
            if (!context) {
              resolve(ToolConfirmationOutcome.Cancel);
              return;
            }
            const requestId = ApprovalRequestId.make(`droid-${NodeCrypto.randomUUID()}`);
            const requestType = toRequestType(params);
            context.pendingPermissions.set(requestId, { requestType, resolve });
            void emitNow({
              ...eventBase(context, { requestId, raw: params }),
              raw: { source: "droid.sdk.permission", payload: params },
              type: "request.opened",
              payload: {
                requestType,
                detail: permissionDetail(params),
                args: params,
              },
            });
          });
        const askUserHandler = (params: AskUserRequestParams) =>
          new Promise<AskUserResult>((resolve) => {
            const context = contextRef;
            if (!context) {
              resolve({ cancelled: true, answers: [] });
              return;
            }
            const requestId = ApprovalRequestId.make(`droid-question-${NodeCrypto.randomUUID()}`);
            const questions = normalizeAskUserQuestions(params);
            context.pendingUserInputs.set(requestId, {
              questions,
              droidQuestions: params.questions,
              resolve,
            });
            void emitNow({
              ...eventBase(context, { requestId, raw: params }),
              raw: { source: "droid.sdk.permission", payload: params },
              type: "user-input.requested",
              payload: { questions },
            });
          });
        const modelSelection = input.modelSelection;
        const modelId = toModelId(modelSelection?.model);
        const sdkOptions = {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          execPath: settings.binaryPath,
          env,
          permissionHandler,
          askUserHandler,
        };
        const reasoningEffort = toReasoningEffort(
          getModelSelectionStringOptionValue(modelSelection, "reasoningEffort"),
        );
        const droid = yield* Effect.tryPromise({
          try: async () => {
            if (typeof input.resumeCursor === "string") {
              const resumed = await sdk.resumeSession(input.resumeCursor, sdkOptions);
              await resumed.updateSettings({ autonomyLevel: toAutonomyLevel(input) });
              return resumed;
            }
            return sdk.createSession({
              ...sdkOptions,
              ...(modelId ? { modelId } : {}),
              autonomyLevel: toAutonomyLevel(input),
              interactionMode: DroidInteractionMode.Auto,
              ...(reasoningEffort ? { reasoningEffort } : {}),
            });
          },
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: DROID_PROVIDER,
              method: "createSession",
              detail: cause instanceof Error ? cause.message : "Failed to start Droid session.",
              cause,
            }),
        });
        const session: ProviderSession = {
          provider: DROID_PROVIDER,
          providerInstanceId: instanceId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          ...(input.cwd ? { cwd: input.cwd } : {}),
          model: modelSelection?.model ?? "default",
          threadId: input.threadId,
          resumeCursor: droid.sessionId,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        const context: DroidContext = {
          session,
          droid,
          pendingPermissions: new Map(),
          pendingUserInputs: new Map(),
          turns: [],
          activeAbort: undefined,
          activeAssistantItems: new Map(),
          activeThinkingItems: new Map(),
          activeCompletedAssistantItems: new Set(),
          activeTurnError: undefined,
          activeTokenUsage: undefined,
          activeTokenUsageBaseline: undefined,
          cumulativeTokenUsage: undefined,
        };
        contextRef = context;
        sessions.set(input.threadId, context);

        yield* emit({
          ...eventBase(context),
          type: "session.started",
          payload: { message: "Droid SDK session started" },
        });
        yield* emit({
          ...eventBase(context),
          type: "thread.started",
          payload: { providerThreadId: droid.sessionId },
        });
        return session;
      },
    );

    const sendTurn: DroidAdapterShape["sendTurn"] = Effect.fn("sendDroidTurn")(function* (input) {
      const context = sessions.get(input.threadId);
      if (!context) {
        return yield* new ProviderAdapterValidationError({
          provider: DROID_PROVIDER,
          operation: "sendTurn",
          issue: `Unknown Droid thread: ${input.threadId}`,
        });
      }
      if (context.session.status === "running" || context.session.activeTurnId) {
        return yield* new ProviderAdapterValidationError({
          provider: DROID_PROVIDER,
          operation: "sendTurn",
          issue: `Droid thread ${input.threadId} already has an active turn.`,
        });
      }
      const text = input.input?.trim();
      const images = yield* resolveDroidImages(input.attachments ?? [], {
        attachmentsDir: serverConfig.attachmentsDir,
        fileSystem,
      });
      if (!text && images.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: DROID_PROVIDER,
          operation: "sendTurn",
          issue: "Droid turns require text input or at least one attachment.",
        });
      }

      const turnId = TurnId.make(`droid-turn-${NodeCrypto.randomUUID()}`);
      const abort = new AbortController();
      context.activeAbort = abort;
      context.activeAssistantItems = new Map();
      context.activeThinkingItems = new Map();
      context.activeCompletedAssistantItems = new Set();
      context.activeTurnError = undefined;
      context.activeTokenUsage = undefined;
      context.activeTokenUsageBaseline = context.cumulativeTokenUsage;
      context.turns.push({ id: turnId, items: [] });
      updateDroidContextSession(context, {
        status: "running",
        activeTurnId: turnId,
        model: input.modelSelection?.model ?? context.session.model,
      });

      yield* emit({
        ...eventBase(context, { turnId }),
        type: "turn.started",
        payload: { model: context.session.model },
      });

      yield* Effect.promise(async () => {
        try {
          const modelId = toModelId(input.modelSelection?.model);
          const reasoningEffort = toReasoningEffort(
            getModelSelectionStringOptionValue(input.modelSelection, "reasoningEffort"),
          );
          const autonomyLevel = toAutonomyLevelForRuntimeMode(context.session.runtimeMode);
          if (input.interactionMode === "plan") {
            await context.droid.enterSpecMode({
              ...(modelId ? { specModeModelId: modelId } : {}),
              ...(reasoningEffort ? { specModeReasoningEffort: reasoningEffort } : {}),
            });
          }
          await context.droid.updateSettings({
            autonomyLevel,
            ...(modelId ? { modelId } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
            ...(input.interactionMode === "plan" && modelId ? { specModeModelId: modelId } : {}),
            ...(input.interactionMode === "plan" && reasoningEffort
              ? { specModeReasoningEffort: reasoningEffort }
              : {}),
          });
          const messageOptions: MessageOptions = {
            abortSignal: abort.signal,
            ...(images.length > 0 ? { images } : {}),
          };
          for await (const message of context.droid.stream(
            text || "Please respond to the attached image.",
            messageOptions,
          )) {
            await handleDroidMessage({ context, turnId, message, eventBase, emitNow });
          }
          if (context.activeTurnError) {
            const message = context.activeTurnError;
            context.activeAbort = undefined;
            updateDroidContextSession(context, {
              status: "error",
              activeTurnId: undefined,
              lastError: message,
            });
            await emitNow({
              ...eventBase(context, { turnId }),
              type: "turn.completed",
              payload: { state: "failed", errorMessage: message },
            });
            return;
          }
          for (const [itemId, detail] of context.activeAssistantItems) {
            if (context.activeCompletedAssistantItems.has(itemId)) {
              continue;
            }
            await emitNow({
              ...eventBase(context, { turnId, itemId }),
              type: "item.completed",
              payload: { itemType: "assistant_message", status: "completed", detail },
            });
          }
          context.activeAbort = undefined;
          updateDroidContextSession(context, { status: "ready", activeTurnId: undefined });
          await emitNow({
            ...eventBase(context, { turnId }),
            type: "turn.completed",
            payload: {
              state: "completed",
              ...(context.activeTokenUsage ? { usage: context.activeTokenUsage } : {}),
            },
          });
        } catch (cause) {
          if (abort.signal.aborted) {
            context.activeAbort = undefined;
            updateDroidContextSession(context, { status: "ready", activeTurnId: undefined });
            await emitNow({
              ...eventBase(context, { turnId }),
              type: "turn.completed",
              payload: { state: "interrupted" },
            });
            return;
          }
          const message = cause instanceof Error ? cause.message : "Droid turn failed.";
          context.activeAbort = undefined;
          updateDroidContextSession(context, {
            status: "error",
            activeTurnId: undefined,
            lastError: message,
          });
          await emitNow({
            ...eventBase(context, { turnId }),
            type: "runtime.error",
            payload: { message, class: "provider_error" },
          });
          await emitNow({
            ...eventBase(context, { turnId }),
            type: "turn.completed",
            payload: { state: "failed", errorMessage: message },
          });
        }
      }).pipe(Effect.forkDetach);

      return { threadId: input.threadId, turnId, resumeCursor: context.droid.sessionId };
    });

    const stopSession = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const context = sessions.get(threadId);
        if (!context) return;
        sessions.delete(threadId);
        yield* closeContext(context);
        yield* emit({
          ...eventBase(context),
          type: "session.exited",
          payload: { reason: "Session stopped", recoverable: false, exitKind: "graceful" },
        });
      });

    return {
      provider: DROID_PROVIDER,
      capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
      startSession,
      sendTurn,
      interruptTurn: (threadId) =>
        Effect.gen(function* () {
          const context = sessions.get(threadId);
          if (!context) return;
          yield* abortContext(context);
          yield* Effect.tryPromise(() => context.droid.interrupt()).pipe(Effect.ignore);
        }),
      respondToRequest: (threadId, requestId, decision) =>
        Effect.gen(function* () {
          const context = sessions.get(threadId);
          const pending = context?.pendingPermissions.get(requestId);
          if (!context || !pending) {
            return yield* new ProviderAdapterRequestError({
              provider: DROID_PROVIDER,
              method: "respondToRequest",
              detail: `Unknown pending Droid permission request: ${requestId}`,
            });
          }
          context.pendingPermissions.delete(requestId);
          pending.resolve(toOutcome(decision));
          yield* emit({
            ...eventBase(context, { requestId }),
            type: "request.resolved",
            payload: { requestType: pending.requestType, decision },
          });
        }),
      respondToUserInput: (threadId, requestId, answers) =>
        Effect.gen(function* () {
          const context = sessions.get(threadId);
          const pending = context?.pendingUserInputs.get(requestId);
          if (!context || !pending) {
            return yield* new ProviderAdapterRequestError({
              provider: DROID_PROVIDER,
              method: "respondToUserInput",
              detail: `Unknown pending Droid user-input request: ${requestId}`,
            });
          }
          context.pendingUserInputs.delete(requestId);
          pending.resolve(toAskUserResult(pending.droidQuestions, answers));
          yield* emit({
            ...eventBase(context, { requestId }),
            type: "user-input.resolved",
            payload: { answers },
          });
        }),
      stopSession,
      listSessions: () => Effect.succeed([...sessions.values()].map((context) => context.session)),
      hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
      readThread: (threadId) =>
        Effect.gen(function* () {
          const context = yield* requireSession(threadId);
          return { threadId, turns: context.turns };
        }),
      rollbackThread: (threadId, numTurns) =>
        Effect.gen(function* () {
          yield* requireSession(threadId);
          if (!Number.isInteger(numTurns) || numTurns < 1) {
            return yield* new ProviderAdapterValidationError({
              provider: DROID_PROVIDER,
              operation: "rollbackThread",
              issue: "numTurns must be an integer >= 1.",
            });
          }
          return yield* new ProviderAdapterRequestError({
            provider: DROID_PROVIDER,
            method: "rollbackThread",
            detail:
              "Droid rollback requires provider-native rewind/fork support and is not yet wired into T3 Code.",
          });
        }),
      stopAll: () =>
        Effect.forEach([...sessions.keys()], stopSession, {
          concurrency: "unbounded",
          discard: true,
        }),
      get streamEvents() {
        return Stream.fromQueue(runtimeEvents);
      },
    } satisfies DroidAdapterShape;
  });
}
