import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  HERMES_DRIVER_KIND,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { IdAllocatorV2, layer as idAllocatorLayer } from "./IdAllocator.ts";
import { emptyProjection, applyToProjection } from "./ProjectionStore.ts";
import { legacyAdapterV2Capabilities } from "./Adapters/LegacyAdapterV2.ts";
import { planHermesNotificationDelivery } from "./HermesNotificationDelivery.ts";

const threadId = ThreadId.make("hermes-home");
const instanceId = ProviderInstanceId.make("hermes-own");
const now = DateTime.makeUnsafe("2026-09-22T12:00:00.000Z");
const command: Extract<OrchestrationV2Command, { type: "thread.notification.deliver" }> = {
  type: "thread.notification.deliver",
  commandId: CommandId.make("delivery-command"),
  threadId,
  expectedProviderInstanceId: instanceId,
  messageId: MessageId.make("delivery-message"),
  deliveryId: "native-delivery",
  kind: "cron",
  label: "Daily report",
  text: "Completed elsewhere",
  createdAt: DateTime.formatIso(now),
};
function projection(): OrchestrationV2ThreadProjection {
  return emptyProjection({
    id: EventId.make("thread-created"),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload: {
      id: threadId,
      projectId: ProjectId.make("hermes-project"),
      title: "Home",
      providerInstanceId: instanceId,
      modelSelection: { instanceId, model: "hermes" },
      createdBy: "agent",
      creationSource: "server",
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
      forkedFrom: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      deletedAt: null,
      settledOverride: "settled",
      settledAt: now,
      snoozedUntil: now,
      lastVisitedAt: null,
    },
  });
}
const plan = (current: OrchestrationV2ThreadProjection, override: Partial<typeof command> = {}) =>
  Effect.gen(function* () {
    return yield* planHermesNotificationDelivery({
      command: { ...command, ...override },
      projection: current,
      now,
      idAllocator: yield* IdAllocatorV2,
    });
  });

it.effect("appends proactive assistant output without a run and wakes parked threads", () =>
  Effect.gen(function* () {
    const result = yield* plan(projection());
    expect(result.effects).toEqual([]);
    expect(result.events.map((event) => event.type)).toEqual([
      "thread.metadata-updated",
      "message.updated",
      "turn-item.updated",
    ]);
    const next = result.events.reduce(applyToProjection, projection());
    expect(next.runs).toEqual([]);
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0]).toMatchObject({
      role: "assistant",
      text: "> Daily report\n\nCompleted elsewhere",
      runId: null,
      streaming: false,
    });
    expect(next.thread.settledOverride).toBe(null);
    expect(next.thread.snoozedUntil).toBe(null);
  }).pipe(Effect.provide(idAllocatorLayer)),
);

it.effect("does not duplicate or overwrite a message when a delivery is retried", () =>
  Effect.gen(function* () {
    const first = yield* plan(projection());
    const persisted = first.events.reduce(applyToProjection, projection());
    const repeated = yield* plan(persisted, {
      commandId: CommandId.make("different-command"),
      text: "Changed retry body",
    });
    const next = repeated.events.reduce(applyToProjection, persisted);
    expect(next.messages).toHaveLength(1);
    expect(next.turnItems).toHaveLength(1);
    expect(next.messages[0]?.text).toBe("> Daily report\n\nCompleted elsewhere");
    expect(repeated.effects).toEqual([]);
  }).pipe(Effect.provide(idAllocatorLayer)),
);

it.effect("refuses delivery after the destination changes provider ownership", () =>
  Effect.gen(function* () {
    const current = projection();
    const foreign = {
      ...current,
      thread: { ...current.thread, providerInstanceId: ProviderInstanceId.make("other") },
    };
    const result = yield* plan(foreign).pipe(Effect.result);
    expect(result._tag).toBe("Failure");
  }).pipe(Effect.provide(idAllocatorLayer)),
);

