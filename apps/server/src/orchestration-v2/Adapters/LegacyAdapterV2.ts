/**
 * V2 boundary for the fork's SDK and headless-CLI runtimes.
 * One broker consumes each legacy adapter stream. Session runtimes must never
 * independently filter it: the legacy stream is backed by a single-consumer queue.
 */
import {
  ApprovalRequestId,
  PlanId,
  RuntimeRequestId,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  ThreadId,
  type TurnId,
  type OrchestrationV2ProviderCapabilities,
  type OrchestrationV2ProviderSession,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2ProviderTurn,
  type OrchestrationV2ExecutionNode,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
  type OrchestrationV2ProviderRef,
  type OrchestrationV2PlanArtifact,
  type OrchestrationV2Subagent,
  type ProviderRequestKind,
  type ProviderUsageLimitsUpdate,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import type {
  ProviderAdapterShape,
  ProviderThreadSnapshot,
} from "../../provider/Services/ProviderAdapter.ts";
import { IdAllocatorV2 } from "../IdAllocator.ts";
import { makeProviderFailure } from "../ProviderFailure.ts";
import {
  ProviderAdapterOpenSessionError,
  ProviderAdapterEnsureThreadError,
  ProviderAdapterResumeThreadError,
  ProviderAdapterProtocolError,
  ProviderAdapterReadThreadSnapshotError,
  ProviderAdapterRollbackThreadError,
  ProviderAdapterForkThreadError,
  ProviderAdapterSteerRunUnsupportedError,
  ProviderAdapterInterruptError,
  ProviderAdapterRuntimeRequestResponseError,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2Shape,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2TurnInput,
  type ProviderAdapterV2ThreadSnapshot,
} from "../ProviderAdapter.ts";

export interface LegacyAdapterV2Profile {
  /** The exact native cursor understood by startSession. Amp has none. */
  readonly resume: "string" | "sessionId" | "acp" | "none";
  readonly nativeHistory: boolean;
  readonly reasoning: boolean;
  readonly approvals: boolean;
  readonly questions: boolean;
  readonly mcp: boolean;
  readonly subagents?: boolean;
  readonly planning?: boolean;
  readonly restartOnInterrupt?: boolean;
  /** Only runtimes that use threadId solely as a local routing key may opt in. */
  readonly isolateSessionRouting?: boolean;
}

export const LEGACY_ADAPTER_V2_PROFILES = {
  droid: {
    resume: "string",
    nativeHistory: false,
    reasoning: true,
    approvals: true,
    questions: true,
    mcp: false,
    isolateSessionRouting: true,
  },
  amp: {
    resume: "none",
    nativeHistory: false,
    reasoning: true,
    approvals: false,
    questions: false,
    mcp: false,
    isolateSessionRouting: true,
    subagents: true,
    restartOnInterrupt: true,
  },
  copilot: {
    resume: "string",
    nativeHistory: true,
    reasoning: true,
    approvals: true,
    questions: true,
    mcp: false,
    isolateSessionRouting: true,
    subagents: true,
    planning: true,
  },
  "gemini-cli": {
    resume: "sessionId",
    nativeHistory: false,
    reasoning: false,
    approvals: false,
    questions: false,
    mcp: false,
    isolateSessionRouting: true,
  },
  kilo: {
    resume: "sessionId",
    nativeHistory: true,
    reasoning: true,
    approvals: true,
    questions: true,
    mcp: false,
    isolateSessionRouting: true,
  },
} satisfies Record<string, LegacyAdapterV2Profile>;

export function legacyAdapterV2Capabilities(
  profile: LegacyAdapterV2Profile,
  modelSwitch: boolean,
): OrchestrationV2ProviderCapabilities {
  return {
    runtimePolicy: { enforcement: "client-boundary" },
    sessions: {
      supportsMultipleProviderThreadsPerSession: false,
      supportsModelSwitchInSession: modelSwitch,
      supportsProviderSwitchingViaHandoff: true,
      supportsRuntimeModeSwitchInSession: false,
      pendingRequestsSurviveRestart: false,
    },
    threads: {
      canCreateEmptyThread: true,
      canReadThreadSnapshot: profile.nativeHistory,
      // The old Kilo rollback counts messages, not V2 turns, and cannot rewind
      // to thread-start. Do not advertise complete rollback until it is ported.
      canRollbackThread: false,
      canForkThread: false,
      canForkFromTurn: false,
      canForkFromSubagentThread: false,
      exposesNativeThreadId: profile.resume !== "none",
    },
    turns: {
      exposesNativeTurnId: false,
      emitsTurnStarted: true,
      emitsTurnCompleted: true,
      supportsInterrupt: true,
      supportsActiveSteering: false,
      supportsSteeringByInterruptRestart: false,
      supportsQueuedMessages: false,
      terminalStatusQuality: "strong",
    },
    streaming: {
      streamsAssistantText: true,
      streamsReasoning: profile.reasoning,
      streamsToolOutput: true,
      streamsPlanText: false,
      emitsMessageCompleted: true,
    },
    tools: {
      exposesToolItemIds: true,
      emitsToolStarted: true,
      emitsToolCompleted: true,
      emitsToolOutput: true,
      supportsMcpTools: profile.mcp,
      supportsDynamicToolCallbacks: false,
    },
    approvals: {
      supportsCommandApproval: profile.approvals,
      supportsFileReadApproval: profile.approvals,
      supportsFileChangeApproval: profile.approvals,
      supportsApplyPatchApproval: false,
      approvalsHaveNativeRequestIds: profile.approvals,
      approvalCallbacksAreLiveOnly: true,
      approvalsCanOriginateFromSubagents: false,
    },
    planning: {
      emitsPlanUpdated: profile.planning ?? false,
      emitsTodoList: profile.planning ?? false,
      emitsProposedPlan: profile.planning ?? false,
      supportsStructuredQuestions: profile.questions,
      planDeltasHaveItemIds: false,
    },
    subagents: {
      supportsSubagents: profile.subagents ?? false,
      exposesSubagentThreadIds: false,
      emitsSubagentLifecycle: profile.subagents ?? false,
      canWaitForSubagents: false,
      canCloseSubagents: false,
      canForkSubagentThread: false,
    },
    context: {
      acceptsSystemContext: false,
      acceptsDeveloperContext: false,
      acceptsSyntheticUserContext: true,
      canGenerateSummaries: false,
      canConsumeHandoffSummaries: true,
      supportsDeltaHandoff: true,
      supportsFullThreadHandoff: true,
      maxRecommendedHandoffChars: null,
    },
    checkpointing: {
      appCanCheckpointFilesystem: true,
      supportsNestedCheckpointScopes: false,
      providerCanRollbackConversation: false,
      providerRollbackReturnsSnapshot: false,
      providerCanReadConversationSnapshot: profile.nativeHistory,
    },
    identity: {
      nativeThreadIds: profile.resume === "none" ? "none" : "strong",
      nativeTurnIds: "weak",
      nativeItemIds: "weak",
      nativeRequestIds: "weak",
    },
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function stringField(value: unknown, ...keys: ReadonlyArray<string>): string | undefined {
  const fields = record(value);
  for (const key of keys) {
    const candidate = fields?.[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return undefined;
}

function legacyResumeId(cursor: unknown): string | undefined {
  return typeof cursor === "string" && cursor.trim().length > 0
    ? cursor
    : stringField(cursor, "sessionId", "session_id", "threadId");
}

/** Decode the two native history formats exposed by the retained runtimes. */
export function readLegacyHistoryMessages(snapshot: ProviderThreadSnapshot): ReadonlyArray<{
  readonly nativeId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}> {
  const messages: Array<{ nativeId: string; role: "user" | "assistant"; text: string }> = [];
  for (const turn of snapshot.turns) {
    for (const [index, raw] of turn.items.entries()) {
      const item = record(raw);
      if (!item) continue;
      // Copilot's session.getMessages returns session event envelopes.
      const data = record(item.data);
      if (item.type === "assistant.message" || item.type === "user.message") {
        const text = stringField(data, "content");
        if (text)
          messages.push({
            nativeId:
              stringField(data, "messageId") ?? stringField(item, "id") ?? `${turn.id}:${index}`,
            role: item.type === "assistant.message" ? "assistant" : "user",
            text,
          });
        continue;
      }
      // Kilo session.messages returns {info: Message, parts: Part[]}.
      const info = record(item.info);
      if ((info?.role === "user" || info?.role === "assistant") && Array.isArray(item.parts)) {
        const text = item.parts
          .flatMap((part: unknown) => {
            const value = record(part);
            return value?.type === "text" && typeof value.text === "string" ? [value.text] : [];
          })
          .join("\n");
        if (text)
          messages.push({
            nativeId: stringField(info, "id") ?? `${turn.id}:${index}`,
            role: info.role,
            text,
          });
      }
    }
  }
  return messages;
}

function requestKind(type: string): ProviderRequestKind {
  switch (type) {
    case "command_execution_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
      return "file-change";
    case "apply_patch_approval":
      return "file-change";
    case "exec_command_approval":
      return "command";
    case "mcp_elicitation_approval":
      return "mcp-elicitation";
    default:
      return "permission";
  }
}

type Item = OrchestrationV2TurnItem;
interface ActiveTurn {
  readonly input: ProviderAdapterV2TurnInput;
  providerTurn: OrchestrationV2ProviderTurn;
  nativeTurnId: TurnId | undefined;
  readonly items: Map<string, Item>;
  readonly nodes: Map<string, OrchestrationV2ExecutionNode>;
  readonly subagents: Map<string, OrchestrationV2Subagent>;
  nextOrdinal: number;
  interrupted: boolean;
  failure: ReturnType<typeof makeProviderFailure> | undefined;
  sendFiber: Fiber.Fiber<void> | undefined;
}

/** Build in the provider-instance scope, once per legacy adapter. */
export const makeLegacyAdapterV2 = Effect.fn("makeLegacyAdapterV2")(function* <E>(options: {
  readonly instanceId: ProviderInstanceId;
  readonly adapter: ProviderAdapterShape<E>;
  readonly profile: LegacyAdapterV2Profile;
  readonly cwd: string;
  readonly onUsageLimits?: (
    limits: ProviderUsageLimitsUpdate & { readonly checkedAt: string },
  ) => Effect.Effect<void>;
}) {
  const { adapter, instanceId, profile } = options;
  const driver = adapter.provider;
  const ids = yield* IdAllocatorV2;
  const capabilities = legacyAdapterV2Capabilities(
    profile,
    adapter.capabilities.sessionModelSwitch === "in-session",
  );
  const appThreads = new Set<ThreadId>();
  const routes = new Map<ThreadId, (event: ProviderRuntimeEvent) => Effect.Effect<void>>();
  yield* adapter.streamEvents.pipe(
    Stream.runForEach((event) =>
      event.type === "account.rate-limits.updated"
        ? (options.onUsageLimits?.({ ...event.payload.limits, checkedAt: event.createdAt }) ??
          Effect.void)
        : (routes.get(event.threadId)?.(event) ?? Effect.void),
    ),
    Effect.forkScoped,
  );

  const result: ProviderAdapterV2Shape = {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: () =>
      Effect.succeed(
        capabilities.sessions.supportsModelSwitchInSession
          ? { type: "apply_on_next_turn" }
          : { type: "restart_session" },
      ),
    openSession: (input) =>
      Effect.gen(function* () {
        if (appThreads.has(input.threadId)) {
          return yield* new ProviderAdapterOpenSessionError({
            driver,
            providerSessionId: input.providerSessionId,
            cause: new Error("A runtime already owns this app thread."),
          });
        }
        const scope = yield* Scope.Scope;
        const queue = yield* Queue.unbounded<ProviderAdapterV2Event>();
        const now = yield* DateTime.now;
        const freshNativeId = yield* ids.allocate
          .providerSession({ providerInstanceId: instanceId, threadId: input.threadId })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterOpenSessionError({
                  driver,
                  providerSessionId: input.providerSessionId,
                  cause,
                }),
            ),
          );
        const legacyThreadId = profile.isolateSessionRouting
          ? ThreadId.make(`${input.threadId}:runtime:${freshNativeId}`)
          : input.threadId;
        let session: OrchestrationV2ProviderSession = {
          id: input.providerSessionId,
          driver,
          providerInstanceId: instanceId,
          status: "starting",
          cwd: input.runtimePolicy.cwd ?? options.cwd,
          model: input.modelSelection.model,
          capabilities,
          createdAt: now,
          updatedAt: now,
          lastError: null,
        };
        let nativeId = profile.resume === "none" ? undefined : input.initialNativeThreadId;
        let providerThread: OrchestrationV2ProviderThread | undefined;
        let active: ActiveTurn | undefined;
        let closed = false;
        const completedNativeTurns = new Set<string>();
        const seenEvents = new Set<string>();
        const providerTurns = new Map<string, OrchestrationV2ProviderTurn>();
        const messages = new Map<string, OrchestrationV2ConversationMessage>();
        const streamedMessageNativeIds = new Set<string>();
        const requests = new Map<
          RuntimeRequestId,
          {
            request: OrchestrationV2RuntimeRequest;
            legacyId: ApprovalRequestId;
            item: Extract<Item, { type: "approval_request" | "user_input_request" }>;
            turn: ActiveTurn;
          }
        >();
        const emit = (event: ProviderAdapterV2Event) =>
          Queue.offer(queue, event).pipe(Effect.asVoid);
        const ref = (id: string, strong = false): OrchestrationV2ProviderRef => ({
          driver,
          nativeId: id,
          strength: strong ? "strong" : "weak",
        });
        const updateSession = (
          status: OrchestrationV2ProviderSession["status"],
          timestamp: DateTime.Utc,
          lastError: string | null = null,
        ) => {
          session = { ...session, status, updatedAt: timestamp, lastError };
          return emit({ type: "provider_session.updated", driver, providerSession: session });
        };
        const updateThread = (
          patch: Partial<OrchestrationV2ProviderThread>,
          timestamp: DateTime.Utc,
        ) => {
          if (!providerThread) return Effect.void;
          providerThread = { ...providerThread, ...patch, updatedAt: timestamp };
          return emit({ type: "provider_thread.updated", driver, providerThread });
        };
        const updateNativeId = (cursor: unknown, timestamp: DateTime.Utc) => {
          const next = legacyResumeId(cursor);
          if (!next || next === nativeId || profile.resume === "none") return Effect.void;
          nativeId = next;
          return updateThread({ nativeThreadRef: ref(next, true) }, timestamp);
        };
        const updateTurn = (turn: ActiveTurn) => {
          providerTurns.set(turn.providerTurn.id, turn.providerTurn);
          return emit({
            type: "provider_turn.updated",
            driver,
            threadId: input.threadId,
            providerTurn: turn.providerTurn,
          });
        };
        const itemKey = (turn: ActiveTurn, nativeItemId: string) =>
          `${instanceId}:${turn.providerTurn.id}:${nativeItemId}`;
        const itemBase = (turn: ActiveTurn, nativeItemId: string, timestamp: DateTime.Utc) => {
          const existing = turn.items.get(nativeItemId);
          return {
            id: ids.derive.turnItemFromProviderItem({
              driver,
              nativeItemId: itemKey(turn, nativeItemId),
            }),
            threadId: input.threadId,
            runId: turn.input.runId,
            nodeId: ids.derive.nodeFromProviderItem({
              driver,
              nativeItemId: itemKey(turn, nativeItemId),
            }),
            providerThreadId: turn.providerTurn.providerThreadId,
            providerTurnId: turn.providerTurn.id,
            nativeItemRef: ref(nativeItemId),
            parentItemId: null,
            ordinal: existing?.ordinal ?? turn.nextOrdinal++,
            status: "running" as const,
            title: existing?.title ?? null,
            startedAt: existing?.startedAt ?? timestamp,
            completedAt: null,
            updatedAt: timestamp,
          };
        };
        const emitItem = (turn: ActiveTurn, key: string, item: Item) =>
          Effect.gen(function* () {
            turn.items.set(key, item);
            const kind: OrchestrationV2ExecutionNode["kind"] =
              item.type === "assistant_message"
                ? "assistant_message"
                : item.type === "reasoning"
                  ? "reasoning"
                  : item.type === "proposed_plan"
                    ? "plan"
                    : item.type === "todo_list"
                      ? "todo_list"
                      : item.type === "subagent"
                        ? "subagent"
                        : item.type === "approval_request"
                          ? "approval_request"
                          : item.type === "user_input_request"
                            ? "user_input_request"
                            : "tool_call";
            if (item.nodeId) {
              const node: OrchestrationV2ExecutionNode = {
                id: item.nodeId,
                threadId: input.threadId,
                runId: turn.input.runId,
                parentNodeId: turn.input.rootNodeId,
                rootNodeId: turn.input.rootNodeId,
                kind,
                status: item.status,
                countsForRun: true,
                providerThreadId: item.providerThreadId ?? null,
                providerTurnId: item.providerTurnId,
                nativeItemRef: item.nativeItemRef,
                runtimeRequestId:
                  item.type === "approval_request" || item.type === "user_input_request"
                    ? item.requestId
                    : null,
                checkpointScopeId: null,
                startedAt: item.startedAt,
                completedAt: item.completedAt,
              };
              turn.nodes.set(key, node);
              yield* emit({ type: "node.updated", driver, node });
            }
            const subagent = turn.subagents.get(key);
            if (subagent && item.type === "subagent") {
              const next = {
                ...subagent,
                status: item.status,
                completedAt: item.completedAt,
                updatedAt: item.updatedAt,
              };
              turn.subagents.set(key, next);
              yield* emit({ type: "subagent.updated", driver, subagent: next });
            }
            if (item.type === "assistant_message") {
              if (item.nativeItemRef?.nativeId)
                streamedMessageNativeIds.add(item.nativeItemRef.nativeId);
              const message: OrchestrationV2ConversationMessage = {
                id: item.messageId,
                threadId: input.threadId,
                runId: turn.input.runId,
                nodeId: item.nodeId,
                role: "assistant",
                text: item.text,
                attachments: item.attachments ?? [],
                streaming: item.streaming,
                createdBy: "agent",
                creationSource: "provider",
                createdAt: item.startedAt ?? item.updatedAt,
                updatedAt: item.updatedAt,
              };
              messages.set(message.id, message);
              yield* emit({ type: "message.updated", driver, message });
            }
            yield* emit({ type: "turn_item.updated", driver, turnItem: item });
          });
        const resolveRequest = (
          requestId: RuntimeRequestId,
          status: "resolved" | "expired" | "cancelled",
          timestamp: DateTime.Utc,
        ) =>
          Effect.gen(function* () {
            const entry = requests.get(requestId);
            if (!entry || entry.request.status !== "pending") return;
            entry.request = { ...entry.request, status, resolvedAt: timestamp };
            yield* emit({
              type: "runtime_request.updated",
              driver,
              threadId: input.threadId,
              runtimeRequest: entry.request,
            });
            entry.item = {
              ...entry.item,
              status: status === "resolved" ? "completed" : "cancelled",
              completedAt: timestamp,
              updatedAt: timestamp,
            };
            yield* emitItem(entry.turn, `request:${entry.legacyId}`, entry.item);
          });
        const terminal = (
          turn: ActiveTurn,
          status: "completed" | "failed" | "interrupted" | "cancelled",
          timestamp: DateTime.Utc,
          broken = false,
        ) =>
          Effect.gen(function* () {
            if (active !== turn) return;
            active = undefined;
            if (turn.nativeTurnId) completedNativeTurns.add(turn.nativeTurnId);
            for (const [id, entry] of requests) {
              if (entry.turn === turn) yield* resolveRequest(id, "expired", timestamp);
            }
            for (const [key, item] of turn.items) {
              if (
                item.status !== "running" &&
                item.status !== "waiting" &&
                item.status !== "pending"
              )
                continue;
              if (
                item.type === "assistant_message" ||
                item.type === "reasoning" ||
                item.type === "proposed_plan"
              ) {
                yield* emitItem(turn, key, {
                  ...item,
                  status,
                  completedAt: timestamp,
                  updatedAt: timestamp,
                  streaming: false,
                });
              } else {
                yield* emitItem(turn, key, {
                  ...item,
                  status,
                  completedAt: timestamp,
                  updatedAt: timestamp,
                });
              }
            }
            turn.providerTurn = { ...turn.providerTurn, status, completedAt: timestamp };
            yield* updateTurn(turn);
            yield* updateThread({ status: broken ? "error" : "idle" }, timestamp);
            yield* updateSession(
              broken ? "error" : "ready",
              timestamp,
              turn.failure?.message ?? null,
            );
            const common = {
              type: "turn.terminal" as const,
              driver,
              providerThreadId: turn.providerTurn.providerThreadId,
              providerTurnId: turn.providerTurn.id,
              runOrdinal: turn.input.runOrdinal,
              threadDisposition: broken ? ("broken" as const) : ("reusable" as const),
            };
            yield* emit(
              status === "failed"
                ? {
                    ...common,
                    status,
                    failure: turn.failure ?? makeProviderFailure({ class: "provider_error" }),
                    failureItemOrdinal: turn.nextOrdinal++,
                  }
                : { ...common, status, failure: null },
            );
          });
        const onEvent = (event: ProviderRuntimeEvent) =>
          Effect.gen(function* () {
            if (closed || (event.providerInstanceId && event.providerInstanceId !== instanceId))
              return;
            if (seenEvents.has(event.eventId)) return;
            seenEvents.add(event.eventId);
            const timestamp = DateTime.makeUnsafe(event.createdAt);
            const turn = active;
            // Usage and session-state notifications can arrive after interrupt.
            // Match their native turn before allowing them to mutate the next run.
            if (
              turn &&
              event.turnId &&
              (completedNativeTurns.has(event.turnId) ||
                (turn.nativeTurnId && turn.nativeTurnId !== event.turnId))
            )
              return;
            if (event.type === "session.started")
              yield* updateNativeId(event.payload.resume, timestamp);
            if (event.type === "thread.started")
              yield* updateNativeId(event.payload.providerThreadId, timestamp);
            if (event.type === "thread.token-usage.updated") {
              yield* updateThread({ contextUsage: event.payload.usage }, timestamp);
              if (turn && active === turn) {
                turn.providerTurn = {
                  ...turn.providerTurn,
                  tokenUsage: { ...event.payload.usage, updatedAt: event.createdAt },
                };
                yield* updateTurn(turn);
              }
              return;
            }
            if (event.type === "session.state.changed")
              yield* updateSession(
                event.payload.state,
                timestamp,
                event.payload.state === "error" ? (event.payload.reason ?? null) : null,
              );
            if (event.type === "session.exited") {
              if (turn) {
                turn.failure = makeProviderFailure({
                  message: event.payload.reason,
                  class: "transport_error",
                });
                yield* terminal(turn, turn.interrupted ? "interrupted" : "failed", timestamp, true);
              } else yield* updateSession("stopped", timestamp);
              return;
            }
            if (!turn) return;
            if (event.turnId && !turn.nativeTurnId) {
              turn.nativeTurnId = event.turnId;
              turn.providerTurn = { ...turn.providerTurn, nativeTurnRef: ref(event.turnId) };
              yield* updateTurn(turn);
            }
            const rawKey = event.itemId ?? event.providerRefs?.providerItemId ?? "assistant";
            const reasoningItem =
              event.type === "content.delta"
                ? event.payload.streamKind === "reasoning_text" ||
                  event.payload.streamKind === "reasoning_summary_text"
                : (event.type === "item.started" ||
                    event.type === "item.updated" ||
                    event.type === "item.completed") &&
                  event.payload.itemType === "reasoning";
            const key = reasoningItem ? `${rawKey}:reasoning` : rawKey;
            switch (event.type) {
              case "turn.started":
                return;
              case "turn.plan.updated":
              case "turn.proposed.delta":
              case "turn.proposed.completed": {
                const planKey = event.type === "turn.plan.updated" ? "todo-plan" : "proposed-plan";
                const base = itemBase(turn, planKey, timestamp);
                const planId = PlanId.make(`${turn.providerTurn.id}:${planKey}`);
                let plan: OrchestrationV2PlanArtifact;
                let item: Item;
                if (event.type === "turn.plan.updated") {
                  const steps = event.payload.plan.map((step, index) => ({
                    id: `${planId}:${index}`,
                    text: step.step,
                    status: step.status === "inProgress" ? ("running" as const) : step.status,
                  }));
                  const completed =
                    steps.length > 0 && steps.every((step) => step.status === "completed");
                  plan = {
                    id: planId,
                    threadId: input.threadId,
                    runId: turn.input.runId,
                    nodeId: base.nodeId,
                    status: completed ? "completed" : "active",
                    kind: "todo_list",
                    steps,
                    ...(event.payload.explanation
                      ? { explanation: event.payload.explanation }
                      : {}),
                  };
                  item = {
                    ...base,
                    type: "todo_list",
                    planId,
                    steps,
                    status: completed ? "completed" : "running",
                    completedAt: completed ? timestamp : null,
                    ...(event.payload.explanation
                      ? { explanation: event.payload.explanation }
                      : {}),
                  };
                } else {
                  const previous = turn.items.get(planKey);
                  const markdown =
                    event.type === "turn.proposed.completed"
                      ? event.payload.planMarkdown
                      : (previous?.type === "proposed_plan" ? previous.markdown : "") +
                        event.payload.delta;
                  const completed = event.type === "turn.proposed.completed";
                  plan = {
                    id: planId,
                    threadId: input.threadId,
                    runId: turn.input.runId,
                    nodeId: base.nodeId,
                    status: completed ? "active" : "draft",
                    kind: "proposed_plan",
                    markdown,
                  };
                  item = {
                    ...base,
                    type: "proposed_plan",
                    planId,
                    markdown,
                    streaming: !completed,
                    status: completed ? "completed" : "running",
                    completedAt: completed ? timestamp : null,
                  };
                }
                yield* emit({ type: "plan.updated", driver, plan });
                yield* emitItem(turn, planKey, item);
                return;
              }
              case "task.started":
              case "task.progress":
              case "task.updated":
              case "task.completed": {
                const taskKey = `task:${event.payload.taskId}`;
                const base = itemBase(turn, taskKey, timestamp);
                const previous = turn.subagents.get(taskKey);
                const status =
                  event.type === "task.completed"
                    ? event.payload.status === "stopped"
                      ? "cancelled"
                      : event.payload.status
                    : event.type === "task.updated" || event.type === "task.progress"
                      ? (event.payload.status ?? "running")
                      : "running";
                const completed =
                  status === "completed" ||
                  status === "failed" ||
                  status === "cancelled" ||
                  status === "interrupted";
                const summary =
                  event.type === "task.completed"
                    ? (event.payload.summary ?? null)
                    : (previous?.result ?? null);
                const subagent: OrchestrationV2Subagent = {
                  id: base.nodeId,
                  threadId: input.threadId,
                  runId: turn.input.runId,
                  parentNodeId: turn.input.rootNodeId,
                  origin: "provider_native",
                  createdBy: "agent",
                  driver,
                  providerInstanceId: instanceId,
                  providerThreadId: turn.providerTurn.providerThreadId,
                  childThreadId: null,
                  nativeTaskRef: ref(event.payload.taskId),
                  prompt:
                    previous?.prompt ??
                    ("description" in event.payload ? (event.payload.description ?? "") : ""),
                  title: event.payload.title ?? previous?.title ?? null,
                  model: event.payload.model ?? previous?.model ?? null,
                  status,
                  result: summary,
                  startedAt: previous?.startedAt ?? timestamp,
                  completedAt: completed ? timestamp : null,
                  updatedAt: timestamp,
                  ...(event.type === "task.progress"
                    ? { progress: event.payload.description }
                    : {}),
                };
                turn.subagents.set(taskKey, subagent);
                yield* emitItem(turn, taskKey, {
                  ...base,
                  type: "subagent",
                  status,
                  completedAt: subagent.completedAt,
                  subagentId: subagent.id,
                  origin: "provider_native",
                  driver,
                  providerInstanceId: instanceId,
                  childThreadId: null,
                  prompt: subagent.prompt,
                  result: summary,
                  ...(subagent.progress ? { progress: subagent.progress } : {}),
                });
                return;
              }
              case "content.delta": {
                const existing = turn.items.get(key);
                if (
                  event.payload.streamKind === "assistant_text" ||
                  event.payload.streamKind === "reasoning_text" ||
                  event.payload.streamKind === "reasoning_summary_text"
                ) {
                  const reasoning = event.payload.streamKind !== "assistant_text";
                  const text =
                    (existing && "text" in existing ? existing.text : "") + event.payload.delta;
                  const base = itemBase(turn, key, timestamp);
                  yield* emitItem(
                    turn,
                    key,
                    reasoning
                      ? { ...base, type: "reasoning", text, streaming: true }
                      : {
                          ...base,
                          type: "assistant_message",
                          text,
                          streaming: true,
                          messageId: ids.derive.messageFromProviderItem({
                            driver,
                            nativeItemId: itemKey(turn, key),
                          }),
                        },
                  );
                } else if (existing?.type === "command_execution") {
                  yield* emitItem(turn, key, {
                    ...existing,
                    output: (existing.output ?? "") + event.payload.delta,
                    updatedAt: timestamp,
                  });
                }
                return;
              }
              case "item.started":
              case "item.updated":
              case "item.completed": {
                const payload = event.payload;
                const existing = turn.items.get(key);
                const ended = event.type === "item.completed";
                const status: Item["status"] =
                  payload.status === "failed"
                    ? "failed"
                    : payload.status === "declined"
                      ? "cancelled"
                      : ended || payload.status === "completed"
                        ? "completed"
                        : "running";
                const base = {
                  ...itemBase(turn, key, timestamp),
                  title: payload.title ?? existing?.title ?? null,
                  status,
                  completedAt: ended ? timestamp : null,
                };
                // Full native message bodies replace deltas rather than append them.
                const fullText = stringField(payload.data, "text", "content", "message");
                let item: Item;
                if (payload.itemType === "assistant_message" || payload.itemType === "reasoning") {
                  const text = fullText ?? (existing && "text" in existing ? existing.text : "");
                  item =
                    payload.itemType === "reasoning"
                      ? { ...base, type: "reasoning", text, streaming: !ended }
                      : {
                          ...base,
                          type: "assistant_message",
                          text,
                          streaming: !ended,
                          messageId: ids.derive.messageFromProviderItem({
                            driver,
                            nativeItemId: itemKey(turn, key),
                          }),
                        };
                } else if (payload.itemType === "command_execution") {
                  item = {
                    ...base,
                    type: "command_execution",
                    input:
                      stringField(payload.data, "command", "input") ??
                      stringField(record(payload.data)?.arguments, "command", "input") ??
                      (existing?.type === "command_execution" ? existing.input : undefined) ??
                      (!ended ? payload.detail : undefined) ??
                      payload.title ??
                      "Tool execution",
                    output:
                      stringField(payload.data, "output", "stdout") ??
                      stringField(record(payload.data)?.result, "content", "output") ??
                      (ended ? payload.detail : undefined) ??
                      (existing?.type === "command_execution" ? existing.output : undefined),
                  };
                } else if (payload.itemType === "file_change") {
                  item = {
                    ...base,
                    type: "file_change",
                    fileName:
                      stringField(payload.data, "path", "filePath", "file_name") ??
                      (existing?.type === "file_change" ? existing.fileName : undefined) ??
                      payload.title ??
                      "File change",
                    ...(existing?.type === "file_change" && existing.diffStr !== undefined
                      ? { diffStr: existing.diffStr }
                      : {}),
                    ...(stringField(payload.data, "diff")
                      ? { diffStr: stringField(payload.data, "diff") }
                      : {}),
                  };
                } else if (
                  payload.itemType === "dynamic_tool_call" ||
                  payload.itemType === "mcp_tool_call" ||
                  payload.itemType === "collab_agent_tool_call"
                ) {
                  const data = record(payload.data);
                  item = {
                    ...base,
                    type: "dynamic_tool",
                    toolName: payload.title ?? stringField(data, "toolName", "name") ?? null,
                    input:
                      data?.input ??
                      data?.args ??
                      data?.arguments ??
                      (existing?.type === "dynamic_tool" ? existing.input : (payload.data ?? null)),
                    ...(ended
                      ? { output: data?.output ?? data?.result ?? payload.detail ?? null }
                      : {}),
                  };
                } else {
                  item = {
                    ...base,
                    type: "system_notice",
                    message: payload.detail ?? payload.title ?? payload.itemType,
                  };
                }
                yield* emitItem(turn, key, item);
                return;
              }
              case "request.opened":
              case "user-input.requested": {
                if (!event.requestId) return;
                const legacyId = ApprovalRequestId.make(event.requestId);
                const requestId = RuntimeRequestId.make(
                  `${instanceId}:${turn.providerTurn.id}:${event.requestId}`,
                );
                if (requests.has(requestId)) return;
                const base = itemBase(turn, `request:${legacyId}`, timestamp);
                const nodeId = ids.derive.approvalNode({ requestId });
                const kind =
                  event.type === "user-input.requested"
                    ? "user_input"
                    : requestKind(event.payload.requestType);
                const request: OrchestrationV2RuntimeRequest = {
                  id: requestId,
                  nodeId,
                  providerTurnId: turn.providerTurn.id,
                  nativeRequestRef: ref(event.requestId),
                  kind,
                  status: "pending",
                  responseCapability: { type: "live", providerSessionId: input.providerSessionId },
                  createdAt: timestamp,
                  resolvedAt: null,
                };
                const item: Extract<Item, { type: "approval_request" | "user_input_request" }> =
                  event.type === "user-input.requested"
                    ? {
                        ...base,
                        nodeId,
                        type: "user_input_request",
                        requestId,
                        status: "waiting",
                        questions: event.payload.questions.map((question) => ({
                          ...question,
                          options: question.options.map((option) => ({
                            ...option,
                            description: option.description?.trim() || option.label,
                          })),
                        })),
                      }
                    : {
                        ...base,
                        nodeId,
                        type: "approval_request",
                        requestId,
                        status: "waiting",
                        requestKind: requestKind(event.payload.requestType),
                        ...(event.payload.detail ? { prompt: event.payload.detail } : {}),
                        ...(event.payload.options ? { options: event.payload.options } : {}),
                        ...(event.payload.appName ? { appName: event.payload.appName } : {}),
                      };
                requests.set(requestId, { request, item, legacyId, turn });
                yield* emit({
                  type: "runtime_request.updated",
                  driver,
                  threadId: input.threadId,
                  runtimeRequest: request,
                });
                yield* emitItem(turn, `request:${legacyId}`, item);
                yield* updateSession("waiting", timestamp);
                return;
              }
              case "request.resolved":
              case "user-input.resolved": {
                if (!event.requestId) return;
                const requestId = RuntimeRequestId.make(
                  `${instanceId}:${turn.providerTurn.id}:${event.requestId}`,
                );
                yield* resolveRequest(requestId, "resolved", timestamp);
                yield* updateSession("running", timestamp);
                return;
              }
              case "runtime.error":
                turn.failure = makeProviderFailure({
                  message: event.payload.message,
                  ...(event.payload.class === undefined ? {} : { class: event.payload.class }),
                });
                if (event.payload.class === "transport_error")
                  yield* terminal(
                    turn,
                    turn.interrupted ? "interrupted" : "failed",
                    timestamp,
                    true,
                  );
                return;
              case "turn.aborted":
                if (event.payload.tokenUsage)
                  turn.providerTurn = {
                    ...turn.providerTurn,
                    turnTokenUsage: event.payload.tokenUsage,
                  };
                yield* terminal(turn, "interrupted", timestamp);
                return;
              case "turn.completed":
                if (event.payload.tokenUsage)
                  turn.providerTurn = {
                    ...turn.providerTurn,
                    turnTokenUsage: event.payload.tokenUsage,
                  };
                if (event.payload.errorMessage)
                  turn.failure = makeProviderFailure({
                    message: event.payload.errorMessage,
                    class: "provider_error",
                  });
                yield* terminal(
                  turn,
                  turn.interrupted ? "interrupted" : event.payload.state,
                  timestamp,
                );
                return;
            }
          });
        routes.set(legacyThreadId, onEvent);
        appThreads.add(input.threadId);
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            closed = true;
            if (routes.get(legacyThreadId) === onEvent) routes.delete(legacyThreadId);
            appThreads.delete(input.threadId);
            yield* adapter.stopSession(legacyThreadId).pipe(Effect.catchCause(() => Effect.void));
            yield* Queue.shutdown(queue);
          }),
        );
        const resumeCursor =
          nativeId === undefined
            ? undefined
            : profile.resume === "acp"
              ? { schemaVersion: 1, sessionId: nativeId }
              : profile.resume === "sessionId"
                ? { sessionId: nativeId }
                : nativeId;
        const nativeSession: ProviderSession = yield* adapter
          .startSession({
            threadId: legacyThreadId,
            provider: driver,
            providerInstanceId: instanceId,
            cwd: session.cwd,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimePolicy.runtimeMode,
            ...(resumeCursor === undefined ? {} : { resumeCursor }),
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProviderAdapterOpenSessionError({
                  driver,
                  providerSessionId: input.providerSessionId,
                  cause,
                }),
            ),
          );
        nativeId = legacyResumeId(nativeSession.resumeCursor) ?? nativeId;
        yield* updateSession("ready", yield* DateTime.now);

        const ensureThread: ProviderAdapterV2SessionRuntime["ensureThread"] = (ensure) =>
          Effect.gen(function* () {
            if (ensure.threadId !== input.threadId)
              return yield* new ProviderAdapterEnsureThreadError({
                driver,
                threadId: ensure.threadId,
                cause: new Error("This runtime owns a different app thread."),
              });
            const timestamp = yield* DateTime.now;
            const existing = ensure.existingProviderThread;
            providerThread = providerThread ?? {
              id:
                existing?.id ??
                ids.derive.providerThread({
                  driver,
                  providerInstanceId: instanceId,
                  nativeThreadId: nativeId ?? freshNativeId,
                }),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: input.threadId,
              ownerNodeId: null,
              nativeThreadRef: ref(nativeId ?? freshNativeId, nativeId !== undefined),
              nativeConversationHeadRef: existing?.nativeConversationHeadRef ?? null,
              status: "idle",
              firstRunOrdinal: existing?.firstRunOrdinal ?? null,
              lastRunOrdinal: existing?.lastRunOrdinal ?? null,
              handoffIds: existing?.handoffIds ?? [],
              forkedFrom: existing?.forkedFrom ?? null,
              contextUsage: existing?.contextUsage ?? null,
              nativeMetadata: { itemIdentityVersion: 2 },
              createdAt: existing?.createdAt ?? timestamp,
              updatedAt: timestamp,
            };
            yield* emit({ type: "provider_thread.updated", driver, providerThread });
            return providerThread;
          });
        const snapshot = (
          thread: OrchestrationV2ProviderThread,
          providerPayload?: unknown,
        ): ProviderAdapterV2ThreadSnapshot => ({
          providerThread: providerThread ?? thread,
          providerTurns: [...providerTurns.values()],
          messages: [...messages.values()],
          runtimeRequests: [...requests.values()].map((entry) => entry.request),
          ...(providerPayload === undefined ? {} : { providerPayload }),
        });
        const runtime: ProviderAdapterV2SessionRuntime = {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          get providerSession() {
            return session;
          },
          events: Stream.fromQueue(queue),
          ensureThread,
          resumeThread: (resume) =>
            Effect.gen(function* () {
              if (
                resume.providerThread.providerInstanceId !== instanceId ||
                resume.providerThread.appThreadId !== input.threadId
              ) {
                return yield* new ProviderAdapterResumeThreadError({
                  driver,
                  providerSessionId: input.providerSessionId,
                  providerThreadId: resume.providerThread.id,
                  cause: new Error("Provider thread belongs to another runtime."),
                });
              }
              if (
                profile.resume === "none" &&
                resume.providerThread.nativeThreadRef !== null &&
                resume.providerThread.nativeThreadRef.nativeId !== freshNativeId
              ) {
                return yield* new ProviderAdapterResumeThreadError({
                  driver,
                  providerSessionId: input.providerSessionId,
                  providerThreadId: resume.providerThread.id,
                  cause: new Error(
                    "This provider requires portable context after a session restart.",
                  ),
                });
              }
              return yield* ensureThread({
                threadId: input.threadId,
                modelSelection: resume.modelSelection ?? input.modelSelection,
                runtimePolicy: resume.runtimePolicy ?? input.runtimePolicy,
                existingProviderThread: resume.providerThread,
              });
            }),
          // Absent injectHistory deliberately selects V2's budgeted inline handoff.
          startTurn: (turnInput) =>
            Effect.gen(function* () {
              if (
                closed ||
                active ||
                turnInput.threadId !== input.threadId ||
                turnInput.providerThread.id !== providerThread?.id
              ) {
                return yield* new ProviderAdapterProtocolError({
                  driver,
                  detail: "Cannot start a turn on a closed, busy, or foreign runtime",
                });
              }
              const timestamp = yield* DateTime.now;
              const providerTurn: OrchestrationV2ProviderTurn = {
                id: ids.derive.providerTurn({
                  driver,
                  nativeTurnId: `${instanceId}:${providerThread.id}:attempt:${turnInput.attemptId}`,
                }),
                providerThreadId: providerThread.id,
                nodeId: turnInput.rootNodeId,
                runAttemptId: turnInput.attemptId,
                nativeTurnRef: null,
                ordinal: turnInput.providerTurnOrdinal,
                status: "running",
                startedAt: timestamp,
                completedAt: null,
              };
              const turn: ActiveTurn = {
                input: turnInput,
                providerTurn,
                nativeTurnId: undefined,
                items: new Map(),
                nodes: new Map(),
                subagents: new Map(),
                nextOrdinal: turnInput.providerTurnOrdinal * 100 + 1,
                interrupted: false,
                failure: undefined,
                sendFiber: undefined,
              };
              active = turn;
              yield* updateThread(
                {
                  status: "active",
                  firstRunOrdinal: providerThread.firstRunOrdinal ?? turnInput.runOrdinal,
                  lastRunOrdinal: turnInput.runOrdinal,
                },
                timestamp,
              );
              yield* updateSession("running", timestamp);
              yield* updateTurn(turn);
              turn.sendFiber = yield* Effect.suspend(() =>
                active !== turn || turn.interrupted
                  ? Effect.void
                  : adapter
                      .sendTurn({
                        threadId: legacyThreadId,
                        ...(turnInput.message.text.trim().length
                          ? { input: turnInput.message.text }
                          : {}),
                        attachments: turnInput.message.attachments,
                        modelSelection: turnInput.modelSelection,
                        interactionMode: turnInput.runtimePolicy.interactionMode,
                      })
                      .pipe(
                        Effect.flatMap((started) =>
                          Effect.gen(function* () {
                            const now = yield* DateTime.now;
                            yield* updateNativeId(started.resumeCursor, now);
                            if (active !== turn) {
                              completedNativeTurns.add(started.turnId);
                              return;
                            }
                            turn.nativeTurnId = started.turnId;
                            turn.providerTurn = {
                              ...turn.providerTurn,
                              nativeTurnRef: ref(started.turnId),
                            };
                            yield* updateTurn(turn);
                          }),
                        ),
                        Effect.catchCause((cause) =>
                          Effect.gen(function* () {
                            if (Cause.hasInterrupts(cause)) return;
                            turn.failure = makeProviderFailure({ cause, class: "provider_error" });
                            yield* terminal(
                              turn,
                              turn.interrupted ? "interrupted" : "failed",
                              yield* DateTime.now,
                            );
                          }),
                        ),
                      ),
              ).pipe(Effect.forkIn(scope));
            }),
          steerTurn: (steer) =>
            Effect.fail(
              new ProviderAdapterSteerRunUnsupportedError({
                driver,
                providerThreadId: steer.providerThread.id,
              }),
            ),
          interruptTurn: (interrupt) =>
            Effect.gen(function* () {
              const turn = active;
              if (
                !turn ||
                turn.providerTurn.id !== interrupt.providerTurnId ||
                turn.providerTurn.providerThreadId !== interrupt.providerThread.id
              )
                return;
              turn.interrupted = true;
              yield* adapter.interruptTurn(legacyThreadId, turn.nativeTurnId).pipe(
                Effect.mapError((cause) => {
                  turn.interrupted = false;
                  return new ProviderAdapterInterruptError({
                    driver,
                    providerThreadId: interrupt.providerThread.id,
                    providerTurnId: interrupt.providerTurnId,
                    cause,
                  });
                }),
              );
              if (turn.sendFiber) yield* Fiber.interrupt(turn.sendFiber);
              if (profile.restartOnInterrupt || interrupt.requestRuntimeRestart) {
                yield* adapter.stopSession(legacyThreadId).pipe(
                  Effect.mapError(
                    (cause) =>
                      new ProviderAdapterInterruptError({
                        driver,
                        providerThreadId: interrupt.providerThread.id,
                        providerTurnId: interrupt.providerTurnId,
                        cause,
                      }),
                  ),
                );
              }
              // Legacy interrupt methods acknowledge cancellation of their producer.
              // Terminalize even if the provider omits its final notification.
              yield* terminal(
                turn,
                "interrupted",
                yield* DateTime.now,
                profile.restartOnInterrupt || interrupt.requestRuntimeRestart,
              );
            }),
          respondToRuntimeRequest: (response) =>
            Effect.gen(function* () {
              const entry = requests.get(response.requestId);
              if (!entry || entry.request.status !== "pending" || active !== entry.turn) {
                return yield* new ProviderAdapterRuntimeRequestResponseError({
                  driver,
                  requestId: response.requestId,
                  cause: new Error("Request is no longer live."),
                });
              }
              const action: Effect.Effect<void, E | ProviderAdapterRuntimeRequestResponseError> =
                entry.request.kind === "user_input" && response.answers !== undefined
                  ? adapter.respondToUserInput(legacyThreadId, entry.legacyId, response.answers)
                  : entry.request.kind !== "user_input" && response.decision !== undefined
                    ? adapter.respondToRequest(legacyThreadId, entry.legacyId, response.decision)
                    : Effect.fail(
                        new ProviderAdapterRuntimeRequestResponseError({
                          driver,
                          requestId: response.requestId,
                          cause: new Error("Response does not match the request kind."),
                        }),
                      );
              yield* action.pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRuntimeRequestResponseError({
                      driver,
                      requestId: response.requestId,
                      cause,
                    }),
                ),
              );
              entry.request = {
                ...entry.request,
                ...(response.decision ? { decision: response.decision } : {}),
                ...(response.answers ? { answers: response.answers } : {}),
              };
              yield* resolveRequest(response.requestId, "resolved", yield* DateTime.now);
              yield* emit({
                type: "runtime_request.updated",
                driver,
                threadId: input.threadId,
                runtimeRequest: entry.request,
              });
            }),
          readThreadSnapshot: (read) =>
            profile.nativeHistory
              ? adapter.readThread(legacyThreadId).pipe(
                  Effect.map((payload) => {
                    const current = snapshot(read.providerThread, payload);
                    const history: Array<OrchestrationV2ConversationMessage> =
                      readLegacyHistoryMessages(payload)
                        .filter((message) => !streamedMessageNativeIds.has(message.nativeId))
                        .map((message) => ({
                          id: ids.derive.messageFromProviderItem({
                            driver,
                            nativeItemId: `${instanceId}:${read.providerThread.id}:history:${message.nativeId}`,
                          }),
                          threadId: input.threadId,
                          runId: null,
                          nodeId: null,
                          role: message.role,
                          text: message.text,
                          attachments: [],
                          streaming: false,
                          createdBy: message.role === "user" ? "user" : "agent",
                          creationSource: "provider",
                          createdAt: read.providerThread.createdAt,
                          updatedAt: read.providerThread.updatedAt,
                        }));
                    return { ...current, messages: [...history, ...current.messages] };
                  }),
                  Effect.mapError(
                    (cause) =>
                      new ProviderAdapterReadThreadSnapshotError({
                        driver,
                        providerThreadId: read.providerThread.id,
                        cause,
                      }),
                  ),
                )
              : Effect.succeed(snapshot(read.providerThread)),
          rollbackThread: (rollback) =>
            Effect.fail(
              new ProviderAdapterRollbackThreadError({
                driver,
                providerThreadId: rollback.providerThread.id,
                checkpointId: rollback.target.checkpointId,
                cause: new Error("Native conversation rollback is unavailable for this runtime."),
              }),
            ),
          forkThread: (fork) =>
            Effect.fail(
              new ProviderAdapterForkThreadError({
                driver,
                providerThreadId: fork.sourceProviderThread.id,
                cause: new Error("Use orchestration context transfer to fork this runtime."),
              }),
            ),
        };
        return runtime;
      }),
  };
  return result;
});
