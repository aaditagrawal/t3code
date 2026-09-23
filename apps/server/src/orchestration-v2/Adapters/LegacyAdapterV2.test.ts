import { describe, expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  RuntimeItemId,
  RuntimeRequestId,
  RuntimeTaskId,
  ThreadId,
  TurnId,
  ProviderRuntimeEvent,
  type ProviderSessionStartInput,
  type ProviderUsageLimitsUpdate,
  type OrchestrationV2AppThread,
  type OrchestrationV2ProviderThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ProviderAdapterRequestError } from "../../provider/Errors.ts";
import type { ProviderAdapterShape } from "../../provider/Services/ProviderAdapter.ts";
import { layer as idAllocatorLayer } from "../IdAllocator.ts";
import { ProviderAdapterV2Event, type ProviderAdapterV2TurnInput } from "../ProviderAdapter.ts";
import {
  LEGACY_ADAPTER_V2_PROFILES,
  makeLegacyAdapterV2,
  readLegacyHistoryMessages,
  type LegacyAdapterV2Profile,
} from "./LegacyAdapterV2.ts";

const decodeRuntimeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);
const isV2Event = Schema.is(ProviderAdapterV2Event);

const instanceId = ProviderInstanceId.make("fork-instance");
const driver = ProviderDriverKind.make("copilot");
const timestamp = "2026-09-22T12:00:00.000Z";
const date = DateTime.makeUnsafe(timestamp);
const modelSelection = { instanceId, model: "test-model" };
const runtimePolicy = {
  runtimeMode: "full-access",
  interactionMode: "default",
  cwd: "/workspace",
} as const;

