// @effect-diagnostics nodeBuiltinImport:off - Native fixtures verify the read-only import boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { expect, it } from "@effect/vitest";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { OrchestratorProjectionError, OrchestratorV2 } from "../orchestration-v2/Orchestrator.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { layer as idAllocatorLayer } from "../orchestration-v2/IdAllocator.ts";
import { ProviderSessionRuntimeRepository } from "../persistence/ProviderSessionRuntime.ts";
import { AgentSessionImporter } from "../project/AgentSessionImporter.ts";
import { layer as agentSessionImporterLayer } from "../project/AgentSessionImporter.ts";
import * as AgentSessionScanner from "../project/AgentSessionScanner.ts";
import { ProjectService } from "../project/ProjectService.ts";
import * as Stream from "effect/Stream";
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
        const projectId = ProjectId.make(`imported-project-${root}`);
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
        const shells: Array<{ id: ThreadId; deletedAt: null }> = [];
        const upserts: Array<{ resumeCursor?: unknown; threadId?: ThreadId }> = [];
        const writes: OrchestrationV2DomainEvent[] = [];
        let imported = false;
        const threadId = ThreadId.make(`import:${instanceId}:${sessionId}`);
        const runtimeLayer = Layer.mock(ProviderSessionRuntimeRepository)({
          list: () => Effect.succeed(upserts as never),
          upsert: (input: { resumeCursor?: unknown; threadId?: ThreadId }) =>
            Effect.sync(() => void upserts.push(input)),
          recordImportedTranscript: () => Effect.void,
        });
        const importerLayer = agentSessionImporterLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                AgentSessionScanner.AgentSessionScanner,
                AgentSessionScanner.AgentSessionScanner.of({
                  scan: Effect.die("unused"),
                  recentThreads: () => Stream.empty,
                }),
              ),
              Layer.mock(ProjectService)({
                getById: () => Effect.die("importAgentThread does not read projects by id"),
              }),
              Layer.mock(OrchestratorV2)({
                getThreadRecords: () =>
                  imported
                    ? Effect.succeed({
                        thread: { id: threadId, projectId, historyOrigin: "v1_import" },
                      } as never)
                    : Effect.fail(new OrchestratorProjectionError({ threadId })),
              }),
              Layer.mock(EventSinkV2)({
                write: (input) =>
                  Effect.sync(() => {
                    writes.push(...input.events);
                    imported = true;
                    const created = input.events.find((event) => event.type === "thread.created");
                    if (created) shells.push({ id: created.threadId, deletedAt: null });
                    return [];
                  }),
              }),
              runtimeLayer,
              idAllocatorLayer,
            ),
          ),
        );
        const layer = Layer.mergeAll(
          NodeServices.layer,
          Layer.mock(ServerSettingsService)({ getSettings: Effect.succeed(settings) }),
          Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([info]) }),
          Layer.mock(ThreadManagementService)({
            getShellSnapshot: () => Effect.succeed({ threads: shells } as never),
          }),
          Layer.mock(ProjectService)({
            getByWorkspaceRoot: () =>
              Effect.succeed(
                Option.some({
                  id: projectId,
                  workspaceRoot: root,
                  deletedAt: null,
                } as never),
              ),
            create: () => Effect.die("fixture project already exists"),
          }),
          runtimeLayer,
          importerLayer,
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
          const existing = yield* makeExistingThreads;
          const input = { instanceId, id: found.summary.id, sessionReleased: true as const };
          const [first, second] = yield* Effect.all(
            [existing.importThread(input), existing.importThread(input)],
            { concurrency: "unbounded" },
          );
          expect(second).toEqual(first);
          expect(first.threadId).toBe(threadId);
          const restarted = yield* makeExistingThreads;
          expect(yield* restarted.importThread(input)).toEqual(first);
        }).pipe(Effect.provide(layer));
        expect(upserts).toHaveLength(1);
        expect(upserts[0]?.resumeCursor).toEqual(
          provider === "codex"
            ? { threadId: sessionId, requireExisting: true }
            : { threadId, resume: sessionId },
        );
        expect(writes.map((event) => event.type)).toEqual([
          "thread.created",
          "message.updated",
          "turn-item.updated",
          "message.updated",
          "turn-item.updated",
          "provider-thread.updated",
        ]);
        expect(yield* Effect.promise(() => NodeFSP.readFile(file, "utf8"))).toBe(text);
      }).pipe(Effect.scoped),
  );
}
