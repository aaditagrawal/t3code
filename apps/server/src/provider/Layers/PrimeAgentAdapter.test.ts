// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  ApprovalRequestId,
  PrimeAgentSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { buildPrimeAgentAcpSpawnInput } from "../acp/PrimeAgentAcpSupport.ts";
import {
  makePrimeAgentAdapter,
  primeAgentPromptSettlementBelongsToContext,
} from "./PrimeAgentAdapter.ts";

const decodePrimeAgentSettings = Schema.decodeSync(PrimeAgentSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const mockAgentCommand = process.execPath;

const PRIME_AGENT = ProviderDriverKind.make("primeAgent");
const PRIME_AGENT_INSTANCE = ProviderInstanceId.make("primeAgent");

async function makeMockPrimeAgentWrapper(extraEnv?: Record<string, string>) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-agent-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-prime-agent.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
exec ${JSON.stringify(mockAgentCommand)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

/**
 * Reads the mock agent's raw incoming JSON-RPC log. The mock only flushes a
 * line once the client actually sends the request, so callers must sequence
 * reads after the traffic they assert on.
 */
async function readRequestLogMethods(filePath: string): Promise<Array<string>> {
  const raw = await NodeFSP.readFile(filePath, "utf8").catch(() => "");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const parsed: unknown = JSON.parse(line);
      const method =
        typeof parsed === "object" && parsed !== null && "method" in parsed
          ? (parsed as { readonly method?: unknown }).method
          : undefined;
      return typeof method === "string" ? [method] : [];
    });
}

const primeAgentAdapterTestLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-prime-agent-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

const makeTestAdapter = (
  binaryPath: string,
  options?: Parameters<typeof makePrimeAgentAdapter>[1],
) => makePrimeAgentAdapter(decodePrimeAgentSettings({ binaryPath }), options).pipe(Effect.orDie);

it("pins the model and working directory on the spawn command line", () => {
  const spawn = buildPrimeAgentAcpSpawnInput(
    { binaryPath: "  " },
    "/tmp/project",
    undefined,
    "  claude-sonnet-4-20250514  ",
  );

  assert.equal(spawn.command, "prime-agent");
  assert.equal(spawn.cwd, "/tmp/project");
  assert.deepStrictEqual(spawn.args, [
    "--mode",
    "acp",
    "--cwd",
    "/tmp/project",
    "--model",
    "claude-sonnet-4-20250514",
  ]);
});

it("passes custom configuration through the Prime Agent environment", () => {
  const spawn = buildPrimeAgentAcpSpawnInput(
    { binaryPath: "prime-agent", configDir: "  ~/prime-work  " },
    "/tmp/project",
    { PATH: "/bin" },
  );
  assert.deepStrictEqual(spawn.env, { PATH: "/bin", PRIME_AGENT_CODING_AGENT_DIR: "~/prime-work" });
});

it("omits --model when no model is selected", () => {
  const spawn = buildPrimeAgentAcpSpawnInput(undefined, "/tmp/project");
  assert.deepStrictEqual(spawn.args, ["--mode", "acp", "--cwd", "/tmp/project"]);
});

it("requires a settlement to match the live Prime Agent turn", () => {
  const staleTurnId = TurnId.make("stale-turn");
  const replacementTurnId = TurnId.make("replacement-turn");

  assert.isFalse(
    primeAgentPromptSettlementBelongsToContext({
      liveAcpSessionId: "session-1",
      expectedAcpSessionId: "session-1",
      liveActiveTurnId: replacementTurnId,
      liveSessionActiveTurnId: replacementTurnId,
      turnId: staleTurnId,
    }),
  );
  assert.isFalse(
    primeAgentPromptSettlementBelongsToContext({
      liveAcpSessionId: "replacement-session",
      expectedAcpSessionId: "stale-session",
      liveActiveTurnId: staleTurnId,
      liveSessionActiveTurnId: staleTurnId,
      turnId: staleTurnId,
    }),
  );
  assert.isTrue(
    primeAgentPromptSettlementBelongsToContext({
      liveAcpSessionId: "session-1",
      expectedAcpSessionId: "session-1",
      liveActiveTurnId: staleTurnId,
      liveSessionActiveTurnId: staleTurnId,
      turnId: staleTurnId,
    }),
  );
});