it.effect("refuses stale native-turn media instead of attaching it to an unrelated run", () =>
  Effect.gen(function* () {
    const result = yield* plan(projection(), { turnId: TurnId.make("untracked-native-turn") }).pipe(
      Effect.result,
    );
    expect(result._tag).toBe("Failure");
  }).pipe(Effect.provide(idAllocatorLayer)),
);

it.effect("records native-turn media under the owning V2 run", () =>
  Effect.gen(function* () {
    const base = projection();
    const providerThreadId = ProviderThreadId.make("provider-thread");
    const providerSessionId = ProviderSessionId.make("provider-session");
    const providerTurnId = ProviderTurnId.make("provider-turn");
    const runId = RunId.make("existing-run");
    const attemptId = RunAttemptId.make("attempt");
    const nodeId = NodeId.make("root");
    const current: OrchestrationV2ThreadProjection = {
      ...base,
      providerThreads: [
        {
          id: providerThreadId,
          driver: HERMES_DRIVER_KIND,
          providerInstanceId: instanceId,
          providerSessionId,
          appThreadId: threadId,
          ownerNodeId: null,
          nativeThreadRef: {
            driver: HERMES_DRIVER_KIND,
            nativeId: "native-session",
            strength: "strong",
          },
          nativeConversationHeadRef: null,
          status: "active",
          firstRunOrdinal: 1,
          lastRunOrdinal: 1,
          handoffIds: [],
          forkedFrom: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      providerSessions: [
        {
          id: providerSessionId,
          driver: HERMES_DRIVER_KIND,
          providerInstanceId: instanceId,
          status: "running",
          cwd: "/workspace",
          model: "hermes",
          capabilities: legacyAdapterV2Capabilities(
            {
              resume: "acp",
              nativeHistory: false,
              reasoning: true,
              approvals: true,
              questions: true,
              mcp: true,
            },
            true,
          ),
          createdAt: now,
          updatedAt: now,
          lastError: null,
        },
      ],
      providerTurns: [
        {
          id: providerTurnId,
          providerThreadId,
          nodeId,
          runAttemptId: attemptId,
          nativeTurnRef: { driver: HERMES_DRIVER_KIND, nativeId: "native-turn", strength: "weak" },
          ordinal: 1,
          status: "running",
          startedAt: now,
          completedAt: null,
        },
      ],
      attempts: [
        {
          id: attemptId,
          runId,
          attemptOrdinal: 1,
          rootNodeId: nodeId,
          providerInstanceId: instanceId,
          providerThreadId,
          providerTurnId,
          reason: "initial",
          status: "running",
          startedAt: now,
          completedAt: null,
        },
      ],
      runs: [
        {
          id: runId,
          threadId,
          ordinal: 1,
          providerInstanceId: instanceId,
          modelSelection: base.thread.modelSelection,
          providerThreadId,
          userMessageId: MessageId.make("user-message"),
          rootNodeId: nodeId,
          activeAttemptId: attemptId,
          status: "running",
          requestedAt: now,
          startedAt: now,
          completedAt: null,
          checkpointId: null,
          contextHandoffId: null,
        },
      ],
    };
    const result = yield* plan(current, { turnId: TurnId.make("native-turn") });
    const message = result.events.find((event) => event.type === "message.updated");
    expect(message?.payload.runId).toBe(runId);
    expect(message?.payload.nodeId).toBe(nodeId);
    expect(result.events.some((event) => event.type === "run.updated")).toBe(false);
  }).pipe(Effect.provide(idAllocatorLayer)),
);

it.effect("lifecycle notices preserve settlement and snooze", () =>
  Effect.gen(function* () {
    const result = yield* plan(projection(), { kind: "lifecycle" });
    const next = result.events.reduce(applyToProjection, projection());
    expect(next.thread.settledOverride).toBe("settled");
    expect(next.thread.snoozedUntil).toEqual(now);
  }).pipe(Effect.provide(idAllocatorLayer)),
);
