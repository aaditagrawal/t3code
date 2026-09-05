// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AcpSettings,
  HermesSettings,
  PiSettings,
  ProviderDriverKind,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { makeAcpAdapter } from "./AcpAdapter.ts";
import { makeHermesAdapter } from "./HermesAdapter.ts";
import { makePiAdapter } from "./PiAdapter.ts";

const decodeUnknownEffectHermesSettings = Schema.decodeUnknownEffect(HermesSettings);
const decodeUnknownEffectPiSettings = Schema.decodeUnknownEffect(PiSettings);
const decodeUnknownEffectAcpSettings = Schema.decodeUnknownEffect(AcpSettings);

interface LiveAcpCase {
  readonly name: string;
  readonly kind: "acp" | "hermes" | "pi";
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly environment?: Readonly<Record<string, string>>;
  readonly expectedModel?: string;
}

function makeLiveAdapter(testCase: LiveAcpCase, environment: NodeJS.ProcessEnv) {
  if (testCase.kind === "hermes") {
    return decodeUnknownEffectHermesSettings({ binaryPath: testCase.command }).pipe(
      Effect.flatMap((settings) => makeHermesAdapter(settings, { environment })),
    );
  }
  if (testCase.kind === "pi") {
    return decodeUnknownEffectPiSettings({ binaryPath: testCase.command }).pipe(
      Effect.flatMap((settings) => makePiAdapter(settings, { environment })),
    );
  }
  return decodeUnknownEffectAcpSettings({
    binaryPath: testCase.command,
    arguments: testCase.args?.join("\n") ?? "",
  }).pipe(Effect.flatMap((settings) => makeAcpAdapter(settings, { environment })));
}

function readLiveCases(): ReadonlyArray<LiveAcpCase> {
  const encoded = process.env.T3_LIVE_ACP_CASES;
  if (!encoded) return [];
  const parsed: unknown = JSON.parse(encoded);
  if (!Array.isArray(parsed)) throw new Error("T3_LIVE_ACP_CASES must be a JSON array");
  return parsed as ReadonlyArray<LiveAcpCase>;
}

const expectedText = process.env.T3_LIVE_ACP_EXPECTED_TEXT ?? "T3_ACP_OK";
const liveCases = readLiveCases();
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-standard-acp-live-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.layer(testLayer)("live standard ACP providers", (it) => {
  if (liveCases.length === 0) {
    it.skip("requires T3_LIVE_ACP_CASES", () => Effect.void);
  }
  for (const testCase of liveCases) {
    it.effect(`${testCase.name} completes a real turn`, () =>
      Effect.gen(function* () {
        const environment = { ...process.env, ...testCase.environment };
        const adapter = yield* makeLiveAdapter(testCase, environment);
        const threadId = ThreadId.make(`live-${testCase.name}`);
        const completed = yield* Deferred.make<void>();
        const events: ProviderRuntimeEvent[] = [];
        const eventFiber = yield* adapter.streamEvents.pipe(
          Stream.runForEach((event) =>
            Effect.sync(() => events.push(event)).pipe(
              Effect.andThen(
                event.type === "turn.completed"
                  ? Deferred.succeed(completed, undefined).pipe(Effect.asVoid)
                  : Effect.void,
              ),
            ),
          ),
          Effect.forkChild,
        );

        yield* Effect.gen(function* () {
          const session = yield* adapter.startSession({
            threadId,
            provider: ProviderDriverKind.make(testCase.kind),
            cwd: process.cwd(),
            runtimeMode: "full-access",
          });
          if (testCase.expectedModel) {
            assert.isTrue(session.model?.endsWith(testCase.expectedModel));
          }
          yield* adapter.sendTurn({
            threadId,
            input: `Reply with exactly ${expectedText} and no other text.`,
            attachments: [],
          });
          yield* Deferred.await(completed).pipe(Effect.timeout(Duration.minutes(3)));
          const assistantText = events
            .filter((event) => event.type === "content.delta")
            .map((event) => event.payload.delta)
            .join("");
          assert.include(assistantText, expectedText);
        }).pipe(
          Effect.ensuring(Fiber.interrupt(eventFiber)),
          Effect.ensuring(adapter.stopAll().pipe(Effect.orDie)),
        );
      }),
    );
  }
});
