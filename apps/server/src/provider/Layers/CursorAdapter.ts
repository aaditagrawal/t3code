/**
 * CursorAdapterLive — Cursor TypeScript SDK runtime.
 *
 * @module CursorAdapterLive
 */

import {
  ApprovalRequestId,
  type CursorSettings,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Crypto from "effect/Crypto";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { type CursorAdapterShape } from "../Services/CursorAdapter.ts";
import { toMessage } from "../toMessage.ts";
import {
  liveCursorSdkClient,
  type CursorSdkAgent,
  type CursorSdkClient,
  type CursorSdkMessage,
  type CursorSdkModelSelection,
  type CursorSdkRun,
  type CursorSdkRunResult,
  type CursorSdkUserMessage,
} from "../cursor/CursorSdkClient.ts";
import {
  cursorSdkApiKey,
  CURSOR_DEFAULT_MODEL,
  CURSOR_RESUME_VERSION,
  toCursorSdkModelSelection,
  toCursorToolItemType,
} from "../cursor/CursorSdkMappings.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";

const PROVIDER = ProviderDriverKind.make("cursor");

export interface CursorAdapterLiveOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
  readonly instanceId?: ProviderInstanceId;
  readonly sdkClient?: CursorSdkClient;
  readonly resolveSettings?: Effect.Effect<CursorSettings>;
}

interface CursorTurnSnapshot {
  readonly id: TurnId;
  readonly items: Array<unknown>;
}

interface CursorTurnStreamState {
  readonly turnId: TurnId;
  readonly runId: string;
  assistantItemStarted: boolean;
  assistantText: string;
  reasoningItemStarted: boolean;
  reasoningText: string;
  readonly seenToolItemIds: Set<string>;
  readonly startedTaskIds: Set<string>;
}

interface CursorSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly agent: CursorSdkAgent;
  readonly turns: Array<CursorTurnSnapshot>;
  readonly pendingRequests: Set<ApprovalRequestId>;
  activeTurnId: TurnId | undefined;
  activeRun: CursorSdkRun | undefined;
  drainFiber: Fiber.Fiber<void, never> | undefined;
  stopped: boolean;
}

function appendTurnItem(context: CursorSessionContext, turnId: TurnId, item: unknown): void {
  const existing = context.turns.find((turn) => turn.id === turnId);
  if (existing) {
    existing.items.push(item);
    return;
  }
  context.turns.push({ id: turnId, items: [item] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCursorResume(raw: unknown): { agentId: string } | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  if (raw.schemaVersion !== CURSOR_RESUME_VERSION) {
    return undefined;
  }
  const agentId = typeof raw.agentId === "string" ? raw.agentId.trim() : "";
  return agentId ? { agentId } : undefined;
}

function previewUnknown(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 2_000) : fallback;
  }
  try {
    const encoded = JSON.stringify(value);
    return typeof encoded === "string" && encoded.length > 0 ? encoded.slice(0, 2_000) : fallback;
  } catch {
    return fallback;
  }
}

function toolDetail(message: Extract<CursorSdkMessage, { type: "tool_call" }>): string | undefined {
  const args = isRecord(message.args) ? message.args : undefined;
  const command =
    typeof args?.command === "string"
      ? args.command
      : typeof args?.cmd === "string"
        ? args.cmd
        : undefined;
  if (command?.trim()) {
    return command.trim().slice(0, 2_000);
  }
  if (message.status === "completed" && message.result !== undefined) {
    return previewUnknown(message.result, "Tool call completed.");
  }
  if (message.status === "error" && message.result !== undefined) {
    return previewUnknown(message.result, "Tool call failed.");
  }
  if (message.args !== undefined) {
    return previewUnknown(message.args, "Tool call running.");
  }
  return undefined;
}

