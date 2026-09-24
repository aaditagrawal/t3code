// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  type ModelSelection,
  NodeId,
  OhMyPiSettings,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RunAttemptId,
  RunId,
  ThreadId,
  type OrchestrationV2ProviderThread,
  type ProviderUsageLimitsUpdate,
} from "@t3tools/contracts";
import { resolveSelfInvocation } from "@t3tools/shared/nodeRuntime";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import { layer as idAllocatorLayer, IdAllocatorV2 } from "../IdAllocator.ts";
import { BUILT_IN_PROVIDER_ADAPTER_DRIVER_KINDS_V2 } from "../builtInProviderAdapterDrivers.ts";
import {
  ProviderAdapterV2RuntimePolicy,
  type ProviderAdapterV2Event,
  type ProviderAdapterV2SessionRuntime,
  type ProviderAdapterV2TurnInput,
} from "../ProviderAdapter.ts";
import {
  OH_MY_PI_PROVIDER,
  OhMyPiAdapterV2Driver,
  makeOhMyPiAcpAdapterFlavor,
  makeOhMyPiAdapterV2,
  type OhMyPiAdapterV2Options,
} from "./OhMyPiAdapterV2.ts";

const decodeOhMyPiSettings = Schema.decodeUnknownEffect(OhMyPiSettings);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const ohMyPiConfigAgentPath = NodePath.join(
  __dirname,
  "../../provider/acp/testFixtures/oh-my-pi-config-agent.ts",
);
const ohMyPiElicitationAgentPath = NodePath.join(
  __dirname,
  "../../provider/acp/testFixtures/oh-my-pi-elicitation-agent.ts",
);
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-oh-my-pi-adapter-v2-",
}).pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(idAllocatorLayer));

async function makeMockOhMyPiWrapper(agentPath: string, argvLogPath?: string) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "oh-my-pi-v2-"));
  const wrapperPath = NodePath.join(dir, "fake-omp.sh");
  const recordArgv =
    argvLogPath === undefined ? "" : `printf '%s\\n' "$@" > ${JSON.stringify(argvLogPath)}\n`;
  await NodeFSP.writeFile(
    wrapperPath,
    `#!/bin/sh\n${recordArgv}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(agentPath)} "$@"\n`,
    "utf8",
  );
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

function makeTurnInput(input: {
  readonly threadId: ThreadId;
  readonly providerThread: OrchestrationV2ProviderThread;
  readonly instanceId: ProviderInstanceId;
  readonly runtimePolicy: ProviderAdapterV2RuntimePolicy;
  readonly now: DateTime.Utc;
  readonly modelSelection: ModelSelection;
  readonly messageText: string;
}): ProviderAdapterV2TurnInput {
  const suffix = `${input.threadId}:1`;
  return {
    appThread: {
      createdBy: "user",
      creationSource: "web",
      id: input.threadId,
      projectId: ProjectId.make(`project:${input.threadId}`),
      title: "Oh My Pi v2",
      providerInstanceId: input.instanceId,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimePolicy.runtimeMode,
      interactionMode: input.runtimePolicy.interactionMode,
      branch: null,
      worktreePath: null,
      activeProviderThreadId: input.providerThread.id,
      lineage: {
        parentThreadId: null,
        relationshipToParent: null,
        rootThreadId: input.threadId,
      },
      forkedFrom: null,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      lastVisitedAt: null,
      deletedAt: null,
    },
    threadId: input.threadId,
    runId: RunId.make(`run:${suffix}`),
    runOrdinal: 1,
    providerTurnOrdinal: 1,
    attemptId: RunAttemptId.make(`attempt:${suffix}`),
    rootNodeId: NodeId.make(`node:${suffix}`),
    providerThread: input.providerThread,
    message: {
      createdBy: "user",
      creationSource: "web",
      messageId: MessageId.make(`message:${suffix}`),
      text: input.messageText,
      attachments: [],
    },
    modelSelection: input.modelSelection,
    runtimePolicy: input.runtimePolicy,
  };
}

const runTurn = (input: {
  readonly runtime: ProviderAdapterV2SessionRuntime;
  readonly turn: ProviderAdapterV2TurnInput;
  readonly onEvent?: (event: ProviderAdapterV2Event) => Effect.Effect<void>;
}) =>
  Effect.gen(function* () {
    const events: Array<ProviderAdapterV2Event> = [];
    const consume = yield* input.runtime.events.pipe(
      Stream.takeUntil((event) => event.type === "turn.terminal"),
      Stream.runForEach((event) =>
        Effect.sync(() => {
          events.push(event);
        }).pipe(Effect.andThen(input.onEvent?.(event) ?? Effect.void)),
      ),
      Effect.forkChild,
    );
    yield* input.runtime.startTurn(input.turn);
    yield* Fiber.join(consume);
    return events;
  }).pipe(Effect.timeout("20 seconds"));