it.layer(primeAgentAdapterTestLayer)("PrimeAgentAdapterLive", (it) => {
  it.effect("declares model switching as unsupported", () =>
    Effect.gen(function* () {
      const wrapperPath = yield* Effect.promise(() => makeMockPrimeAgentWrapper());
      const adapter = yield* makeTestAdapter(wrapperPath);
      assert.equal(adapter.provider, "primeAgent");
      assert.equal(adapter.capabilities.sessionModelSwitch, "unsupported");
      assert.equal(adapter.capabilities.supportsConversationRollback, false);
    }),
  );

  it.effect("starts a session and maps the mock ACP prompt flow to runtime events", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-agent-mock-thread");
      const wrapperPath = yield* Effect.promise(() => makeMockPrimeAgentWrapper());
      const adapter = yield* makeTestAdapter(wrapperPath);

      const runtimeEvents: ProviderRuntimeEvent[] = [];
      const turnCompleted = yield* Deferred.make<void>();
      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }).pipe(
          Effect.andThen(
            event.type === "turn.completed"
              ? Deferred.succeed(turnCompleted, undefined)
              : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      const session = yield* adapter.startSession({
        threadId,
        provider: PRIME_AGENT,
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: PRIME_AGENT_INSTANCE,
          model: "claude-sonnet-4-20250514",
        },
      });

      assert.equal(session.provider, "primeAgent");
      assert.equal(session.model, "claude-sonnet-4-20250514");
      // `loadSession: false` — nothing to resume from.
      assert.isUndefined(session.resumeCursor);

      yield* adapter.sendTurn({
        threadId,
        input: "hello prime agent",
        attachments: [],
      });

      yield* Deferred.await(turnCompleted);
      yield* Fiber.interrupt(runtimeEventsFiber);
      const types = runtimeEvents.map((event) => event.type);

      assert.includeMembers(types, [
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "item.started",
        "content.delta",
        "turn.completed",
      ] as const);

      const delta = runtimeEvents.find((event) => event.type === "content.delta");
      assert.isDefined(delta);
      if (delta?.type === "content.delta") {
        assert.equal(delta.payload.delta, "hello from mock");
      }

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("never sends `authenticate` because Prime Agent does not implement it", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-agent-no-authenticate");
      const tempDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-agent-request-log-")),
      );
      const requestLogPath = NodePath.join(tempDir, "requests.log");
      const wrapperPath = yield* Effect.promise(() =>
        makeMockPrimeAgentWrapper({ T3_ACP_REQUEST_LOG_PATH: requestLogPath }),
      );
      const adapter = yield* makeTestAdapter(wrapperPath);

      // The mock agent answers `authenticate` happily; a null authMethodId is
      // the only reason the round-trip is absent from its request log.
      yield* adapter.startSession({
        threadId,
        provider: PRIME_AGENT,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      yield* adapter.sendTurn({ threadId, input: "ping", attachments: [] });

      const methods = yield* Effect.promise(() => readRequestLogMethods(requestLogPath));
      assert.includeMembers(methods, ["initialize", "session/new", "session/prompt"]);
      assert.notInclude(methods, "authenticate");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("ignores a resume cursor and starts a fresh session", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-agent-no-resume");
      const tempDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-agent-resume-log-")),
      );
      const requestLogPath = NodePath.join(tempDir, "requests.log");
      const wrapperPath = yield* Effect.promise(() =>
        makeMockPrimeAgentWrapper({ T3_ACP_REQUEST_LOG_PATH: requestLogPath }),
      );
      const adapter = yield* makeTestAdapter(wrapperPath);

      const session = yield* adapter.startSession({
        threadId,
        provider: PRIME_AGENT,
        cwd: process.cwd(),
        runtimeMode: "full-access",
        resumeCursor: { schemaVersion: 1, sessionId: "mock-session-1" },
      });

      assert.isUndefined(session.resumeCursor);

      const methods = yield* Effect.promise(() => readRequestLogMethods(requestLogPath));
      assert.include(methods, "session/new");
      assert.notInclude(methods, "session/load");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("rejects a start request addressed to another provider", () =>
    Effect.gen(function* () {
      const wrapperPath = yield* Effect.promise(() => makeMockPrimeAgentWrapper());
      const adapter = yield* makeTestAdapter(wrapperPath);

      const error = yield* Effect.flip(
        adapter.startSession({
          threadId: ThreadId.make("prime-agent-wrong-provider"),
          provider: ProviderDriverKind.make("grok"),
          cwd: process.cwd(),
          runtimeMode: "full-access",
        }),
      );

      assert.equal(error._tag, "ProviderAdapterValidationError");
    }),
  );

  it.effect("reports the session running only while the prompt is in flight", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-agent-session-ready-after-prompt");
      const wrapperPath = yield* Effect.promise(() =>
        makeMockPrimeAgentWrapper({ T3_ACP_EMIT_TOOL_CALLS: "1" }),
      );
      const adapter = yield* makeTestAdapter(wrapperPath);
      const requestOpened =
        yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "request.opened" }>>();
      const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        event.type === "request.opened"
          ? Deferred.succeed(requestOpened, event).pipe(Effect.ignore)
          : Effect.void,
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId,
        provider: PRIME_AGENT,
        cwd: process.cwd(),
        runtimeMode: "approval-required",
      });

      const sendTurnFiber = yield* adapter
        .sendTurn({ threadId, input: "check lifecycle", attachments: [] })
        .pipe(Effect.forkChild);
      const requestOpenedEvent = yield* Deferred.await(requestOpened);

      const runningSessions = yield* adapter.listSessions();
      const runningSession = runningSessions.find((session) => session.threadId === threadId);
      assert.equal(runningSession?.status, "running");
      assert.isDefined(runningSession?.activeTurnId);

      yield* adapter.respondToRequest(
        threadId,
        ApprovalRequestId.make(String(requestOpenedEvent.requestId)),
        "accept",
      );
      yield* Fiber.join(sendTurnFiber);

      const readySessions = yield* adapter.listSessions();
      const readySession = readySessions.find((session) => session.threadId === threadId);
      assert.equal(readySession?.status, "ready");
      assert.isUndefined(readySession?.activeTurnId);

      yield* Fiber.interrupt(eventsFiber);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("cancels an in-flight turn on interrupt", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-agent-interrupt");
      const wrapperPath = yield* Effect.promise(() =>
        makeMockPrimeAgentWrapper({ T3_ACP_HANG_PROMPT_FOREVER: "1" }),
      );
      const adapter = yield* makeTestAdapter(wrapperPath);

      const turnStarted = yield* Deferred.make<void>();
      const turnCompleted =
        yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "turn.completed" }>>();
      const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        event.type === "turn.started"
          ? Deferred.succeed(turnStarted, undefined).pipe(Effect.asVoid)
          : event.type === "turn.completed"
            ? Deferred.succeed(turnCompleted, event).pipe(Effect.asVoid)
            : Effect.void,
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId,
        provider: PRIME_AGENT,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      const sendTurnFiber = yield* adapter
        .sendTurn({ threadId, input: "hang forever", attachments: [] })
        .pipe(Effect.forkChild);
      yield* Deferred.await(turnStarted);

      yield* adapter.interruptTurn(threadId);

      const completed = yield* Deferred.await(turnCompleted);
      assert.equal(completed.payload.state, "cancelled");

      const readySessions = yield* adapter.listSessions();
      assert.equal(readySessions.find((session) => session.threadId === threadId)?.status, "ready");

      yield* Fiber.interrupt(sendTurnFiber);
      yield* Fiber.interrupt(eventsFiber);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("fails structured user input because Prime Agent never asks for it", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-agent-no-user-input");
      const wrapperPath = yield* Effect.promise(() => makeMockPrimeAgentWrapper());
      const adapter = yield* makeTestAdapter(wrapperPath);

      yield* adapter.startSession({
        threadId,
        provider: PRIME_AGENT,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });

      const error = yield* Effect.flip(
        adapter.respondToUserInput(threadId, ApprovalRequestId.make("missing-request"), {}),
      );
      assert.equal(error._tag, "ProviderAdapterRequestError");

      const rollbackError = yield* Effect.flip(adapter.rollbackThread(threadId, 1));
      assert.equal(rollbackError._tag, "ProviderAdapterRequestError");

      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("closes the ACP child process when a session stops", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("prime-agent-stop-session-close");
      const tempDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prime-agent-exit-log-")),
      );
      const exitLogPath = NodePath.join(tempDir, "exit.log");
      const wrapperPath = yield* Effect.promise(() =>
        makeMockPrimeAgentWrapper({ T3_ACP_EXIT_LOG_PATH: exitLogPath }),
      );
      const adapter = yield* makeTestAdapter(wrapperPath);

      yield* adapter.startSession({
        threadId,
        provider: PRIME_AGENT,
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      yield* adapter.stopSession(threadId);

      const exitLog = yield* waitForFileContent(exitLogPath);
      assert.include(exitLog, "SIGTERM");
      assert.isFalse(yield* adapter.hasSession(threadId));
    }),
  );
});

function waitForFileContent(filePath: string, attempts = 40): Effect.Effect<string> {
  const readAttempt = (remainingAttempts: number): Effect.Effect<string> =>
    Effect.gen(function* () {
      if (remainingAttempts <= 0) {
        return yield* Effect.die(new Error(`Timed out waiting for file content at ${filePath}`));
      }
      const raw = yield* Effect.tryPromise(() => NodeFSP.readFile(filePath, "utf8")).pipe(
        Effect.orElseSucceed(() => ""),
      );
      if (raw.trim().length > 0) {
        return raw;
      }
      yield* Effect.sleep("25 millis");
      return yield* readAttempt(remainingAttempts - 1);
    });
  return readAttempt(attempts);
}
