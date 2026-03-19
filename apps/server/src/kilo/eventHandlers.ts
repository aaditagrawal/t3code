import { randomUUID } from "node:crypto";

import { ApprovalRequestId, RuntimeItemId, RuntimeRequestId } from "@t3tools/contracts";

import { sessionErrorClass, sessionErrorIsRetryable, sessionErrorMessage } from "./errors.ts";
import type {
  EventCommandExecuted,
  EventFileEdited,
  EventMessagePartDelta,
  EventMessagePartUpdated,
  EventPermissionAsked,
  EventPermissionReplied,
  EventQuestionAsked,
  EventQuestionRejected,
  EventQuestionReplied,
  EventSessionCompacted,
  EventSessionDiff,
  EventSessionError,
  EventSessionIdle,
  EventSessionStatus,
  EventSessionUpdated,
  EventTodoUpdated,
  EventVcsBranchUpdated,
  KiloEvent,
  KiloProviderRuntimeEvent,
  KiloSessionContext,
  KiloToolPart,
  QuestionInfo,
} from "./types.ts";
import { PROVIDER } from "./types.ts";
import {
  eventId,
  fileDiffsToUnifiedDiff,
  nowIso,
  stripTransientSessionFields,
  todoPriorityPrefix,
  toKiloRequestType,
  toPlanStepStatus,
  toToolItemType,
  toToolLifecycleEventType,
  toToolTitle,
  toolStateDetail,
  toolStateTitle,
} from "./utils.ts";

type EventEmitter = {
  emitRuntimeEvent(event: KiloProviderRuntimeEvent): void;
};

function normalizeToolDetail(detail: string | undefined): string | undefined {
  const trimmed = detail?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Dispatches an Kilo SSE event to the appropriate handler.
 */
export function handleEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: KiloEvent,
): void {
  switch (event.type) {
    case "session.status":
      handleSessionStatusEvent(emitter, context, event);
      return;
    case "session.idle":
      handleSessionIdleEvent(emitter, context, event);
      return;
    case "session.diff":
      handleSessionDiffEvent(emitter, context, event);
      return;
    case "session.error":
      handleSessionErrorEvent(emitter, context, event);
      return;
    case "session.compacted":
      handleSessionCompactedEvent(emitter, context, event);
      return;
    case "session.updated":
      handleSessionUpdatedEvent(emitter, context, event);
      return;
    case "permission.asked":
      handlePermissionAskedEvent(emitter, context, event);
      return;
    case "permission.replied":
      handlePermissionRepliedEvent(emitter, context, event);
      return;
    case "question.asked":
      handleQuestionAskedEvent(emitter, context, event);
      return;
    case "question.replied":
      handleQuestionRepliedEvent(emitter, context, event);
      return;
    case "question.rejected":
      handleQuestionRejectedEvent(emitter, context, event);
      return;
    case "message.part.updated":
      handleMessagePartUpdatedEvent(emitter, context, event);
      return;
    case "message.part.delta":
      handleMessagePartDeltaEvent(emitter, context, event);
      return;
    case "message.part.removed":
      // Silently ignored — prevents "unknown event" issues if logging is added later.
      return;
    case "todo.updated":
      handleTodoUpdatedEvent(emitter, context, event);
      return;
    case "vcs.branch.updated":
      handleVcsBranchUpdatedEvent(emitter, context, event);
      return;
    case "file.edited":
      handleFileEditedEvent(emitter, context, event);
      return;
    case "command.executed":
      handleCommandExecutedEvent(emitter, context, event);
      return;
  }
}

// ---------------------------------------------------------------------------
// Session status / lifecycle
// ---------------------------------------------------------------------------

function handleSessionStatusEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventSessionStatus,
): void {
  const { sessionID: sessionId, status } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  const statusType = status.type;

  if (statusType === "busy") {
    context.session = {
      ...context.session,
      status: "running",
      updatedAt: nowIso(),
    };
    emitter.emitRuntimeEvent({
      type: "session.state.changed",
      eventId: eventId("kilo-status-busy"),
      provider: PROVIDER,
      threadId: context.threadId,
      createdAt: nowIso(),
      ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
      payload: {
        state: "running",
      },
      raw: {
        source: "kilo.server.event",
        messageType: statusType,
        payload: event,
      },
    });
    return;
  }

  if (statusType === "retry") {
    emitter.emitRuntimeEvent({
      type: "session.state.changed",
      eventId: eventId("kilo-status-retry"),
      provider: PROVIDER,
      threadId: context.threadId,
      createdAt: nowIso(),
      ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
      payload: {
        state: "waiting",
        reason: "retry",
        detail: event,
      },
      raw: {
        source: "kilo.server.event",
        messageType: statusType,
        payload: event,
      },
    });
    return;
  }

  if (statusType === "idle") {
    completeTurn(emitter, context, "kilo-status-idle", "kilo-turn-completed", event);
  }
}

function handleSessionIdleEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventSessionIdle,
): void {
  const { sessionID: sessionId } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  completeTurn(emitter, context, "kilo-session-idle", "kilo-turn-completed-idle", event);
}

/**
 * Shared logic for completing a turn when session goes idle (via either
 * `session.status` with type=idle or the dedicated `session.idle` event).
 */
function completeTurn(
  emitter: EventEmitter,
  context: KiloSessionContext,
  stateEventPrefix: string,
  turnEventPrefix: string,
  event: EventSessionStatus | EventSessionIdle,
): void {
  const completedAt = nowIso();
  const turnId = context.activeTurnId;
  const lastError = context.lastError;
  context.activeTurnId = undefined;
  context.lastError = undefined;
  context.session = {
    ...stripTransientSessionFields(context.session),
    status: lastError ? "error" : "ready",
    updatedAt: completedAt,
    ...(lastError ? { lastError } : {}),
  };

  const messageType =
    event.type === "session.idle"
      ? "session.idle"
      : (event as EventSessionStatus).properties.status.type;

  emitter.emitRuntimeEvent({
    type: "session.state.changed",
    eventId: eventId(stateEventPrefix),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: completedAt,
    ...(turnId ? { turnId } : {}),
    payload: {
      state: lastError ? "error" : "ready",
      ...(lastError ? { reason: lastError } : {}),
      ...(event.type !== "session.idle" ? { detail: event } : {}),
    },
    raw: {
      source: "kilo.server.event",
      messageType,
      payload: event,
    },
  });

  if (turnId) {
    emitter.emitRuntimeEvent({
      type: "turn.completed",
      eventId: eventId(turnEventPrefix),
      provider: PROVIDER,
      threadId: context.threadId,
      createdAt: completedAt,
      turnId,
      payload: {
        state: lastError ? "failed" : "completed",
        ...(lastError ? { errorMessage: lastError } : {}),
      },
      raw: {
        source: "kilo.server.event",
        messageType,
        payload: event,
      },
    });
  }
}

function handleSessionDiffEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventSessionDiff,
): void {
  const { sessionID: sessionId, diff } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  if (!context.activeTurnId || !diff || diff.length === 0) {
    return;
  }
  const unifiedDiff = fileDiffsToUnifiedDiff(diff);
  emitter.emitRuntimeEvent({
    type: "turn.diff.updated",
    eventId: eventId("kilo-turn-diff-updated"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    turnId: context.activeTurnId,
    payload: {
      unifiedDiff,
    },
    raw: {
      source: "kilo.server.event",
      messageType: "session.diff",
      payload: event,
    },
  });
}

function handleSessionErrorEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventSessionError,
): void {
  const { sessionID: sessionId, error } = event.properties;
  if (sessionId && sessionId !== context.providerSessionId) {
    return;
  }
  const errorMessage = sessionErrorMessage(error) ?? "Kilo session error";
  const errorClass = sessionErrorClass(error?.name);
  const isRetryable = sessionErrorIsRetryable(error);
  context.lastError = errorMessage;
  context.session = {
    ...stripTransientSessionFields(context.session),
    status: "error",
    updatedAt: nowIso(),
    lastError: errorMessage,
  };
  emitter.emitRuntimeEvent({
    type: "runtime.error",
    eventId: eventId("kilo-session-error"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    payload: {
      message: errorMessage,
      class: errorClass,
      ...(isRetryable != null ? { detail: { isRetryable } } : {}),
    },
    raw: {
      source: "kilo.server.event",
      messageType: "session.error",
      payload: event,
    },
  });
}

// ---------------------------------------------------------------------------
// Permission events
// ---------------------------------------------------------------------------

function handlePermissionAskedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventPermissionAsked,
): void {
  const { id: requestIdValue, sessionID: sessionId, permission, title } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  const requestType = toKiloRequestType(permission);
  const requestId = ApprovalRequestId.makeUnsafe(requestIdValue);
  context.pendingPermissions.set(requestId, { requestId, requestType });
  emitter.emitRuntimeEvent({
    type: "request.opened",
    eventId: eventId("kilo-request-opened"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    requestId: RuntimeRequestId.makeUnsafe(requestId),
    payload: {
      requestType,
      detail: title ?? permission,
      args: event.properties,
    },
    raw: {
      source: "kilo.server.permission",
      messageType: "permission.asked",
      payload: event,
    },
  });
}

function handlePermissionRepliedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventPermissionReplied,
): void {
  const { requestID: requestIdValue, sessionID: sessionId, reply } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  const pending = context.pendingPermissions.get(requestIdValue);
  context.pendingPermissions.delete(requestIdValue);
  emitter.emitRuntimeEvent({
    type: "request.resolved",
    eventId: eventId("kilo-request-resolved"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    requestId: RuntimeRequestId.makeUnsafe(requestIdValue),
    payload: {
      requestType: pending?.requestType ?? "unknown",
      decision: reply,
      resolution: event.properties,
    },
    raw: {
      source: "kilo.server.permission",
      messageType: "permission.replied",
      payload: event,
    },
  });
}

// ---------------------------------------------------------------------------
// Question events
// ---------------------------------------------------------------------------

function handleQuestionAskedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventQuestionAsked,
): void {
  const { id: requestIdValue, sessionID: sessionId, questions: askedQuestions } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  const questions = askedQuestions.map((question: QuestionInfo, index) => ({
    answerIndex: index,
    id: `${requestIdValue}:${index}`,
    header: question.header,
    question: question.question,
    options: question.options.map((option) => ({
      label: option.label,
      description: option.description,
    })),
  }));
  const runtimeQuestions = questions.map((question) => ({
    id: question.id,
    header: question.header,
    question: question.question,
    options: question.options,
  }));

  const requestId = ApprovalRequestId.makeUnsafe(requestIdValue);
  context.pendingQuestions.set(requestId, {
    requestId,
    questionIds: questions.map((question) => question.id),
    questions,
  });
  emitter.emitRuntimeEvent({
    type: "user-input.requested",
    eventId: eventId("kilo-user-input-requested"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    requestId: RuntimeRequestId.makeUnsafe(requestId),
    payload: {
      questions: runtimeQuestions,
    },
    raw: {
      source: "kilo.server.question",
      messageType: "question.asked",
      payload: event,
    },
  });
}

function handleQuestionRepliedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventQuestionReplied,
): void {
  const {
    requestID: requestIdValue,
    sessionID: sessionId,
    answers: answerArrays,
  } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  const pending = context.pendingQuestions.get(requestIdValue);
  context.pendingQuestions.delete(requestIdValue);
  const answers = Object.fromEntries(
    (pending?.questions ?? []).map((question) => {
      const answer = answerArrays[question.answerIndex];
      if (!answer) {
        return [question.id, ""];
      }
      return [question.id, answer.filter((value) => value.length > 0)];
    }),
  );
  emitter.emitRuntimeEvent({
    type: "user-input.resolved",
    eventId: eventId("kilo-user-input-resolved"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    requestId: RuntimeRequestId.makeUnsafe(requestIdValue),
    payload: {
      answers,
    },
    raw: {
      source: "kilo.server.question",
      messageType: "question.replied",
      payload: event,
    },
  });
}

function handleQuestionRejectedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventQuestionRejected,
): void {
  const { requestID: requestIdValue, sessionID: sessionId } = event.properties;
  if (sessionId !== context.providerSessionId) {
    return;
  }
  context.pendingQuestions.delete(requestIdValue);
  emitter.emitRuntimeEvent({
    type: "user-input.resolved",
    eventId: eventId("kilo-user-input-rejected"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    requestId: RuntimeRequestId.makeUnsafe(requestIdValue),
    payload: {
      answers: {},
    },
    raw: {
      source: "kilo.server.question",
      messageType: "question.rejected",
      payload: event,
    },
  });
}

// ---------------------------------------------------------------------------
// Message part events (text, reasoning, tool)
// ---------------------------------------------------------------------------

function handleMessagePartUpdatedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventMessagePartUpdated,
): void {
  const { part } = event.properties;
  if (part.sessionID !== context.providerSessionId) {
    return;
  }
  // Track message IDs for rollback support (Tier 4a)
  if (part.messageID && !context.messageIds.includes(part.messageID)) {
    context.messageIds.push(part.messageID);
  }
  if (part.type === "text") {
    context.partStreamById.set(part.id, { kind: "text", streamKind: "assistant_text" });
    return;
  }
  if (part.type === "reasoning") {
    context.partStreamById.set(part.id, { kind: "reasoning", streamKind: "reasoning_text" });
    return;
  }

  if (part.type === "tool") {
    handleToolPartUpdatedEvent(emitter, context, event, part);
  }
}

function handleToolPartUpdatedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventMessagePartUpdated,
  part: KiloToolPart,
): void {
  const previous = context.partStreamById.get(part.id);
  const stateTitle = toolStateTitle(part.state);
  const detail = normalizeToolDetail(toolStateDetail(part.state));
  const lifecycleType = toToolLifecycleEventType(previous, part.state.status);
  const toolTitle = toToolTitle(part.tool);
  const shouldSuppressCompletion =
    lifecycleType === "item.completed" &&
    previous?.kind === "tool" &&
    previous.lifecycleType === "item.updated" &&
    previous.title === toolTitle &&
    (detail === undefined || detail === previous.detail);

  context.partStreamById.set(part.id, {
    kind: "tool",
    lifecycleType,
    title: toolTitle,
    ...(detail ? { detail } : {}),
  });
  if (!shouldSuppressCompletion) {
    emitter.emitRuntimeEvent({
      type: lifecycleType,
      eventId: eventId(`kilo-tool-${lifecycleType.replace(".", "-")}`),
      provider: PROVIDER,
      threadId: context.threadId,
      createdAt: nowIso(),
      ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
      itemId: RuntimeItemId.makeUnsafe(part.id),
      payload: {
        itemType: toToolItemType(part.tool),
        ...(lifecycleType !== "item.updated"
          ? {
              status: lifecycleType === "item.completed" ? "completed" : "inProgress",
            }
          : {}),
        title: toolTitle,
        ...(detail ? { detail } : {}),
        data: {
          item: part,
        },
      },
      raw: {
        source: "kilo.server.event",
        messageType: "message.part.updated",
        payload: event,
      },
    });
  }

  if (
    !shouldSuppressCompletion &&
    (part.state.status === "completed" || part.state.status === "error") &&
    stateTitle
  ) {
    emitter.emitRuntimeEvent({
      type: "tool.summary",
      eventId: eventId("kilo-tool-summary"),
      provider: PROVIDER,
      threadId: context.threadId,
      createdAt: nowIso(),
      ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
      itemId: RuntimeItemId.makeUnsafe(part.id),
      payload: {
        summary: `${part.tool}: ${stateTitle}`,
        precedingToolUseIds: [part.id],
      },
      raw: {
        source: "kilo.server.event",
        messageType: "message.part.updated",
        payload: event,
      },
    });
  }
}

function handleMessagePartDeltaEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventMessagePartDelta,
): void {
  const { sessionID, partID: partId, delta } = event.properties;
  if (sessionID !== context.providerSessionId) {
    return;
  }
  if (!context.activeTurnId || delta.length === 0) {
    return;
  }
  const partState = context.partStreamById.get(partId);
  if (partState?.kind === "tool") {
    return;
  }
  emitter.emitRuntimeEvent({
    type: "content.delta",
    eventId: eventId("kilo-content-delta"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    turnId: context.activeTurnId,
    itemId: RuntimeItemId.makeUnsafe(partId),
    payload: {
      streamKind: partState?.streamKind ?? "assistant_text",
      delta,
    },
    raw: {
      source: "kilo.server.event",
      messageType: "message.part.delta",
      payload: event,
    },
  });
}

// ---------------------------------------------------------------------------
// Todo / plan events
// ---------------------------------------------------------------------------

function handleTodoUpdatedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventTodoUpdated,
): void {
  const { sessionID, todos } = event.properties;
  if (sessionID !== context.providerSessionId || !context.activeTurnId) {
    return;
  }
  const plan = todos.map((todo) => ({
    step: todoPriorityPrefix(todo),
    status: toPlanStepStatus(todo.status),
  }));
  emitter.emitRuntimeEvent({
    type: "turn.plan.updated",
    eventId: eventId("kilo-plan-updated"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    turnId: context.activeTurnId,
    payload: {
      plan,
    },
    raw: {
      source: "kilo.server.event",
      messageType: "todo.updated",
      payload: event,
    },
  });
}

// ---------------------------------------------------------------------------
// Tier 2 — New SSE event handlers
// ---------------------------------------------------------------------------

function handleSessionCompactedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventSessionCompacted,
): void {
  const { sessionID } = event.properties;
  if (sessionID !== context.providerSessionId) {
    return;
  }
  emitter.emitRuntimeEvent({
    type: "thread.state.changed",
    eventId: eventId("kilo-session-compacted"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    payload: {
      state: "compacted",
    },
    raw: {
      source: "kilo.server.event",
      messageType: "session.compacted",
      payload: event,
    },
  });
}

function handleSessionUpdatedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventSessionUpdated,
): void {
  const { sessionID, info } = event.properties;
  if (sessionID !== context.providerSessionId) {
    return;
  }
  emitter.emitRuntimeEvent({
    type: "thread.metadata.updated",
    eventId: eventId("kilo-session-updated"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    payload: {
      ...(info?.title ? { name: info.title } : {}),
      metadata: info ?? {},
    },
    raw: {
      source: "kilo.server.event",
      messageType: "session.updated",
      payload: event,
    },
  });
}

function handleVcsBranchUpdatedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventVcsBranchUpdated,
): void {
  if (event.properties.sessionID && event.properties.sessionID !== context.providerSessionId) {
    return;
  }
  emitter.emitRuntimeEvent({
    type: "thread.metadata.updated",
    eventId: eventId("kilo-vcs-branch-updated"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    payload: {
      metadata: { branch: event.properties.branch },
    },
    raw: {
      source: "kilo.server.event",
      messageType: "vcs.branch.updated",
      payload: event,
    },
  });
}

function handleFileEditedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventFileEdited,
): void {
  if (event.properties.sessionID && event.properties.sessionID !== context.providerSessionId) {
    return;
  }
  emitter.emitRuntimeEvent({
    type: "files.persisted",
    eventId: eventId("kilo-file-edited"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    payload: {
      files: [
        {
          filename: event.properties.filename,
          fileId: event.properties.fileId ?? event.properties.filename,
        },
      ],
    },
    raw: {
      source: "kilo.server.event",
      messageType: "file.edited",
      payload: event,
    },
  });
}

function handleCommandExecutedEvent(
  emitter: EventEmitter,
  context: KiloSessionContext,
  event: EventCommandExecuted,
): void {
  const { sessionID, command } = event.properties;
  if (sessionID !== context.providerSessionId) {
    return;
  }
  const itemId = RuntimeItemId.makeUnsafe(`cmd:${command}:${randomUUID()}`);
  const title = `Command: ${command}`;
  emitter.emitRuntimeEvent({
    type: "item.started",
    eventId: eventId("kilo-command-started"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    itemId,
    payload: {
      itemType: "dynamic_tool_call",
      status: "inProgress",
      title,
      data: { item: event.properties },
    },
    raw: {
      source: "kilo.server.event",
      messageType: "command.executed",
      payload: event,
    },
  });
  emitter.emitRuntimeEvent({
    type: "item.completed",
    eventId: eventId("kilo-command-completed"),
    provider: PROVIDER,
    threadId: context.threadId,
    createdAt: nowIso(),
    ...(context.activeTurnId ? { turnId: context.activeTurnId } : {}),
    itemId,
    payload: {
      itemType: "dynamic_tool_call",
      status: "completed",
      title,
      data: { item: event.properties },
    },
    raw: {
      source: "kilo.server.event",
      messageType: "command.executed",
      payload: event,
    },
  });
}
