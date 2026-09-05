// @effect-diagnostics nodeBuiltinImport:off - Native fixtures verify the read-only import boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationCommand,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { expect, it } from "@effect/vitest";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBindingWithMetadata,
} from "../provider/Services/ProviderSessionDirectory.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { decideOrchestrationCommand } from "../orchestration/decider.ts";
import { createEmptyReadModel, projectEvent } from "../orchestration/projector.ts";
import { discoverThreads } from "./sources.ts";
import { makeExistingThreads } from "./service.ts";

const stamp = "2026-09-05T12:00:00.000Z";
const sessionId = "01900000-0000-7000-8000-000000000999";

for (const provider of ["codex", "claudeAgent"] as const) {
  it.effect(
    `imports ${provider} once across retries and retains its original resume cursor without starting a turn`,
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-import-service-")),
          ),
          (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
        );
        const home = NodePath.join(root, provider === "codex" ? "provider" : ".claude");
        const sessions = NodePath.join(home, provider === "codex" ? "sessions" : "projects");
        yield* Effect.promise(() => NodeFSP.mkdir(sessions, { recursive: true }));
        const file = NodePath.join(sessions, "rollout-test.jsonl");
        const text =
          [
            ...(provider === "codex"
              ? [{ type: "session_meta", payload: { id: sessionId, cwd: root } }]
              : []),
            ...["user", "assistant"].map((role, index) =>
              provider === "codex"
                ? {
                    type: "response_item",
                    timestamp: stamp,
                    payload: { type: "message", role, content: [{ type: "text", text: role }] },
                  }
                : {
                    type: role,
                    uuid: String(index),
                    parentUuid: index === 0 ? null : "0",
                    sessionId,
                    cwd: root,
                    timestamp: stamp,
                    message: { content: role },
                  },
            ),
          ]
            .map((entry) => JSON.stringify(entry))
            .join("\n") + "\n";
        yield* Effect.promise(() => NodeFSP.writeFile(file, text));
        const instanceId = ProviderInstanceId.make(provider);
        const info: ServerProvider = {
          instanceId,
          driver: ProviderDriverKind.make(provider),
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: stamp,
          models: [],
          slashCommands: [],
          skills: [],
        };
        const settings = {
          ...DEFAULT_SERVER_SETTINGS,
          providers: {
            ...DEFAULT_SERVER_SETTINGS.providers,
            [provider]: { ...DEFAULT_SERVER_SETTINGS.providers[provider], homePath: home },
          },
        };
        let model = createEmptyReadModel(stamp);
        let sequence = 0;
        const commands: OrchestrationCommand[] = [];
        const bindings: ProviderRuntimeBindingWithMetadata[] = [];
        const layer = Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(ServerSettingsService)({ getSettings: Effect.succeed(settings) }),
          Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([info]) }),
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () => Effect.succeed(model),
            getThreadDetailById: (id) =>
              Effect.succeed(Option.fromNullishOr(model.threads.find((t) => t.id === id))),
          }),
          Layer.mock(ProviderSessionDirectory)({
            listBindings: () => Effect.succeed(bindings),
            getBinding: (id) =>
              Effect.succeed(Option.fromNullishOr(bindings.find((b) => b.threadId === id))),
            recordImportedTranscript: () => Effect.void,
            upsert: (binding) =>
              Effect.sync(() => {
                bindings.push({ ...binding, lastSeenAt: stamp });
              }),
          }),
          Layer.mock(OrchestrationEngineService)({
            dispatch: (command) =>
              Effect.gen(function* () {
                commands.push(command);
                const planned = yield* decideOrchestrationCommand({ readModel: model, command });
                for (const event of Array.isArray(planned) ? planned : [planned]) {
                  model = yield* projectEvent(model, { ...event, sequence: ++sequence });
                }
                return { sequence };
              }).pipe(Effect.provide(NodeServices.layer), Effect.orDie),
          }),
        );
        const found = (yield* Effect.promise(() =>
          discoverThreads({
            provider,
            instanceId,
            providerHome: home,
            officialHome: NodePath.join(root, "official"),
          }),
        )).threads[0]!;
        yield* Effect.gen(function* () {
          const importer = yield* makeExistingThreads;
          const input = { instanceId, id: found.summary.id, sessionReleased: true as const };
          const [first, second] = yield* Effect.all(
            [importer.importThread(input), importer.importThread(input)],
            { concurrency: "unbounded" },
          );
          expect(second).toEqual(first);
          // A fresh service must deduplicate using persisted state, too.
          const restarted = yield* makeExistingThreads;
          expect(yield* restarted.importThread(input)).toEqual(first);
        }).pipe(Effect.provide(layer));
        expect(commands.map((c) => c.type)).toEqual([
          "project.create",
          "thread.create",
          "thread.history.import",
        ]);
        expect(bindings).toHaveLength(1);
        expect(bindings[0]?.resumeCursor).toEqual(
          provider === "codex"
            ? { threadId: sessionId, requireExisting: true }
            : { threadId: model.threads[0]?.id, resume: sessionId },
        );
        expect(model.threads).toHaveLength(1);
        expect(model.threads[0]?.messages.map((m) => m.text)).toEqual(["user", "assistant"]);
        expect(yield* Effect.promise(() => NodeFSP.readFile(file, "utf8"))).toBe(text);
      }).pipe(Effect.scoped),
  );
}