const makeHarness = Effect.fn(function* (
  profile: LegacyAdapterV2Profile = LEGACY_ADAPTER_V2_PROFILES.copilot,
  sendInline = false,
) {
  const legacyEvents = yield* Queue.unbounded<ProviderRuntimeEvent>();
  const starts: Array<ProviderSessionStartInput> = [];
  const answers: Array<{
    readonly threadId: ThreadId;
    readonly requestId: string;
    readonly answer: unknown;
  }> = [];
  const stops: Array<ThreadId> = [];
  const limits: Array<ProviderUsageLimitsUpdate> = [];
  const legacyRouting = new Map<ThreadId, ThreadId>();
  let nextTurn = 0;
  let nextEvent = 0;
  let failSend = false;
  const emit = (
    threadId: ThreadId,
    payload: Omit<
      ProviderRuntimeEvent,
      "eventId" | "provider" | "providerInstanceId" | "threadId" | "createdAt"
    >,
  ) => {
    // The discriminated union is preserved by each caller's typed event below.
    return Queue.offer(
      legacyEvents,
      decodeRuntimeEvent({
        ...payload,
        eventId: EventId.make(`event-${++nextEvent}`),
        provider: driver,
        providerInstanceId: instanceId,
        threadId: legacyRouting.get(threadId) ?? threadId,
        createdAt: timestamp,
      }),
    );
  };
  const adapter: ProviderAdapterShape<Error> = {
    provider: driver,
    capabilities: { sessionModelSwitch: "in-session", supportsConversationRollback: false },
    startSession: (input) =>
      Effect.sync(() => {
        starts.push(input);
        return {
          provider: driver,
          providerInstanceId: instanceId,
          threadId: input.threadId,
          status: "ready",
          runtimeMode: input.runtimeMode,
          cwd: "/workspace",
          model: "test-model",
          ...(profile.resume === "none"
            ? {}
            : { resumeCursor: input.resumeCursor ?? `native-${input.threadId}` }),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
      }),
    sendTurn: (input) =>
      Effect.gen(function* () {
        if (failSend)
          return yield* Effect.fail(
            new ProviderAdapterRequestError({
              provider: "copilot",
              method: "sendTurn",
              detail: "Provider send failed.",
            }),
          );
        const turnId = TurnId.make(`legacy-turn-${++nextTurn}`);
        yield* emit(input.threadId, { type: "turn.started", turnId, payload: {} });
        if (sendInline) {
          yield* emit(input.threadId, {
            type: "content.delta",
            turnId,
            itemId: RuntimeItemId.make("answer"),
            payload: { streamKind: "assistant_text", delta: "finished before send returns" },
          });
          yield* emit(input.threadId, {
            type: "turn.completed",
            turnId,
            payload: { state: "completed" },
          });
          yield* Effect.yieldNow;
        }
        return { threadId: input.threadId, turnId };
      }),
    interruptTurn: () => Effect.void,
    respondToRequest: (threadId, requestId, answer) =>
      Effect.sync(() => {
        answers.push({ threadId, requestId, answer });
      }),
    respondToUserInput: (threadId, requestId, answer) =>
      Effect.sync(() => {
        answers.push({ threadId, requestId, answer });
      }),
    stopSession: (threadId) =>
      Effect.sync(() => {
        stops.push(threadId);
      }),
    listSessions: () => Effect.succeed([]),
    hasSession: () => Effect.succeed(true),
    readThread: (threadId) => Effect.succeed({ threadId, turns: [] }),
    rollbackThread: () =>
      Effect.fail(
        new ProviderAdapterRequestError({
          provider: "copilot",
          method: "rollbackThread",
          detail: "unsupported",
        }),
      ),
    stopAll: () => Effect.void,
    streamEvents: Stream.fromQueue(legacyEvents),
  };
  const bridge = yield* makeLegacyAdapterV2({
    instanceId,
    adapter,
    profile,
    cwd: "/workspace",
    onUsageLimits: (value) =>
      Effect.sync(() => {
        limits.push(value);
      }),
  });
  const open = (name: string, initialNativeThreadId?: string) =>
    Effect.gen(function* () {
      const threadId = ThreadId.make(name);
      const runtime = yield* bridge.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make(`session-${name}`),
        modelSelection,
        runtimePolicy,
        ...(initialNativeThreadId ? { initialNativeThreadId } : {}),
      });
      const legacyThreadId = starts.at(-1)?.threadId;
      if (!legacyThreadId) throw new Error("Native session did not start.");
      legacyRouting.set(threadId, legacyThreadId);
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const output = yield* Queue.unbounded<ProviderAdapterV2Event>();
      yield* runtime.events.pipe(
        Stream.runForEach((event) => Queue.offer(output, event)),
        Effect.forkScoped,
      );
      return { runtime, providerThread, output, threadId, legacyThreadId };
    });
  return {
    open,
    emit,
    starts,
    answers,
    stops,
    limits,
    bridge,
    failNextSend: () => {
      failSend = true;
    },
  };
});

type Opened = Effect.Success<ReturnType<Effect.Success<ReturnType<typeof makeHarness>>["open"]>>;
function turnInput(opened: Opened, ordinal = 1): ProviderAdapterV2TurnInput {
  const runId = RunId.make(`${opened.threadId}-run-${ordinal}`);
  const appThread: OrchestrationV2AppThread = {
    id: opened.threadId,
    projectId: ProjectId.make("project"),
    title: "Test",
    providerInstanceId: instanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: opened.providerThread.id,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: opened.threadId },
    forkedFrom: null,
    createdAt: date,
    updatedAt: date,
    archivedAt: null,
    deletedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    createdBy: "user",
    creationSource: "web",
  };
  return {
    appThread,
    threadId: opened.threadId,
    runId,
    runOrdinal: ordinal,
    providerTurnOrdinal: ordinal,
    attemptId: RunAttemptId.make(`${runId}-attempt`),
    rootNodeId: NodeId.make(`${runId}-root`),
    providerThread: opened.providerThread,
    message: {
      messageId: MessageId.make(`${runId}-message`),
      text: "hello",
      attachments: [],
      createdBy: "user",
      creationSource: "web",
      scheduledTaskId: undefined,
      senderThreadId: undefined,
    },
    modelSelection,
    runtimePolicy,
  };
}
const nextMatching = (
  output: Queue.Queue<ProviderAdapterV2Event>,
  predicate: (event: ProviderAdapterV2Event) => boolean,
) =>
  Effect.gen(function* () {
    while (true) {
      const event = yield* Queue.take(output);
      expect(isV2Event(event)).toBe(true);
      if (predicate(event)) return event;
    }
  });
