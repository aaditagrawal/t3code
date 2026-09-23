import {
  HERMES_DRIVER_KIND,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { IdAllocatorV2 } from "./IdAllocator.ts";
import type { PendingOrchestrationEffectV2 } from "./EffectOutbox.ts";

export class HermesNotificationDeliveryError extends Schema.TaggedError<HermesNotificationDeliveryError>()(
  "HermesNotificationDeliveryError",
  { detail: Schema.String },
) {}

export const HERMES_NOTIFICATION_RECORDS = [
  "runs",
  "attempts",
  "providerThreads",
  "providerTurns",
  "providerSessions",
  "messages",
  "turnItems",
] as const;

/** Called under the V2 thread command lock and durable command-receipt fence. */
export const planHermesNotificationDelivery = Effect.fn("planHermesNotificationDelivery")(
  function* (input: {
    readonly command: Extract<
      OrchestrationV2Command,
      { readonly type: "thread.notification.deliver" }
    >;
    readonly projection: Pick<
      OrchestrationV2ThreadProjection,
      "thread" | (typeof HERMES_NOTIFICATION_RECORDS)[number]
    >;
    readonly now: DateTime.Utc;
    readonly idAllocator: IdAllocatorV2["Service"];
  }) {
    const { command, projection, now, idAllocator } = input;
    const thread = projection.thread;
    if (
      thread.deletedAt !== null ||
      thread.providerInstanceId !== command.expectedProviderInstanceId ||
      thread.modelSelection.instanceId !== command.expectedProviderInstanceId
    ) {
      return yield* new HermesNotificationDeliveryError({
        detail: "Notification destination is no longer owned by the sending provider instance.",
      });
    }
    const existing = projection.messages.find((message) => message.id === command.messageId);
    const eventBase = () =>
      idAllocator.allocate.event({ threadId: command.threadId, commandId: command.commandId });
    // Stable message IDs also prevent duplication if a caller changes its command ID.
    // Re-emitting the immutable row is an acknowledged no-op; never replace its text.
    if (existing) {
      const event: OrchestrationV2DomainEvent = {
        id: yield* eventBase(),
        type: "message.updated",
        threadId: command.threadId,
        providerInstanceId: command.expectedProviderInstanceId,
        occurredAt: now,
        payload: existing,
      };
      return { events: [event], effects: [] satisfies Array<PendingOrchestrationEffectV2> };
    }
    const providerTurn =
      command.turnId === undefined
        ? undefined
        : projection.providerTurns.find((turn) => turn.nativeTurnRef?.nativeId === command.turnId);
    const providerThread =
      providerTurn === undefined
        ? undefined
        : projection.providerThreads.find(
            (candidate) => candidate.id === providerTurn.providerThreadId,
          );
    const providerSession =
      providerThread?.providerSessionId == null
        ? undefined
        : projection.providerSessions.find(
            (session) => session.id === providerThread.providerSessionId,
          );
    const attempt =
      providerTurn?.runAttemptId == null
        ? undefined
        : projection.attempts.find((candidate) => candidate.id === providerTurn.runAttemptId);
    const run =
      attempt === undefined
        ? undefined
        : projection.runs.find((candidate) => candidate.id === attempt.runId);
    if (
      command.turnId !== undefined &&
      (providerTurn?.status !== "running" ||
        providerThread?.providerInstanceId !== command.expectedProviderInstanceId ||
        providerThread.driver !== HERMES_DRIVER_KIND ||
        providerSession === undefined ||
        providerSession.status === "stopped" ||
        providerSession.status === "error" ||
        run === undefined)
    ) {
      return yield* new HermesNotificationDeliveryError({
        detail: "Turn-scoped notification does not belong to a live Hermes turn on this thread.",
      });
    }
    const createdAt = DateTime.makeUnsafe(command.createdAt);
    const message: OrchestrationV2ConversationMessage = {
      id: command.messageId,
      threadId: command.threadId,
      runId: run?.id ?? null,
      nodeId: providerTurn?.nodeId ?? null,
      role: "assistant",
      text: `> ${command.label}\n\n${command.text}`,
      attachments: command.attachments ?? [],
      streaming: false,
      createdBy: "agent",
      creationSource: "provider",
      createdAt,
      updatedAt: createdAt,
    };
    const events: Array<OrchestrationV2DomainEvent> = [];
    events.push({
      id: yield* eventBase(),
      type: "thread.metadata-updated",
      threadId: command.threadId,
      providerInstanceId: command.expectedProviderInstanceId,
      occurredAt: now,
      payload: {
        ...thread,
        updatedAt: now,
        ...(command.kind === "lifecycle"
          ? {}
          : {
              settledOverride: thread.settledOverride === "settled" ? null : thread.settledOverride,
              ...(thread.settledOverride === "settled"
                ? { settledAt: null, unsettledAt: now }
                : {}),
              snoozedUntil: null,
              snoozedAt: null,
            }),
      },
    });
    events.push({
      id: yield* eventBase(),
      type: "message.updated",
      threadId: command.threadId,
      ...(run ? { runId: run.id } : {}),
      ...(providerTurn ? { nodeId: providerTurn.nodeId } : {}),
      providerInstanceId: command.expectedProviderInstanceId,
      occurredAt: now,
      payload: message,
    });
    const nativeItemId = `hermes-delivery:${command.expectedProviderInstanceId}:${command.deliveryId}`;
    events.push({
      id: yield* eventBase(),
      type: "turn-item.updated",
      threadId: command.threadId,
      ...(run ? { runId: run.id } : {}),
      ...(providerTurn ? { nodeId: providerTurn.nodeId } : {}),
      providerInstanceId: command.expectedProviderInstanceId,
      occurredAt: now,
      payload: {
        id: idAllocator.derive.turnItemFromProviderItem({
          driver: HERMES_DRIVER_KIND,
          nativeItemId,
        }),
        type: "assistant_message",
        threadId: command.threadId,
        runId: run?.id ?? null,
        nodeId: providerTurn?.nodeId ?? null,
        providerThreadId: providerThread?.id ?? null,
        providerTurnId: providerTurn?.id ?? null,
        nativeItemRef: { driver: HERMES_DRIVER_KIND, nativeId: nativeItemId, strength: "strong" },
        parentItemId: null,
        ordinal: projection.turnItems.reduce(
          (maximum, item) =>
            item.providerTurnId === (providerTurn?.id ?? null)
              ? Math.max(maximum, item.ordinal + 1)
              : maximum,
          0,
        ),
        status: "completed",
        title: command.label,
        startedAt: createdAt,
        completedAt: createdAt,
        updatedAt: createdAt,
        messageId: command.messageId,
        text: message.text,
        attachments: message.attachments,
        streaming: false,
      },
    });
    return { events, effects: [] satisfies Array<PendingOrchestrationEffectV2> };
  },
);
