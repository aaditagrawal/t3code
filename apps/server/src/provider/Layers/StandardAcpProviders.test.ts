// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  AcpSettings,
  ApprovalRequestId,
  FxSettings,
  HermesSettings,
  OhMyPiSettings,
  PiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeAcpAdapter } from "./AcpAdapter.ts";
import { makeFxAdapter } from "./FxAdapter.ts";
import { makeHermesAdapter } from "./HermesAdapter.ts";
import { makeOhMyPiAdapter, ohMyPiLaunchCommand } from "./OhMyPiAdapter.ts";
import { makePiAdapter } from "./PiAdapter.ts";

const decodeHermesSettings = Schema.decodeUnknownEffect(HermesSettings);
const decodePiSettings = Schema.decodeUnknownEffect(PiSettings);
const decodeFxSettings = Schema.decodeUnknownEffect(FxSettings);
const decodeOhMyPiSettings = Schema.decodeUnknownEffect(OhMyPiSettings);
const decodeAcpSettings = Schema.decodeUnknownEffect(AcpSettings);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const ohMyPiElicitationAgentPath = NodePath.join(
  __dirname,
  "../acp/testFixtures/oh-my-pi-elicitation-agent.ts",
);

async function makeMockAcpWrapper(agentPath = mockAgentPath) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "standard-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-acp.sh");
  await NodeFSP.writeFile(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(agentPath)} "$@"\n`,
    "utf8",
  );
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-standard-acp-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.effect("keeps the OhMyPi executable separate from its ACP argv", () =>
  Effect.gen(function* () {
    const settings = yield* decodeOhMyPiSettings({ binaryPath: "/custom/bin/omp" });
    assert.deepStrictEqual(ohMyPiLaunchCommand(settings), {
      command: "/custom/bin/omp",
      args: ["acp"],
    });
    assert.notInclude(ohMyPiLaunchCommand(settings).args, "--yolo");
  }),
);

it.layer(testLayer)("standard ACP provider adapters", (it) => {
  for (const provider of ["acp", "fx", "hermes", "ohMyPi", "pi"] as const) {
    it.effect(`${provider} starts, streams a prompt, and stops`, () =>
      Effect.gen(function* () {
        const binaryPath = yield* Effect.promise(() => makeMockAcpWrapper());
        const adapter = yield* provider === "acp"
          ? decodeAcpSettings({
              binaryPath: process.execPath,
              arguments: `${mockAgentPath}\n--generic-acp-test`,
            }).pipe(Effect.flatMap(makeAcpAdapter))
          : provider === "fx"
            ? decodeFxSettings({ binaryPath }).pipe(Effect.flatMap(makeFxAdapter))
            : provider === "hermes"
              ? decodeHermesSettings({ binaryPath }).pipe(Effect.flatMap(makeHermesAdapter))
              : provider === "ohMyPi"
                ? decodeOhMyPiSettings({ binaryPath }).pipe(Effect.flatMap(makeOhMyPiAdapter))
                : decodePiSettings({ binaryPath }).pipe(Effect.flatMap(makePiAdapter));
        assert.strictEqual(adapter.capabilities.supportsConversationRollback, false);
        const threadId = ThreadId.make(`${provider}-mock-thread`);
        const providerKind = ProviderDriverKind.make(provider);
        const events: ProviderRuntimeEvent[] = [];
        const turnCompleted = yield* Deferred.make<void>();
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => events.push(event)).pipe(
              Effect.andThen(
                event.type === "turn.completed"
                  ? Deferred.succeed(turnCompleted, undefined).pipe(Effect.asVoid)
                  : Effect.void,
              ),
            ),
          ),
          Effect.forkChild,
        );

        yield* Effect.gen(function* () {
          const session = yield* adapter.startSession({
            threadId,
            provider: providerKind,
            cwd: process.cwd(),
            runtimeMode: "full-access",
          });
          assert.equal(String(session.provider), provider);
          assert.deepStrictEqual(session.resumeCursor, {
            schemaVersion: 1,
            sessionId: "mock-session-1",
          });

          yield* adapter.sendTurn({ threadId, input: `hello ${provider}`, attachments: [] });
          yield* Deferred.await(turnCompleted);

          assert.includeMembers(
            events.map((event) => event.type),
            [
              "session.started",
              "thread.started",
              "turn.started",
              "content.delta",
              "turn.completed",
            ],
          );
          yield* adapter.stopSession(threadId);
        }).pipe(Effect.ensuring(Fiber.interrupt(eventFiber)));
      }),
    );
  }

  it.effect("ohMyPi switches config-option models and resumes its ACP session", () =>
    Effect.gen(function* () {
      const binaryPath = yield* Effect.promise(() => makeMockAcpWrapper());
      const adapter = yield* decodeOhMyPiSettings({ binaryPath }).pipe(
        Effect.flatMap(makeOhMyPiAdapter),
      );
      const threadId = ThreadId.make("oh-my-pi-model-resume");
      const session = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("ohMyPi"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: {
          instanceId: ProviderInstanceId.make("ohMyPi"),
          model: "composer-2",
        },
      });
      assert.equal(session.model, "composer-2");
      const resumed = yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("ohMyPi"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        resumeCursor: session.resumeCursor,
      });
      assert.deepStrictEqual(resumed.resumeCursor, session.resumeCursor);
      yield* adapter.stopSession(threadId);
    }),
  );

  it.effect("bridges OhMyPi legacy form elicitation through user-input events", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const tempDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-oh-my-pi-elicitation-",
      });
      const responsePath = NodePath.join(tempDir, "response.json");
      const binaryPath = yield* Effect.promise(() =>
        makeMockAcpWrapper(ohMyPiElicitationAgentPath),
      );
      const settings = yield* decodeOhMyPiSettings({ binaryPath });
      const adapter = yield* makeOhMyPiAdapter(settings, {
        environment: {
          ...process.env,
          OMP_PROFILE: "t3-integration-test",
          T3_OH_MY_PI_ELICITATION_RESPONSE_PATH: responsePath,
        },
      });
      const events: ProviderRuntimeEvent[] = [];
      const requested = yield* Deferred.make<ApprovalRequestId>();
      const eventFiber = yield* adapter.streamEvents.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => events.push(event)).pipe(
            Effect.andThen(
              event.type === "user-input.requested" && event.requestId !== undefined
                ? Deferred.succeed(requested, ApprovalRequestId.make(event.requestId)).pipe(
                    Effect.asVoid,
                  )
                : Effect.void,
            ),
          ),
        ),
        Effect.forkChild,
      );
      const threadId = ThreadId.make("oh-my-pi-elicitation-thread");
      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("ohMyPi"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
      });
      const turnFiber = yield* adapter
        .sendTurn({ threadId, input: "ask me", attachments: [] })
        .pipe(Effect.forkChild);
      const requestId = yield* Deferred.await(requested).pipe(Effect.timeout("10 seconds"));
      yield* adapter.respondToUserInput(threadId, requestId, { approach: "Safe" });
      yield* Fiber.join(turnFiber).pipe(Effect.timeout("10 seconds"));
      assert.deepStrictEqual(decodeUnknownJson(yield* fileSystem.readFileString(responsePath)), {
        action: "accept",
        content: { approach: "safe" },
      });
      assert.includeMembers(
        events.map((event) => event.type),
        ["user-input.requested", "user-input.resolved"],
      );
      const requestedEvent = events.find((event) => event.type === "user-input.requested");
      assert.deepStrictEqual(requestedEvent?.payload.questions[0]?.options, [
        { label: "Fast", description: "Skip optional checks" },
        { label: "Safe", description: "Run the extra checks" },
      ]);
      yield* adapter.stopSession(threadId);
      yield* Fiber.interrupt(eventFiber);
    }).pipe(Effect.scoped),
  );
});