function resultToTurnState(result: CursorSdkRunResult): "completed" | "failed" | "cancelled" {
  switch (result.status) {
    case "cancelled":
      return "cancelled";
    case "error":
      return "failed";
    case "finished":
    default:
      return "completed";
  }
}

function statusToSessionState(
  status: Extract<CursorSdkMessage, { type: "status" }>["status"],
): "running" | "ready" | "error" {
  switch (status) {
    case "CREATING":
    case "RUNNING":
      return "running";
    case "ERROR":
    case "EXPIRED":
      return "error";
    case "FINISHED":
    case "CANCELLED":
    default:
      return "ready";
  }
}

function resolveRunResult(
  run: CursorSdkRun,
): Effect.Effect<CursorSdkRunResult, ProviderAdapterRequestError> {
  if (run.supports("wait")) {
    return Effect.tryPromise({
      try: () => run.wait(),
      catch: (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "run.wait",
          detail: toMessage(cause, "Cursor SDK run wait failed."),
          cause,
        }),
    });
  }

  const status =
    run.status === "cancelled" ? "cancelled" : run.status === "error" ? "error" : "finished";
  return Effect.succeed({
    id: run.id,
    status,
    ...(run.result ? { result: run.result } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
    ...(run.git !== undefined ? { git: run.git } : {}),
  });
}

