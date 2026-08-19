// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
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
  AcpSettings,
  FxSettings,
  HermesSettings,
  PiSettings,
  ProviderDriverKind,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { makeAcpAdapter } from "./AcpAdapter.ts";
import { makeFxAdapter } from "./FxAdapter.ts";
import { makeHermesAdapter } from "./HermesAdapter.ts";
import { makePiAdapter } from "./PiAdapter.ts";

const decodeHermesSettings = Schema.decodeUnknownEffect(HermesSettings);
const decodePiSettings = Schema.decodeUnknownEffect(PiSettings);
const decodeFxSettings = Schema.decodeUnknownEffect(FxSettings);
const decodeAcpSettings = Schema.decodeUnknownEffect(AcpSettings);

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");

async function makeMockAcpWrapper() {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "standard-acp-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-acp.sh");
  await NodeFSP.writeFile(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(mockAgentPath)} "$@"\n`,
    "utf8",
  );
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-standard-acp-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("standard ACP provider adapters", (it) => {
  for (const provider of ["acp", "fx", "hermes", "pi"] as const) {
    it.effect(`${provider} starts, streams a prompt, and stops`, () =>
      Effect.gen(function* () {
        const binaryPath = yield* Effect.promise(makeMockAcpWrapper);
        const adapter = yield* provider === "acp"
          ? decodeAcpSettings({
              binaryPath: process.execPath,
              arguments: `${mockAgentPath}\n--generic-acp-test`,
            }).pipe(Effect.flatMap(makeAcpAdapter))
          : provider === "fx"
            ? decodeFxSettings({ binaryPath }).pipe(Effect.flatMap(makeFxAdapter))
            : provider === "hermes"
              ? decodeHermesSettings({ binaryPath }).pipe(Effect.flatMap(makeHermesAdapter))
              : decodePiSettings({ binaryPath }).pipe(Effect.flatMap(makePiAdapter));
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
});