describe("OhMyPiAdapterV2", () => {
  it("registers a native ACP flavor separate from LegacyAdapterV2", () => {
    const flavor = makeOhMyPiAcpAdapterFlavor({
      settings: { enabled: true, binaryPath: "/custom/bin/omp", customModels: [] },
      environment: {},
      makeRuntime: () => Effect.die("unused"),
    } as unknown as OhMyPiAdapterV2Options);
    assert.equal(flavor.driver, OH_MY_PI_PROVIDER);
    assert.equal(flavor.runtimeHarness, "OhMyPi");
    assert.deepEqual(flavor.ownedConfigOptionIds, ["thinking", "reasoning", "reasoningEffort"]);
    assert.isTrue(flavor.standardFormElicitation);
    assert.isTrue(flavor.rememberSessionApprovals);
    assert.isUndefined(flavor.registerExtensions);
    assert.isTrue(BUILT_IN_PROVIDER_ADAPTER_DRIVER_KINDS_V2.has(OH_MY_PI_PROVIDER));
    assert.equal(OhMyPiAdapterV2Driver.driverKind, OH_MY_PI_PROVIDER);
    assert.equal(OhMyPiAdapterV2Driver.defaultConfig().binaryPath, "omp");
  });

  it.effect("launches omp acp and maps thinking plus plan mode", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-oh-my-pi-v2-config-",
      });
      const requestLogPath = NodePath.join(tempDir, "requests.jsonl");
      const argvLogPath = NodePath.join(tempDir, "argv.txt");
      const binaryPath = yield* Effect.promise(() =>
        makeMockOhMyPiWrapper(ohMyPiConfigAgentPath, argvLogPath),
      );
      const settings = yield* decodeOhMyPiSettings({ binaryPath });
      const instanceId = ProviderInstanceId.make("ohMyPi-v2-config");
      const adapter = makeOhMyPiAdapterV2({
        instanceId,
        settings,
        environment: { ...process.env, T3_ACP_REQUEST_LOG_PATH: requestLogPath },
        childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
        crypto: yield* Crypto.Crypto,
        selfInvocation: yield* resolveSelfInvocation(),
        fileSystem,
        idAllocator: yield* IdAllocatorV2,
        serverConfig: yield* ServerConfig,
      });
      const threadId = ThreadId.make("oh-my-pi-v2-thinking-plan");
      const openSelection: ModelSelection = {
        instanceId,
        model: "anthropic/claude-sonnet-4.6",
        options: [{ id: "thinking", value: true }],
      };
      const turnSelection: ModelSelection = {
        instanceId,
        model: "anthropic/claude-sonnet-4.6",
        options: [{ id: "thinking", value: "high" }],
      };
      const openPolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const planPolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "plan",
        cwd: process.cwd(),
      });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("oh-my-pi-v2-config-session"),
        modelSelection: openSelection,
        runtimePolicy: openPolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection: openSelection,
        runtimePolicy: openPolicy,
      });
      yield* runTurn({
        runtime,
        turn: makeTurnInput({
          threadId,
          providerThread,
          instanceId,
          runtimePolicy: planPolicy,
          now: yield* DateTime.now,
          modelSelection: turnSelection,
          messageText: "plan the change",
        }),
      });
      const log = yield* fileSystem.readFileString(requestLogPath);
      const argv = yield* fileSystem.readFileString(argvLogPath);
      assert.equal(argv, "acp\n");
      assert.equal(log.includes('"methodId":"agent"'), true);
      assert.equal(log.includes('"configId":"thinking"'), true);
      assert.equal(log.includes('"value":"high"'), true);
      assert.equal(log.includes('"configId":"mode"'), true);
      assert.equal(log.includes('"value":"plan"'), true);
      assert.equal(log.includes('"value":true'), false);
      assert.equal(log.includes('"value":false'), false);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("bridges legacy form elicitation through user-input requests", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-oh-my-pi-v2-elicitation-",
      });
      const responsePath = NodePath.join(tempDir, "response.json");
      const binaryPath = yield* Effect.promise(() =>
        makeMockOhMyPiWrapper(ohMyPiElicitationAgentPath),
      );
      const settings = yield* decodeOhMyPiSettings({ binaryPath });
      const instanceId = ProviderInstanceId.make("ohMyPi-v2-elicitation");
      const adapter = makeOhMyPiAdapterV2({
        instanceId,
        settings,
        environment: {
          ...process.env,
          OMP_PROFILE: "t3-integration-test",
          T3_OH_MY_PI_ELICITATION_RESPONSE_PATH: responsePath,
        },
        childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
        crypto: yield* Crypto.Crypto,
        selfInvocation: yield* resolveSelfInvocation(),
        fileSystem,
        idAllocator: yield* IdAllocatorV2,
        serverConfig: yield* ServerConfig,
      });
      const threadId = ThreadId.make("oh-my-pi-v2-elicitation");
      const modelSelection: ModelSelection = { instanceId, model: "default" };
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("oh-my-pi-v2-elicitation-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      const events = yield* runTurn({
        runtime,
        turn: makeTurnInput({
          threadId,
          providerThread,
          instanceId,
          runtimePolicy,
          now: yield* DateTime.now,
          modelSelection,
          messageText: "ask me",
        }),
        onEvent: (event) => {
          if (
            event.type !== "turn_item.updated" ||
            event.turnItem.type !== "user_input_request" ||
            event.turnItem.status !== "waiting"
          ) {
            return Effect.void;
          }
          return runtime
            .respondToRuntimeRequest({
              requestId: event.turnItem.requestId,
              answers: { approach: "Safe" },
            })
            .pipe(Effect.forkChild, Effect.asVoid);
        },
      });
      const requested = events.find(
        (event) =>
          event.type === "turn_item.updated" && event.turnItem.type === "user_input_request",
      );
      if (
        requested?.type !== "turn_item.updated" ||
        requested.turnItem.type !== "user_input_request"
      ) {
        return yield* Effect.die("Expected an Oh My Pi form elicitation");
      }
      assert.deepEqual(
        requested.turnItem.questions[0]?.options.map((option) => ({
          label: option.label,
          description: option.description,
        })),
        [
          { label: "Fast", description: "Skip optional checks" },
          { label: "Safe", description: "Run the extra checks" },
        ],
      );
      assert.deepEqual(decodeUnknownJson(yield* fileSystem.readFileString(responsePath)), {
        action: "accept",
        content: { approach: "safe" },
      });
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("projects usage updates and thought chunks and keeps child sessions isolated", () =>
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const crypto = yield* Crypto.Crypto;
      const selfInvocation = yield* resolveSelfInvocation();
      const fileSystem = yield* FileSystem.FileSystem;
      const idAllocator = yield* IdAllocatorV2;
      const serverConfig = yield* ServerConfig;
      const usageLimits: Array<ProviderUsageLimitsUpdate & { readonly checkedAt: string }> = [];
      const binaryPath = yield* Effect.promise(() => makeMockOhMyPiWrapper(mockAgentPath));
      const settings = yield* decodeOhMyPiSettings({ binaryPath });
      const instanceId = ProviderInstanceId.make("ohMyPi-v2-usage");
      const modelSelection: ModelSelection = { instanceId, model: "default" };
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const open = (threadId: ThreadId, environment: NodeJS.ProcessEnv) =>
        makeOhMyPiAdapterV2({
          instanceId,
          settings,
          environment,
          childProcessSpawner,
          crypto,
          selfInvocation,
          fileSystem,
          idAllocator,
          serverConfig,
          onUsageLimits: (update) =>
            Effect.sync(() => {
              usageLimits.push(update);
            }),
        }).openSession({
          threadId,
          providerSessionId: ProviderSessionId.make(`${threadId}-session`),
          modelSelection,
          runtimePolicy,
        });

      const usageThreadId = ThreadId.make("oh-my-pi-v2-usage");
      const usageRuntime = yield* open(usageThreadId, {
        ...process.env,
        T3_ACP_EMIT_USAGE_AND_THOUGHTS: "1",
      });
      const usageThread = yield* usageRuntime.ensureThread({
        threadId: usageThreadId,
        modelSelection,
        runtimePolicy,
      });
      const usageEvents = yield* runTurn({
        runtime: usageRuntime,
        turn: makeTurnInput({
          threadId: usageThreadId,
          providerThread: usageThread,
          instanceId,
          runtimePolicy,
          now: yield* DateTime.now,
          modelSelection,
          messageText: "hello usage",
        }),
      });
      const reasoning = usageEvents.find(
        (event) => event.type === "turn_item.updated" && event.turnItem.type === "reasoning",
      );
      const assistant = usageEvents.findLast(
        (event) =>
          event.type === "turn_item.updated" && event.turnItem.type === "assistant_message",
      );
      const threadUpdate = usageEvents.findLast(
        (event) => event.type === "provider_thread.updated",
      );
      assert.equal(
        reasoning?.type === "turn_item.updated" && reasoning.turnItem.type === "reasoning"
          ? reasoning.turnItem.text
          : undefined,
        "Inspect the current implementation first.",
      );
      assert.equal(
        assistant?.type === "turn_item.updated" && assistant.turnItem.type === "assistant_message"
          ? assistant.turnItem.text
          : undefined,
        "hello from mock",
      );
      assert.deepEqual(
        threadUpdate?.type === "provider_thread.updated"
          ? threadUpdate.providerThread.contextUsage
          : undefined,
        {
          usedTokens: 1_200,
          maxTokens: 128_000,
          cost: { amount: 0.42, currency: "USD" },
        },
      );
      assert.deepEqual(
        usageLimits.map((update) => update.windows),
        [
          [
            {
              id: "five_hour",
              kind: "session",
              label: "Session",
              usedPercent: 37,
              windowDurationMins: 300,
              resetsAt: "2026-09-05T12:00:00.000Z",
            },
          ],
        ],
      );

      usageLimits.length = 0;
      const childThreadId = ThreadId.make("oh-my-pi-v2-child");
      const childRuntime = yield* open(childThreadId, {
        ...process.env,
        T3_ACP_EMIT_FOREIGN_SESSION_UPDATES: "1",
      });
      const childThread = yield* childRuntime.ensureThread({
        threadId: childThreadId,
        modelSelection,
        runtimePolicy,
      });
      const childEvents = yield* runTurn({
        runtime: childRuntime,
        turn: makeTurnInput({
          threadId: childThreadId,
          providerThread: childThread,
          instanceId,
          runtimePolicy,
          now: yield* DateTime.now,
          modelSelection,
          messageText: "parent only",
        }),
      });
      const assistantText = childEvents.findLast(
        (event) =>
          event.type === "turn_item.updated" && event.turnItem.type === "assistant_message",
      );
      assert.equal(
        assistantText?.type === "turn_item.updated" &&
          assistantText.turnItem.type === "assistant_message"
          ? assistantText.turnItem.text
          : undefined,
        "root before child root after child",
      );
      const rendered = childEvents
        .flatMap((event) => {
          if (event.type !== "turn_item.updated") return [];
          const item = event.turnItem;
          if (
            item.type === "assistant_message" ||
            item.type === "reasoning" ||
            item.type === "user_message"
          ) {
            return [item.text];
          }
          if (item.type === "dynamic_tool") return [item.title ?? "", item.toolName];
          return [];
        })
        .filter((text): text is string => text !== null);
      assert.equal(
        rendered.some((text) => text.includes("child thought")),
        false,
      );
      assert.equal(
        rendered.some((text) => text.includes("child content")),
        false,
      );
      assert.equal(
        rendered.some((text) => text.includes("Child-only tool")),
        false,
      );
      assert.equal(usageLimits.length, 0);
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );

  it.effect("remembers an accepted-for-session command for the rest of the thread", () =>
    Effect.gen(function* () {
      const binaryPath = yield* Effect.promise(() => makeMockOhMyPiWrapper(mockAgentPath));
      const settings = yield* decodeOhMyPiSettings({ binaryPath });
      const instanceId = ProviderInstanceId.make("ohMyPi-v2-approvals");
      const adapter = makeOhMyPiAdapterV2({
        instanceId,
        settings,
        environment: {
          ...process.env,
          T3_ACP_EMIT_TOOL_CALLS: "1",
          T3_ACP_PERMISSION_REQUEST_COUNT: "2",
        },
        childProcessSpawner: yield* ChildProcessSpawner.ChildProcessSpawner,
        crypto: yield* Crypto.Crypto,
        selfInvocation: yield* resolveSelfInvocation(),
        fileSystem: yield* FileSystem.FileSystem,
        idAllocator: yield* IdAllocatorV2,
        serverConfig: yield* ServerConfig,
      });
      const threadId = ThreadId.make("oh-my-pi-v2-approvals");
      const modelSelection: ModelSelection = { instanceId, model: "default" };
      const runtimePolicy = ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "approval-required",
        interactionMode: "default",
        cwd: process.cwd(),
      });
      const runtime = yield* adapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("oh-my-pi-v2-approvals-session"),
        modelSelection,
        runtimePolicy,
      });
      const providerThread = yield* runtime.ensureThread({
        threadId,
        modelSelection,
        runtimePolicy,
      });
      let pendingApprovals = 0;
      const events = yield* runTurn({
        runtime,
        turn: makeTurnInput({
          threadId,
          providerThread,
          instanceId,
          runtimePolicy,
          now: yield* DateTime.now,
          modelSelection,
          messageText: "run the command",
        }),
        onEvent: (event) => {
          if (
            event.type !== "runtime_request.updated" ||
            event.runtimeRequest.kind !== "command" ||
            event.runtimeRequest.status !== "pending"
          ) {
            return Effect.void;
          }
          pendingApprovals += 1;
          if (pendingApprovals !== 1) return Effect.void;
          return runtime
            .respondToRuntimeRequest({
              requestId: event.runtimeRequest.id,
              decision: "acceptForSession",
            })
            .pipe(Effect.forkChild, Effect.asVoid);
        },
      });
      assert.equal(pendingApprovals, 1);
      assert.equal(
        events.some((event) => event.type === "turn.terminal" && event.status === "completed"),
        true,
      );
    }).pipe(Effect.scoped, Effect.provide(testLayer)),
  );
});