export function makeCursorAdapter(
  cursorSettings: CursorSettings,
  options?: CursorAdapterLiveOptions,
) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("cursor");
    const sdkClient = options?.sdkClient ?? liveCursorSdkClient;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const serverConfig = yield* ServerConfig;
    const crypto = yield* Crypto.Crypto;
    // UUID generation is treated as infallible (matching the previous
    // Random-based identifiers); a failing system RNG is a defect.
    const randomUUIDv4 = Effect.orDie(crypto.randomUUIDv4);
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;

    const sessions = new Map<ThreadId, CursorSessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const makeEventBase = (input: {
      readonly threadId: ThreadId;
      readonly turnId?: TurnId;
      readonly itemId?: string;
      readonly requestId?: string;
      readonly raw?: CursorSdkMessage;
    }) =>
      Effect.gen(function* () {
        const eventId = EventId.make(yield* randomUUIDv4);
        return {
          eventId,
          provider: PROVIDER,
          providerInstanceId: boundInstanceId,
          threadId: input.threadId,
          createdAt: yield* nowIso,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          ...(input.itemId ? { itemId: RuntimeItemId.make(input.itemId) } : {}),
          ...(input.requestId ? { requestId: RuntimeRequestId.make(input.requestId) } : {}),
          ...(input.raw
            ? {
                raw: {
                  source: "cursor.sdk.message" as const,
                  method: input.raw.type,
                  messageType: input.raw.type,
                  payload: input.raw,
                },
              }
            : {}),
        };
      });

    const emit = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const writeNativeEvent = (
      context: CursorSessionContext,
      message: CursorSdkMessage,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (!nativeEventLogger) {
          return;
        }
        const observedAt = yield* nowIso;
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: yield* randomUUIDv4,
              kind: "sdk_message",
              provider: PROVIDER,
              providerInstanceId: boundInstanceId,
              threadId: context.threadId,
              turnId: context.activeTurnId,
              runId: message.run_id,
              agentId: message.agent_id,
              type: message.type,
              payload: message,
            },
          },
          context.threadId,
        );
      }).pipe(Effect.catchCause(() => Effect.void));

    const getThreadSemaphore = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
        const existing = Option.fromNullishOr(current.get(threadId));
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(threadId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
        });
      });

    const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<CursorSessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(ctx);
    };

    const stopSessionInternal = (ctx: CursorSessionContext, emitExitEvent: boolean) =>
      Effect.gen(function* () {
        if (ctx.stopped) {
          return;
        }
        ctx.stopped = true;
        if (ctx.activeRun?.supports("cancel")) {
          yield* Effect.tryPromise({
            try: () => ctx.activeRun?.cancel() ?? Promise.resolve(),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "run.cancel",
                detail: toMessage(cause, "Cursor SDK cancel failed."),
                cause,
              }),
          }).pipe(Effect.ignore);
        }
        if (ctx.drainFiber) {
          yield* Fiber.interrupt(ctx.drainFiber);
        }
        const asyncDispose = ctx.agent[Symbol.asyncDispose];
        if (asyncDispose) {
          yield* Effect.tryPromise({
            try: () => asyncDispose.call(ctx.agent),
            catch: (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "agent.dispose",
                detail: toMessage(cause, "Cursor SDK agent dispose failed."),
                cause,
              }),
          }).pipe(Effect.ignore);
        } else {
          yield* Effect.sync(() => ctx.agent.close()).pipe(Effect.ignore);
        }
        yield* Scope.close(ctx.scope, Exit.void).pipe(Effect.ignore);
        sessions.delete(ctx.threadId);
        if (emitExitEvent) {
          yield* emit({
            ...(yield* makeEventBase({ threadId: ctx.threadId })),
            type: "session.exited",
            payload: { exitKind: "graceful" },
          });
        }
      });

    const updateSession = (
      context: CursorSessionContext,
      patch: Partial<ProviderSession>,
      options?: { readonly clearActiveTurnId?: boolean; readonly clearLastError?: boolean },
    ) =>
      Effect.gen(function* () {
        const next = {
          ...context.session,
          ...patch,
          updatedAt: yield* nowIso,
        } as ProviderSession & Record<string, unknown>;
        const mutableNext = next as Record<string, unknown>;
        if (options?.clearActiveTurnId) {
          delete mutableNext.activeTurnId;
        }
        if (options?.clearLastError) {
          delete mutableNext.lastError;
        }
        context.session = next;
      });

    const emitAssistantText = Effect.fn("emitAssistantText")(function* (
      context: CursorSessionContext,
      state: CursorTurnStreamState,
      delta: string,
      raw: CursorSdkMessage,
    ) {
      if (delta.length === 0) {
        return;
      }
      const itemId = `cursor-assistant-${state.runId}`;
      if (!state.assistantItemStarted) {
        state.assistantItemStarted = true;
        yield* emit({
          ...(yield* makeEventBase({
            threadId: context.threadId,
            turnId: state.turnId,
            itemId,
            raw,
          })),
          type: "item.started",
          payload: {
            itemType: "assistant_message",
            status: "inProgress",
            title: "Assistant message",
          },
        });
      }
      state.assistantText += delta;
      yield* emit({
        ...(yield* makeEventBase({
          threadId: context.threadId,
          turnId: state.turnId,
          itemId,
          raw,
        })),
        type: "content.delta",
        payload: {
          streamKind: "assistant_text",
          delta,
        },
      });
    });

    const emitReasoningText = Effect.fn("emitReasoningText")(function* (
      context: CursorSessionContext,
      state: CursorTurnStreamState,
      delta: string,
      raw: CursorSdkMessage,
    ) {
      if (delta.length === 0) {
        return;
      }
      const itemId = `cursor-reasoning-${state.runId}`;
      if (!state.reasoningItemStarted) {
        state.reasoningItemStarted = true;
        yield* emit({
          ...(yield* makeEventBase({
            threadId: context.threadId,
            turnId: state.turnId,
            itemId,
            raw,
          })),
          type: "item.started",
          payload: {
            itemType: "reasoning",
            status: "inProgress",
            title: "Reasoning",
          },
        });
      }
      state.reasoningText += delta;
      yield* emit({
        ...(yield* makeEventBase({
          threadId: context.threadId,
          turnId: state.turnId,
          itemId,
          raw,
        })),
        type: "content.delta",
        payload: {
          streamKind: "reasoning_text",
          delta,
        },
      });
    });

    const emitToolCall = Effect.fn("emitToolCall")(function* (
      context: CursorSessionContext,
      state: CursorTurnStreamState,
      message: Extract<CursorSdkMessage, { type: "tool_call" }>,
    ) {
      const itemId = message.call_id;
      const itemType = toCursorToolItemType(message.name);
      if (!state.seenToolItemIds.has(itemId)) {
        state.seenToolItemIds.add(itemId);
        yield* emit({
          ...(yield* makeEventBase({
            threadId: context.threadId,
            turnId: state.turnId,
            itemId,
            raw: message,
          })),
          type: "item.started",
          payload: {
            itemType,
            status: "inProgress",
            title: message.name,
            ...(toolDetail(message) ? { detail: toolDetail(message) } : {}),
            data: message,
          },
        });
      }

      const lifecycleType =
        message.status === "completed" || message.status === "error"
          ? "item.completed"
          : "item.updated";
      yield* emit({
        ...(yield* makeEventBase({
          threadId: context.threadId,
          turnId: state.turnId,
          itemId,
          raw: message,
        })),
        type: lifecycleType,
        payload: {
          itemType,
          status:
            message.status === "error"
              ? "failed"
              : message.status === "completed"
                ? "completed"
                : "inProgress",
          title: message.name,
          ...(toolDetail(message) ? { detail: toolDetail(message) } : {}),
          data: message,
        },
      });
    });

    const handleSdkMessage = Effect.fn("handleSdkMessage")(function* (
      context: CursorSessionContext,
      state: CursorTurnStreamState,
      message: CursorSdkMessage,
    ) {
      appendTurnItem(context, state.turnId, message);
      yield* writeNativeEvent(context, message);

      switch (message.type) {
        case "assistant":
          for (const block of message.message.content) {
            if (block.type === "text") {
              yield* emitAssistantText(context, state, block.text, message);
            } else {
              yield* emit({
                ...(yield* makeEventBase({
                  threadId: context.threadId,
                  turnId: state.turnId,
                  itemId: block.id,
                  raw: message,
                })),
                type: "item.started",
                payload: {
                  itemType: toCursorToolItemType(block.name),
                  status: "inProgress",
                  title: block.name,
                  data: block,
                },
              });
            }
          }
          break;

        case "thinking":
          yield* emitReasoningText(context, state, message.text, message);
          break;

        case "tool_call":
          yield* emitToolCall(context, state, message);
          break;

        case "status": {
          const sessionState = statusToSessionState(message.status);
          yield* updateSession(
            context,
            {
              status: sessionState === "error" ? "error" : sessionState,
              ...(sessionState === "running" ? { activeTurnId: state.turnId } : {}),
              ...(message.status === "ERROR" || message.status === "EXPIRED"
                ? { lastError: message.message ?? `Cursor run ${message.status.toLowerCase()}.` }
                : {}),
            },
            sessionState === "ready" ? { clearActiveTurnId: true } : undefined,
          );
          yield* emit({
            ...(yield* makeEventBase({
              threadId: context.threadId,
              turnId: state.turnId,
              raw: message,
            })),
            type: "session.state.changed",
            payload: {
              state: sessionState,
              ...(message.message ? { reason: message.message } : {}),
            },
          });
          break;
        }

        case "request": {
          const requestId = ApprovalRequestId.make(message.request_id);
          context.pendingRequests.add(requestId);
          yield* emit({
            ...(yield* makeEventBase({
              threadId: context.threadId,
              turnId: state.turnId,
              requestId: message.request_id,
              raw: message,
            })),
            type: "request.opened",
            payload: {
              requestType: "unknown",
              detail:
                "Cursor SDK reported an interactive request. The current SDK does not expose a programmatic response API; answer it in Cursor if prompted.",
              args: message,
            },
          });
          break;
        }

        case "task": {
          const taskId = `cursor-task-${message.run_id}`;
          if (!state.startedTaskIds.has(taskId)) {
            state.startedTaskIds.add(taskId);
            yield* emit({
              ...(yield* makeEventBase({
                threadId: context.threadId,
                turnId: state.turnId,
                raw: message,
              })),
              type: "task.started",
              payload: {
                taskId: RuntimeTaskId.make(taskId),
                ...(message.text ? { description: message.text } : {}),
                taskType: "cursor",
              },
            });
          }
          if (message.text) {
            yield* emit({
              ...(yield* makeEventBase({
                threadId: context.threadId,
                turnId: state.turnId,
                raw: message,
              })),
              type: "task.progress",
              payload: {
                taskId: RuntimeTaskId.make(taskId),
                description: message.text,
                ...(message.status ? { summary: message.status } : {}),
              },
            });
          }
          if (message.status && ["completed", "failed", "stopped"].includes(message.status)) {
            yield* emit({
              ...(yield* makeEventBase({
                threadId: context.threadId,
                turnId: state.turnId,
                raw: message,
              })),
              type: "task.completed",
              payload: {
                taskId: RuntimeTaskId.make(taskId),
                status:
                  message.status === "failed"
                    ? "failed"
                    : message.status === "stopped"
                      ? "stopped"
                      : "completed",
                ...(message.text ? { summary: message.text } : {}),
              },
            });
          }
          break;
        }

        case "system":
        case "user":
        default:
          break;
      }
    });

    const completeTextItems = Effect.fn("completeTextItems")(function* (
      context: CursorSessionContext,
      state: CursorTurnStreamState,
      raw: CursorSdkMessage | undefined,
    ) {
      if (state.reasoningItemStarted) {
        yield* emit({
          ...(yield* makeEventBase({
            threadId: context.threadId,
            turnId: state.turnId,
            itemId: `cursor-reasoning-${state.runId}`,
            ...(raw ? { raw } : {}),
          })),
          type: "item.completed",
          payload: {
            itemType: "reasoning",
            status: "completed",
            title: "Reasoning",
            ...(state.reasoningText ? { detail: state.reasoningText.slice(0, 2_000) } : {}),
          },
        });
      }

      if (state.assistantItemStarted) {
        yield* emit({
          ...(yield* makeEventBase({
            threadId: context.threadId,
            turnId: state.turnId,
            itemId: `cursor-assistant-${state.runId}`,
            ...(raw ? { raw } : {}),
          })),
          type: "item.completed",
          payload: {
            itemType: "assistant_message",
            status: "completed",
            title: "Assistant message",
            ...(state.assistantText ? { detail: state.assistantText.slice(0, 2_000) } : {}),
          },
        });
      }
    });

    const drainCursorRun = Effect.fn("drainCursorRun")(function* (
      context: CursorSessionContext,
      turnId: TurnId,
      run: CursorSdkRun,
    ) {
      const state: CursorTurnStreamState = {
        turnId,
        runId: run.id,
        assistantItemStarted: false,
        assistantText: "",
        reasoningItemStarted: false,
        reasoningText: "",
        seenToolItemIds: new Set(),
        startedTaskIds: new Set(),
      };
      let lastMessage: CursorSdkMessage | undefined;

      if (run.supports("stream")) {
        yield* Stream.fromAsyncIterable(
          run.stream(),
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "run.stream",
              detail: toMessage(cause, "Cursor SDK stream failed."),
              cause,
            }),
        ).pipe(
          Stream.runForEach((message) =>
            Effect.gen(function* () {
              lastMessage = message;
              yield* handleSdkMessage(context, state, message);
            }),
          ),
        );
      }

      const result = yield* resolveRunResult(run);
      if (!state.assistantItemStarted && result.result) {
        yield* emitAssistantText(
          context,
          state,
          result.result,
          lastMessage ?? {
            type: "status",
            agent_id: run.agentId,
            run_id: run.id,
            status: result.status === "cancelled" ? "CANCELLED" : "FINISHED",
          },
        );
      }
      yield* completeTextItems(context, state, lastMessage);

      const turnState = resultToTurnState(result);
      const lastError =
        turnState === "failed" ? (result.result ?? "Cursor SDK run failed.") : undefined;
      context.activeRun = undefined;
      context.activeTurnId = undefined;
      yield* updateSession(
        context,
        {
          status: turnState === "failed" ? "error" : "ready",
          model: result.model?.id ?? context.session.model,
          ...(lastError ? { lastError } : {}),
        },
        {
          clearActiveTurnId: true,
          clearLastError: turnState !== "failed",
        },
      );

      yield* emit({
        ...(yield* makeEventBase({
          threadId: context.threadId,
          turnId,
          ...(lastMessage ? { raw: lastMessage } : {}),
        })),
        type: "turn.completed",
        payload: {
          state: turnState,
          stopReason: result.status,
          ...(result.durationMs !== undefined ? { usage: { durationMs: result.durationMs } } : {}),
          ...(lastError ? { errorMessage: lastError } : {}),
        },
      });
    });

    const handleRunDrainFailure = Effect.fn("handleRunDrainFailure")(function* (
      context: CursorSessionContext,
      turnId: TurnId,
      cause: unknown,
    ) {
      const message = toMessage(cause, "Cursor SDK run failed.");
      context.activeRun = undefined;
      context.activeTurnId = undefined;
      yield* updateSession(
        context,
        {
          status: "error",
          lastError: message,
        },
        { clearActiveTurnId: true },
      );
      yield* emit({
        ...(yield* makeEventBase({ threadId: context.threadId, turnId })),
        type: "runtime.error",
        payload: {
          message,
          class: "provider_error",
          detail: cause,
        },
      });
      yield* emit({
        ...(yield* makeEventBase({ threadId: context.threadId, turnId })),
        type: "turn.completed",
        payload: {
          state: "failed",
          errorMessage: message,
        },
      });
    });

    const buildUserMessage = Effect.fn("buildUserMessage")(function* (
      input: Parameters<CursorAdapterShape["sendTurn"]>[0],
    ): Effect.fn.Return<
      string | CursorSdkUserMessage,
      ProviderAdapterRequestError | ProviderAdapterValidationError
    > {
      const text = input.input?.trim() ?? "";
      const images: Array<Exclude<CursorSdkUserMessage["images"], undefined>[number]> = [];
      for (const attachment of input.attachments ?? []) {
        if (attachment.type !== "image") {
          continue;
        }
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "agent.send",
            detail: `Invalid attachment id '${attachment.id}'.`,
          });
        }
        const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "agent.send",
                detail: cause.message,
                cause,
              }),
          ),
        );
        images.push({
          data: Buffer.from(bytes).toString("base64"),
          mimeType: attachment.mimeType,
        });
      }

      if (text.length === 0 && images.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Turn requires non-empty text or attachments.",
        });
      }

      const promptText =
        input.interactionMode === "plan" && text.length > 0
          ? `Plan the requested change. Do not edit files until the user asks to implement it.\n\n${text}`
          : text.length > 0
            ? text
            : "Please respond to the attached image.";
      return images.length > 0 ? { text: promptText, images } : promptText;
    });

    const startSession: CursorAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          const effectiveCursorSettings = options?.resolveSettings
            ? yield* options.resolveSettings
            : cursorSettings;
          if (!effectiveCursorSettings.enabled) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "Cursor provider is disabled.",
            });
          }
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          if (!input.cwd?.trim()) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }
          const apiKey = cursorSdkApiKey(options?.environment);
          if (!apiKey) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "CURSOR_API_KEY is required for Cursor SDK sessions.",
            });
          }

          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing, true).pipe(Effect.ignore);
          }

          const cwd = path.resolve(input.cwd.trim());
          const sessionScope = yield* Scope.make("sequential");
          let sessionScopeTransferred = false;
          yield* Effect.addFinalizer(() =>
            sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );

          const selectedModel =
            input.modelSelection?.instanceId === boundInstanceId
              ? toCursorSdkModelSelection(input.modelSelection.model, input.modelSelection.options)
              : toCursorSdkModelSelection(CURSOR_DEFAULT_MODEL);
          const resume = parseCursorResume(input.resumeCursor);
          const agentOptions = {
            apiKey,
            model: selectedModel,
            name: `T3 Code ${input.threadId}`,
            local: {
              cwd,
              settingSources: ["all"] as const,
              sandboxOptions: {
                enabled: input.runtimeMode !== "full-access",
              },
            },
          };

          const agent = yield* Effect.tryPromise({
            try: () =>
              resume
                ? sdkClient.resumeAgent(resume.agentId, agentOptions)
                : sdkClient.createAgent(agentOptions),
            catch: (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: input.threadId,
                detail: toMessage(cause, "Failed to start Cursor SDK agent."),
                cause,
              }),
          });

          const now = yield* nowIso;
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            model: selectedModel.id,
            threadId: input.threadId,
            resumeCursor: {
              schemaVersion: CURSOR_RESUME_VERSION,
              agentId: agent.agentId,
            },
            createdAt: now,
            updatedAt: now,
          };

          const context: CursorSessionContext = {
            threadId: input.threadId,
            session,
            scope: sessionScope,
            agent,
            turns: [],
            pendingRequests: new Set(),
            activeTurnId: undefined,
            activeRun: undefined,
            drainFiber: undefined,
            stopped: false,
          };
          sessions.set(input.threadId, context);
          sessionScopeTransferred = true;

          yield* emit({
            ...(yield* makeEventBase({ threadId: input.threadId })),
            type: "session.started",
            payload: {
              ...(input.resumeCursor !== undefined ? { resume: input.resumeCursor } : {}),
              message: "Cursor SDK session started",
            },
          });
          yield* emit({
            ...(yield* makeEventBase({ threadId: input.threadId })),
            type: "session.configured",
            payload: {
              config: {
                model: selectedModel,
                cwd,
                runtime: "local",
                sdk: "@cursor/sdk",
              },
            },
          });
          yield* emit({
            ...(yield* makeEventBase({ threadId: input.threadId })),
            type: "session.state.changed",
            payload: {
              state: "ready",
              reason: "Cursor SDK session ready",
            },
          });
          yield* emit({
            ...(yield* makeEventBase({ threadId: input.threadId })),
            type: "thread.started",
            payload: {
              providerThreadId: agent.agentId,
            },
          });

          return session;
        }).pipe(Effect.scoped),
      );

    const sendTurn: CursorAdapterShape["sendTurn"] = Effect.fn("sendTurn")(function* (input) {
      const context = yield* requireSession(input.threadId);
      if (context.activeRun !== undefined || context.activeTurnId !== undefined) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "agent.send",
          detail: "Cursor SDK session already has an active run.",
        });
      }

      const modelSelection =
        input.modelSelection?.instanceId === boundInstanceId ? input.modelSelection : undefined;
      const sdkModel: CursorSdkModelSelection =
        modelSelection !== undefined
          ? toCursorSdkModelSelection(modelSelection.model, modelSelection.options)
          : toCursorSdkModelSelection(context.session.model ?? CURSOR_DEFAULT_MODEL);
      const message = yield* buildUserMessage(input);
      const turnId = TurnId.make(yield* randomUUIDv4);

      context.activeTurnId = turnId;
      yield* updateSession(
        context,
        {
          status: "running",
          activeTurnId: turnId,
          model: sdkModel.id,
        },
        { clearLastError: true },
      );
      yield* emit({
        ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
        type: "turn.started",
        payload: {
          model: sdkModel.id,
        },
      });

      const run = yield* Effect.tryPromise({
        try: () =>
          context.agent.send(message, {
            model: sdkModel,
            idempotencyKey: `${input.threadId}:${turnId}`,
          }),
        catch: (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "agent.send",
            detail: toMessage(cause, "Cursor SDK send failed."),
            cause,
          }),
      }).pipe(
        Effect.tapError((requestError) =>
          Effect.gen(function* () {
            context.activeTurnId = undefined;
            yield* updateSession(
              context,
              {
                status: "ready",
                lastError: requestError.detail,
              },
              { clearActiveTurnId: true },
            );
            yield* emit({
              ...(yield* makeEventBase({ threadId: input.threadId, turnId })),
              type: "turn.aborted",
              payload: {
                reason: requestError.detail,
              },
            });
          }),
        ),
      );

      context.activeRun = run;
      appendTurnItem(context, turnId, { prompt: message, runId: run.id, model: sdkModel });
      const drainFiber = yield* drainCursorRun(context, turnId, run).pipe(
        Effect.catch((cause) => handleRunDrainFailure(context, turnId, cause)),
        Effect.catchCause((cause) => handleRunDrainFailure(context, turnId, Cause.squash(cause))),
        Effect.forkIn(context.scope),
      );
      context.drainFiber = drainFiber;
      drainFiber.addObserver(() => {
        if (context.drainFiber === drainFiber) {
          context.drainFiber = undefined;
        }
      });

      return {
        threadId: context.threadId,
        turnId,
        resumeCursor: context.session.resumeCursor,
      };
    });

    const interruptTurn: CursorAdapterShape["interruptTurn"] = Effect.fn("interruptTurn")(
      function* (threadId, turnId) {
        const context = yield* requireSession(threadId);
        const activeRun = context.activeRun;
        if (!activeRun?.supports("cancel")) {
          return;
        }
        yield* Effect.tryPromise({
          try: () => activeRun.cancel(),
          catch: (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "run.cancel",
              detail: toMessage(cause, "Cursor SDK cancel failed."),
              cause,
            }),
        });
        const interruptedTurnId = turnId ?? context.activeTurnId;
        yield* emit({
          ...(yield* makeEventBase(
            interruptedTurnId ? { threadId, turnId: interruptedTurnId } : { threadId },
          )),
          type: "turn.aborted",
          payload: {
            reason: "Interrupted by user.",
          },
        });
      },
    );

    const respondToRequest: CursorAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      _decision,
    ) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!context.pendingRequests.has(requestId)) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "request.respond",
            detail: `Unknown pending Cursor SDK request: ${requestId}`,
          });
        }
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "request.respond",
          detail:
            "Cursor SDK does not expose a programmatic response API for interactive requests.",
        });
      });

    const respondToUserInput: CursorAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      _answers,
    ) =>
      Effect.gen(function* () {
        yield* requireSession(threadId);
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "userInput.respond",
          detail: `Cursor SDK does not expose a structured user-input response API: ${requestId}`,
        });
      });

    const readThread: CursorAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        return {
          threadId,
          turns: context.turns,
        };
      });

    const rollbackThread: CursorAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const context = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        context.turns.splice(Math.max(0, context.turns.length - numTurns));
        return {
          threadId,
          turns: context.turns,
        };
      });

    const stopSession: CursorAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const context = yield* requireSession(threadId);
          yield* stopSessionInternal(context, true);
        }),
      );

    const listSessions: CursorAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (context) => ({ ...context.session })));

    const hasSession: CursorAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const context = sessions.get(threadId);
        return context !== undefined && !context.stopped;
      });

    const stopAll: CursorAdapterShape["stopAll"] = () =>
      Effect.forEach(sessions.values(), (context) => stopSessionInternal(context, true), {
        discard: true,
      });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions.values(), (context) => stopSessionInternal(context, false), {
        discard: true,
      }).pipe(
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies CursorAdapterShape;
  });
}