const untilTerminal = (output: Queue.Queue<ProviderAdapterV2Event>) =>
  Effect.gen(function* () {
    const events: Array<ProviderAdapterV2Event> = [];
    while (true) {
      const event = yield* Queue.take(output);
      expect(isV2Event(event)).toBe(true);
      events.push(event);
      if (event.type === "turn.terminal") return events;
    }
  });
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    import("effect/Scope").Scope | import("../IdAllocator.ts").IdAllocatorV2
  >,
) => effect.pipe(Effect.scoped, Effect.provide(idAllocatorLayer));

describe("legacy provider V2 bridge", () => {
  it.effect(
    "isolates delayed exits from a closed SDK session after reopening the same app thread",
    () =>
      run(
        Effect.gen(function* () {
          const harness = yield* makeHarness();
          const oldRoute = yield* harness.open("reopened").pipe(
            Effect.map((opened) => opened.legacyThreadId),
            Effect.scoped,
          );
          const reopened = yield* harness.open("reopened");
          expect(reopened.legacyThreadId).not.toBe(oldRoute);
          yield* harness.emit(oldRoute, {
            type: "session.exited",
            payload: { exitKind: "error", reason: "Old process exited late" },
          });
          yield* reopened.runtime.startTurn(turnInput(reopened));
          yield* harness.emit(reopened.threadId, {
            type: "content.delta",
            payload: { streamKind: "assistant_text", delta: "Still live" },
          });
          yield* harness.emit(reopened.threadId, {
            type: "turn.completed",
            payload: { state: "completed" },
          });
          const events = yield* untilTerminal(reopened.output);
          expect(
            events.some(
              (event) =>
                event.type === "provider_session.updated" &&
                event.providerSession.status === "stopped",
            ),
          ).toBe(false);
          expect(events.at(-1)).toMatchObject({ type: "turn.terminal", status: "completed" });
        }),
      ),
  );

  it("rehydrates native Copilot and Kilo text history without treating tools as messages", () => {
    const messages = readLegacyHistoryMessages({
      threadId: ThreadId.make("history"),
      turns: [
        {
          id: TurnId.make("native-turn"),
          items: [
            {
              type: "assistant.message",
              data: { messageId: "copilot-answer", content: "Saved answer" },
            },
            { type: "tool.execution_complete", data: { content: "Tool output" } },
            {
              info: { id: "kilo-user", role: "user" },
              parts: [
                { type: "text", text: "Earlier question" },
                { type: "file", url: "ignored" },
              ],
            },
          ],
        },
      ],
    });
    expect(messages).toEqual([
      { nativeId: "copilot-answer", role: "assistant", text: "Saved answer" },
      { nativeId: "kilo-user", role: "user", text: "Earlier question" },
    ]);
  });

  it.effect(
    "retains Droid tool inputs and terminal output when completion only carries detail",
    () =>
      run(
        Effect.gen(function* () {
          const harness = yield* makeHarness(LEGACY_ADAPTER_V2_PROFILES.droid);
          const opened = yield* harness.open("tool-output");
          yield* opened.runtime.startTurn(turnInput(opened));
          const toolId = RuntimeItemId.make("shell-tool");
          yield* harness.emit(opened.threadId, {
            type: "item.started",
            itemId: toolId,
            payload: { itemType: "command_execution", title: "Execute", data: { command: "pwd" } },
          });
          yield* harness.emit(opened.threadId, {
            type: "item.completed",
            itemId: toolId,
            payload: {
              itemType: "command_execution",
              title: "Execute",
              status: "completed",
              detail: "/workspace",
            },
          });
          const fileId = RuntimeItemId.make("edit-tool");
          yield* harness.emit(opened.threadId, {
            type: "item.started",
            itemId: fileId,
            payload: {
              itemType: "file_change",
              title: "Edit",
              data: { path: "src/app.ts", diff: "+fixed" },
            },
          });
          yield* harness.emit(opened.threadId, {
            type: "item.completed",
            itemId: fileId,
            payload: {
              itemType: "file_change",
              title: "Edit",
              status: "completed",
              detail: "Updated src/app.ts",
            },
          });
          yield* harness.emit(opened.threadId, {
            type: "turn.completed",
            payload: { state: "completed" },
          });
          const events = yield* untilTerminal(opened.output);
          expect(
            events.find(
              (event) =>
                event.type === "turn_item.updated" &&
                event.turnItem.type === "command_execution" &&
                event.turnItem.status === "completed",
            ),
          ).toMatchObject({
            turnItem: { input: "pwd", output: "/workspace" },
          });
          expect(
            events.find(
              (event) =>
                event.type === "turn_item.updated" &&
                event.turnItem.type === "file_change" &&
                event.turnItem.status === "completed",
            ),
          ).toMatchObject({
            turnItem: { fileName: "src/app.ts", diffStr: "+fixed" },
          });
        }),
      ),
  );

  it.effect("reads Copilot argument and result envelopes without replacing tool inputs", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const opened = yield* harness.open("copilot-tools");
        yield* opened.runtime.startTurn(turnInput(opened));
        const shellId = RuntimeItemId.make("shell-tool");
        yield* harness.emit(opened.threadId, {
          type: "item.started",
          itemId: shellId,
          payload: {
            itemType: "command_execution",
            title: "bash",
            data: { arguments: { command: "pwd" } },
          },
        });
        yield* harness.emit(opened.threadId, {
          type: "item.completed",
          itemId: shellId,
          payload: {
            itemType: "command_execution",
            title: "bash",
            status: "completed",
            data: { result: { content: "/workspace" } },
          },
        });
        const toolId = RuntimeItemId.make("search-tool");
        yield* harness.emit(opened.threadId, {
          type: "item.started",
          itemId: toolId,
          payload: {
            itemType: "dynamic_tool_call",
            title: "search",
            data: { arguments: { query: "needle" } },
          },
        });
        yield* harness.emit(opened.threadId, {
          type: "item.completed",
          itemId: toolId,
          payload: {
            itemType: "dynamic_tool_call",
            title: "search",
            status: "completed",
            data: { result: { content: "found" } },
          },
        });
        yield* harness.emit(opened.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        });
        const events = yield* untilTerminal(opened.output);
        expect(
          events.find(
            (event) =>
              event.type === "turn_item.updated" &&
              event.turnItem.type === "command_execution" &&
              event.turnItem.status === "completed",
          ),
        ).toMatchObject({
          turnItem: { input: "pwd", output: "/workspace" },
        });
        expect(
          events.find(
            (event) =>
              event.type === "turn_item.updated" &&
              event.turnItem.type === "dynamic_tool" &&
              event.turnItem.status === "completed",
          ),
        ).toMatchObject({
          turnItem: { input: { query: "needle" }, output: { content: "found" } },
        });
      }),
    ),
  );

  it.effect("preserves plans and subagent lifecycle in V2 projections", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const opened = yield* harness.open("plans");
        yield* opened.runtime.startTurn(turnInput(opened));
        yield* harness.emit(opened.threadId, {
          type: "turn.proposed.delta",
          payload: { delta: "Inspect " },
        });
        yield* harness.emit(opened.threadId, {
          type: "turn.proposed.completed",
          payload: { planMarkdown: "Inspect the code" },
        });
        yield* harness.emit(opened.threadId, {
          type: "turn.plan.updated",
          payload: { plan: [{ step: "Inspect", status: "inProgress" }] },
        });
        yield* harness.emit(opened.threadId, {
          type: "task.started",
          payload: {
            taskId: RuntimeTaskId.make("worker"),
            description: "Inspect files",
            taskType: "subagent",
          },
        });
        yield* harness.emit(opened.threadId, {
          type: "task.progress",
          payload: { taskId: RuntimeTaskId.make("worker"), description: "Reading" },
        });
        yield* harness.emit(opened.threadId, {
          type: "task.completed",
          payload: {
            taskId: RuntimeTaskId.make("worker"),
            status: "completed",
            summary: "Inspected",
          },
        });
        yield* harness.emit(opened.threadId, {
          type: "turn.completed",
          payload: { state: "completed" },
        });
        const events = yield* untilTerminal(opened.output);
        expect(
          events.some(
            (e) =>
              e.type === "plan.updated" &&
              e.plan.kind === "proposed_plan" &&
              e.plan.markdown === "Inspect the code",
          ),
        ).toBe(true);
        expect(
          events.some(
            (e) =>
              e.type === "turn_item.updated" &&
              e.turnItem.type === "todo_list" &&
              e.turnItem.steps[0]?.status === "running",
          ),
        ).toBe(true);
        expect(events.findLast((e) => e.type === "subagent.updated")?.subagent).toMatchObject({
          status: "completed",
          result: "Inspected",
        });
      }),
    ),
  );

  it.effect("reconstructs versioned ACP resume cursors", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness({
          ...LEGACY_ADAPTER_V2_PROFILES.copilot,
          resume: "acp",
        });
        yield* harness.open("acp", "saved-session");
        expect(harness.starts[0]?.resumeCursor).toEqual({
          schemaVersion: 1,
          sessionId: "saved-session",
        });
      }),
    ),
  );

  it.effect(
    "routes concurrent sessions without stealing events and completes streamed messages",
    () =>
      run(
        Effect.gen(function* () {
          const harness = yield* makeHarness();
          const a = yield* harness.open("a");
          const b = yield* harness.open("b");
          yield* a.runtime.startTurn(turnInput(a));
          yield* b.runtime.startTurn(turnInput(b));
          yield* harness.emit(a.threadId, {
            type: "content.delta",
            itemId: RuntimeItemId.make("shared-native-item"),
            payload: { streamKind: "assistant_text", delta: "A" },
          });
          yield* harness.emit(b.threadId, {
            type: "content.delta",
            itemId: RuntimeItemId.make("shared-native-item"),
            payload: { streamKind: "assistant_text", delta: "B" },
          });
          yield* harness.emit(a.threadId, {
            type: "turn.completed",
            payload: { state: "completed" },
          });
          yield* harness.emit(b.threadId, {
            type: "turn.completed",
            payload: { state: "completed" },
          });
          const ea = yield* untilTerminal(a.output);
          const eb = yield* untilTerminal(b.output);
          const ma = ea.findLast((e) => e.type === "message.updated");
          const mb = eb.findLast((e) => e.type === "message.updated");
          expect(ma?.message.text).toBe("A");
          expect(mb?.message.text).toBe("B");
          expect(ma?.message.streaming).toBe(false);
          expect(mb?.message.streaming).toBe(false);
          expect(ma?.message.id).not.toBe(mb?.message.id);
        }),
      ),
  );

  it.effect("handles a terminal event before legacy sendTurn returns", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness(undefined, true);
        const opened = yield* harness.open("sync");
        yield* opened.runtime.startTurn(turnInput(opened));
        const events = yield* untilTerminal(opened.output);
        expect(events.filter((event) => event.type === "turn.terminal")).toHaveLength(1);
        yield* Effect.yieldNow;
        expect(opened.runtime.providerSession.status).toBe("ready");
        const snapshot = yield* opened.runtime.readThreadSnapshot({
          providerThread: opened.providerThread,
        });
        expect(snapshot.messages.at(-1)?.text).toBe("finished before send returns");
        expect(snapshot.providerTurns.at(-1)?.status).toBe("completed");
      }),
    ),
  );

  it.effect("routes questions to native IDs and expires callbacks when interrupted", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const opened = yield* harness.open("questions");
        yield* opened.runtime.startTurn(turnInput(opened));
        yield* harness.emit(opened.threadId, {
          type: "user-input.requested",
          requestId: RuntimeRequestId.make("native-question"),
          payload: {
            questions: [
              {
                id: "q",
                header: "Choice",
                question: "Choose one",
                options: [{ label: "One", description: "" }],
                multiSelect: false,
              },
            ],
          },
        });
        const event = yield* nextMatching(
          opened.output,
          (e) => e.type === "runtime_request.updated",
        );
        if (event.type !== "runtime_request.updated") throw new Error("request expected");
        yield* opened.runtime.respondToRuntimeRequest({
          requestId: event.runtimeRequest.id,
          answers: { q: "One" },
        });
        expect(harness.answers).toEqual([
          { threadId: opened.legacyThreadId, requestId: "native-question", answer: { q: "One" } },
        ]);
        yield* harness.emit(opened.threadId, {
          type: "request.opened",
          requestId: RuntimeRequestId.make("approval"),
          payload: { requestType: "command_execution_approval", detail: "Run a command" },
        });
        const approval = yield* nextMatching(
          opened.output,
          (e) => e.type === "runtime_request.updated" && e.runtimeRequest.status === "pending",
        );
        if (approval.type !== "runtime_request.updated" || !approval.runtimeRequest.providerTurnId)
          throw new Error("approval expected");
        yield* opened.runtime.interruptTurn({
          providerThread: opened.providerThread,
          providerTurnId: approval.runtimeRequest.providerTurnId,
        });
        const events = yield* untilTerminal(opened.output);
        expect(
          events.some(
            (e) => e.type === "runtime_request.updated" && e.runtimeRequest.status === "expired",
          ),
        ).toBe(true);
        const stale = yield* opened.runtime
          .respondToRuntimeRequest({ requestId: approval.runtimeRequest.id, decision: "accept" })
          .pipe(Effect.result);
        expect(stale._tag).toBe("Failure");
        expect(harness.answers).toHaveLength(1);
      }),
    ),
  );

  it.effect("ignores late completion from an interrupted previous native turn", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const opened = yield* harness.open("late");
        yield* opened.runtime.startTurn(turnInput(opened));
        const started = yield* nextMatching(
          opened.output,
          (e) =>
            e.type === "provider_turn.updated" &&
            e.providerTurn.nativeTurnRef?.nativeId === "legacy-turn-1",
        );
        if (started.type !== "provider_turn.updated") throw new Error("turn expected");
        yield* opened.runtime.interruptTurn({
          providerThread: opened.providerThread,
          providerTurnId: started.providerTurn.id,
        });
        yield* untilTerminal(opened.output);
        yield* opened.runtime.startTurn(turnInput(opened, 2));
        yield* harness.emit(opened.threadId, {
          type: "thread.token-usage.updated",
          turnId: TurnId.make("legacy-turn-1"),
          payload: { usage: { usedTokens: 999 } },
        });
        yield* harness.emit(opened.threadId, {
          type: "turn.completed",
          turnId: TurnId.make("legacy-turn-1"),
          payload: { state: "completed" },
        });
        yield* harness.emit(opened.threadId, {
          type: "content.delta",
          turnId: TurnId.make("legacy-turn-2"),
          payload: { streamKind: "assistant_text", delta: "new turn" },
        });
        yield* harness.emit(opened.threadId, {
          type: "turn.completed",
          turnId: TurnId.make("legacy-turn-2"),
          payload: { state: "completed" },
        });
        const events = yield* untilTerminal(opened.output);
        expect(events.at(-1)).toMatchObject({
          type: "turn.terminal",
          status: "completed",
          runOrdinal: 2,
        });
        expect(
          events.some((e) => e.type === "message.updated" && e.message.text === "new turn"),
        ).toBe(true);
        expect(
          events.some(
            (event) =>
              event.type === "provider_turn.updated" &&
              event.providerTurn.tokenUsage?.usedTokens === 999,
          ),
        ).toBe(false);
        const snapshot = yield* opened.runtime.readThreadSnapshot({
          providerThread: opened.providerThread,
        });
        expect(snapshot.providerThread.contextUsage).toBeNull();
      }),
    ),
  );

  it.effect("preserves quota updates without a session and turn/context usage", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const limits = {
          windows: [{ id: "monthly", kind: "monthly", label: "Monthly", usedPercent: 42 }],
        } as const;
        yield* harness.emit(ThreadId.make("no-session"), {
          type: "account.rate-limits.updated",
          payload: { limits },
        });
        const opened = yield* harness.open("usage");
        yield* opened.runtime.startTurn(turnInput(opened));
        yield* harness.emit(opened.threadId, {
          type: "thread.token-usage.updated",
          payload: {
            usage: { usedTokens: 800, maxTokens: 1000, inputTokens: 600, outputTokens: 200 },
          },
        });
        yield* harness.emit(opened.threadId, {
          type: "turn.completed",
          payload: {
            state: "completed",
            tokenUsage: {
              usageScope: "main_agent",
              usageStatus: "complete",
              inputTokens: 600,
              outputTokens: 200,
              hasSubagents: false,
            },
          },
        });
        yield* untilTerminal(opened.output);
        const snapshot = yield* opened.runtime.readThreadSnapshot({
          providerThread: opened.providerThread,
        });
        expect(harness.limits).toEqual([{ ...limits, checkedAt: timestamp }]);
        expect(snapshot.providerThread.contextUsage?.usedTokens).toBe(800);
        expect(snapshot.providerTurns.at(-1)?.turnTokenUsage?.outputTokens).toBe(200);
      }),
    ),
  );

  it.effect("resumes native histories and uses a fresh destination for nonresumable Amp", () =>
    run(
      Effect.gen(function* () {
        const copilot = yield* makeHarness();
        const opened = yield* copilot.open("resume", "saved-native");
        expect(copilot.starts[0]?.resumeCursor).toBe("saved-native");
        expect(opened.providerThread.nativeThreadRef?.nativeId).toBe("saved-native");
        const amp = yield* makeHarness(LEGACY_ADAPTER_V2_PROFILES.amp);
        const first: OrchestrationV2ProviderThread = yield* amp.open("amp").pipe(
          Effect.map((value) => value.providerThread),
          Effect.scoped,
        );
        const second = yield* amp.open("amp", first.nativeThreadRef?.nativeId ?? undefined);
        expect(second.providerThread.nativeThreadRef?.nativeId).not.toBe(
          first.nativeThreadRef?.nativeId,
        );
        expect(amp.starts[1]?.resumeCursor).toBeUndefined();
        const resumedPreviousGeneration = yield* second.runtime
          .resumeThread({
            threadId: second.threadId,
            providerThread: first,
          })
          .pipe(Effect.result);
        expect(resumedPreviousGeneration._tag).toBe("Failure");
        const resumedCurrentGeneration = yield* second.runtime.resumeThread({
          threadId: second.threadId,
          providerThread: second.providerThread,
        });
        expect(resumedCurrentGeneration.nativeThreadRef).toEqual(
          second.providerThread.nativeThreadRef,
        );
        const capabilities = yield* amp.bridge.getCapabilities();
        expect(capabilities.threads.canForkThread).toBe(false);
        expect(capabilities.threads.canReadThreadSnapshot).toBe(false);
        expect(second.runtime.injectHistory).toBeUndefined();
        expect(capabilities.context.supportsFullThreadHandoff).toBe(true);
      }),
    ),
  );

  it.effect("converts an asynchronous send failure into a terminal event", () =>
    run(
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        const opened = yield* harness.open("failure");
        harness.failNextSend();
        yield* opened.runtime.startTurn(turnInput(opened));
        const events = yield* untilTerminal(opened.output);
        expect(events.at(-1)).toMatchObject({
          type: "turn.terminal",
          status: "failed",
          threadDisposition: "reusable",
        });
        expect(opened.runtime.providerSession.status).toBe("ready");
      }),
    ),
  );
});
