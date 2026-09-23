import { assert, it } from "@effect/vitest";
import {
  DEFAULT_HERMES_MODEL,
  HERMES_DRIVER_KIND,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2Command as OrchestrationCommand,
  type OrchestrationV2ThreadShell as OrchestrationThreadShell,
} from "@t3tools/contracts";
import type { OrchestrationProject } from "@t3tools/contracts/legacy-orchestration";
import * as DateTime from "effect/DateTime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { OrchestratorDispatchError } from "../orchestration-v2/Orchestrator.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import {
  HOME_THREAD_TITLE,
  getDesignatedHomeThreadId,
  getOrCreateHomeThread,
  readHomeThreadId,
} from "./homeThreads.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

const INSTANCE_ID = ProviderInstanceId.make("hermes-workstation-abc123");
const HOME_THREAD_ID = ThreadId.make("thread-home-1");
const BASE_DIR = "/tmp/t3-home-threads-test";

const agentProject: OrchestrationProject = {
  id: ProjectId.make("agent-project-1"),
  title: "Hermes Workstation",
  workspaceRoot: `${BASE_DIR}/agents/${INSTANCE_ID}`,
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};

const threadShell = (id: ThreadId): OrchestrationThreadShell => ({
  id,
  projectId: agentProject.id,
  title: HOME_THREAD_TITLE,
  providerInstanceId: INSTANCE_ID,
  modelSelection: { instanceId: INSTANCE_ID, model: DEFAULT_HERMES_MODEL },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: null,
  activeRunId: null,
  status: "idle",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
  updatedAt: DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  createdBy: "agent",
  creationSource: "server",
});

const hermesInstance = (config: Record<string, unknown>) => ({
  driver: HERMES_DRIVER_KIND,
  displayName: "Hermes Workstation",
  enabled: true,
  config,
});

/**
 * Query stub answering thread reads from a mutable queue, so a test can model
 * "designated but deleted" — the self-healing path this module exists for.
 */
const makeQueryLayer = () =>
  Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.some(agentProject)),
    }),
    Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
      dispatch: () => Effect.die("unexpected project creation"),
    }),
  );

const makeEngineLayer = (
  dispatched: Ref.Ref<ReadonlyArray<OrchestrationCommand>>,
  threads: Ref.Ref<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>,
  archiveStates:
    | ReadonlyArray<
        Option.Option<{ readonly projectId: ProjectId; readonly archivedAt: string | null }>
      >
    | undefined,
  options: {
    readonly fail?: boolean;
    readonly onDispatch?: (command: OrchestrationCommand) => Effect.Effect<void>;
  } = {},
) =>
  Layer.mock(ThreadManagementService)({
    getThreadShell: (threadId) =>
      Effect.gen(function* () {
        const archive = archiveStates?.[0];
        if (archive !== undefined)
          return Option.isNone(archive)
            ? null
            : {
                ...threadShell(threadId),
                projectId: archive.value.projectId,
                archivedAt:
                  archive.value.archivedAt === null
                    ? null
                    : DateTime.makeUnsafe(archive.value.archivedAt),
              };
        const queue = yield* Ref.get(threads);
        return Option.getOrNull(queue[0] ?? Option.none());
      }),
    dispatch: (command) =>
      Ref.update(dispatched, (calls) => [...calls, command]).pipe(
        Effect.andThen(options.onDispatch ? options.onDispatch(command) : Effect.void),
        Effect.andThen(
          options.fail
            ? Effect.fail(
                new OrchestratorDispatchError({
                  commandId: command.commandId,
                  commandType: command.type,
                  cause: "Simulated dispatch failure.",
                }),
              )
            : Effect.succeed({ sequence: 1, storedEvents: [] }),
        ),
      ),
  });

const configLayer = Layer.succeed(ServerConfig, {
  baseDir: BASE_DIR,
} as unknown as ServerConfig["Service"]);

const testLayer = (input: {
  readonly threads: Ref.Ref<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>;
  readonly dispatched: Ref.Ref<ReadonlyArray<OrchestrationCommand>>;
  readonly providerInstances: Record<string, unknown>;
  readonly failDispatch?: boolean;
  /** Fires inside `getOrCreateHomeThread`, right after `thread.create`. */
  readonly onDispatch?: (command: OrchestrationCommand) => Effect.Effect<void, never, never>;
  /**
   * Settings layer to use instead of a fresh one. A test that needs to write
   * settings from `onDispatch` builds the layer itself so both sides share one
   * store.
   */
  readonly settingsLayer?: ReturnType<typeof ServerSettings.layerTest>;
  /**
   * Archive-state rows. Unlike the shell queue these ignore archive state, so
   * a test can model "archived, therefore invisible to the shell query but
   * still very much present" — the case that used to mint a second Home.
   */
  readonly archiveStates?: ReadonlyArray<
    Option.Option<{ readonly projectId: ProjectId; readonly archivedAt: string | null }>
  >;
}) =>
  Layer.mergeAll(
    makeQueryLayer(),
    makeEngineLayer(input.dispatched, input.threads, input.archiveStates, {
      ...(input.failDispatch ? { fail: true } : {}),
      ...(input.onDispatch ? { onDispatch: input.onDispatch } : {}),
    }),
    configLayer,
    input.settingsLayer ??
      ServerSettings.layerTest({
        providerInstances: input.providerInstances,
      } as never),
    NodeServices.layer,
  );

it("reads a designation only from a Hermes envelope", () => {
  assert.equal(
    readHomeThreadId(hermesInstance({ homeThreadId: HOME_THREAD_ID }) as never),
    HOME_THREAD_ID,
  );
  assert.equal(readHomeThreadId(hermesInstance({}) as never), undefined);
  // An empty string is "not designated", not a thread whose id is "".
  assert.equal(readHomeThreadId(hermesInstance({ homeThreadId: "" }) as never), undefined);
  // A designation on a non-Hermes envelope is not ours to honour.
  assert.equal(
    readHomeThreadId({ driver: "codex", homeThreadId: HOME_THREAD_ID } as never),
    undefined,
  );
});

it.effect("returns the designated thread without dispatching anything", () =>
  Effect.gen(function* () {
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.some(threadShell(HOME_THREAD_ID)),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    const resolved = yield* getOrCreateHomeThread({
      instanceId: INSTANCE_ID,
      title: "Hermes Workstation",
    }).pipe(
      Effect.provide(
        testLayer({
          threads,
          dispatched,
          providerInstances: {
            [INSTANCE_ID]: hermesInstance({ homeThreadId: HOME_THREAD_ID }),
          },
        }),
      ),
    );

    assert.equal(resolved, HOME_THREAD_ID);
    // This runs on every handshake; it must not create anything on the happy path.
    assert.deepEqual(yield* Ref.get(dispatched), []);
  }),
);

it.effect("creates and persists a Home thread when none is designated", () =>
  Effect.gen(function* () {
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.none(),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    yield* Effect.gen(function* () {
      const resolved = yield* getOrCreateHomeThread({
        instanceId: INSTANCE_ID,
        title: "Hermes Workstation",
      });

      const commands = yield* Ref.get(dispatched);
      const created = commands.find((command) => command.type === "thread.create");
      assert.isDefined(created);
      if (created?.type === "thread.create") {
        assert.equal(created.threadId, resolved);
        assert.equal(created.title, HOME_THREAD_TITLE);
        assert.equal(created.projectId, agentProject.id);
        // Binds to the fixed Hermes slug, not to whatever model the plugin
        // currently reports — otherwise the thread orphans on a model change.
        assert.equal(created.modelSelection.model, DEFAULT_HERMES_MODEL);
      }

      // The designation must be durable, or the next handshake mints a second
      // Home and the first one's history is stranded.
      assert.equal(yield* getDesignatedHomeThreadId(INSTANCE_ID), resolved);
    }).pipe(
      Effect.provide(
        testLayer({
          threads,
          dispatched,
          providerInstances: { [INSTANCE_ID]: hermesInstance({}) },
        }),
      ),
    );
  }),
);

it.effect("self-heals a designation whose thread no longer exists", () =>
  Effect.gen(function* () {
    // A deleted home thread must not strand the instance: it re-designates
    // rather than failing every future delivery.
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.none(),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    const resolved = yield* getOrCreateHomeThread({
      instanceId: INSTANCE_ID,
      title: "Hermes Workstation",
    }).pipe(
      Effect.provide(
        testLayer({
          threads,
          dispatched,
          providerInstances: {
            [INSTANCE_ID]: hermesInstance({ homeThreadId: "thread-deleted-long-ago" }),
          },
        }),
      ),
    );

    assert.notEqual(resolved, "thread-deleted-long-ago");
    const commands = yield* Ref.get(dispatched);
    assert.isDefined(commands.find((command) => command.type === "thread.create"));
  }),
);

it.effect("replaces a Home whose provider selection has changed", () =>
  Effect.gen(function* () {
    const foreignInstance = ProviderInstanceId.make("codex-other");
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.some({
        ...threadShell(HOME_THREAD_ID),
        providerInstanceId: foreignInstance,
        modelSelection: { instanceId: foreignInstance, model: "other-model" },
      }),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const resolved = yield* getOrCreateHomeThread({
      instanceId: INSTANCE_ID,
      title: "Hermes Workstation",
    }).pipe(
      Effect.provide(
        testLayer({
          threads,
          dispatched,
          providerInstances: { [INSTANCE_ID]: hermesInstance({ homeThreadId: HOME_THREAD_ID }) },
        }),
      ),
    );
    assert.notEqual(resolved, HOME_THREAD_ID);
    const commands = yield* Ref.get(dispatched);
    const created = commands.find((command) => command.type === "thread.create");
    assert.equal(created?.modelSelection.instanceId, INSTANCE_ID);
    assert.equal(created?.threadId, resolved);
  }),
);

it.effect("adopts a racing caller's designation when its own dispatch fails", () =>
  Effect.gen(function* () {
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.none(),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    // The loser of the race sees a dispatch failure but must still return the
    // winner's thread rather than surfacing an error to the handshake.
    const resolved = yield* getOrCreateHomeThread({
      instanceId: INSTANCE_ID,
      title: "Hermes Workstation",
    }).pipe(
      Effect.provide(
        testLayer({
          threads,
          dispatched,
          failDispatch: true,
          providerInstances: {
            // Designated, but the thread read says gone — so it falls through
            // to create, fails, and re-reads the designation.
            [INSTANCE_ID]: hermesInstance({ homeThreadId: HOME_THREAD_ID }),
          },
        }),
      ),
    );

    assert.equal(resolved, HOME_THREAD_ID);
  }),
);

it.effect("does not clobber a designation that landed while it was creating", () =>
  Effect.gen(function* () {
    // Two handshakes race: both read "no designation", both create a thread.
    // The one that persists *second* must stand down rather than overwrite —
    // otherwise the first caller re-read the winner's id and returned it while
    // this one overwrites with its own, so the two disagree about Home and
    // concurrent proactive deliveries land in two different threads.
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.none(),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const settingsLayer = ServerSettings.layerTest({
      providerInstances: { [INSTANCE_ID]: hermesInstance({}) },
    } as never);

    yield* Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;

      const resolved = yield* getOrCreateHomeThread({
        instanceId: INSTANCE_ID,
        title: "Hermes Workstation",
      }).pipe(
        Effect.provide(
          testLayer({
            threads,
            dispatched,
            providerInstances: {},
            settingsLayer,
            // The racing caller wins the settings write while this one is
            // still between `thread.create` and its own persist.
            onDispatch: () =>
              settings
                .updateSettingsWith((latest) => ({
                  providerInstances: {
                    ...latest.providerInstances,
                    [INSTANCE_ID]: hermesInstance({ homeThreadId: HOME_THREAD_ID }),
                  },
                }))
                .pipe(Effect.ignore),
          }),
        ),
      );

      // Both callers agree on the winner's thread, and the loser's own thread
      // stays an empty thread in the agent project rather than a second Home.
      assert.equal(resolved, HOME_THREAD_ID);
      assert.equal(yield* getDesignatedHomeThreadId(INSTANCE_ID), HOME_THREAD_ID);
    }).pipe(Effect.provide(settingsLayer));
  }),
);

it.effect("keeps an archived Home rather than minting a replacement", () =>
  Effect.gen(function* () {
    // The bug this pins: `getThreadShellById` filters `archived_at IS NULL`, so
    // an archived Home read as *deleted* and the self-healing path created a
    // second one — stranding the real history and silently re-pointing the
    // designation at an empty thread.
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.none(),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    const resolved = yield* getOrCreateHomeThread({
      instanceId: INSTANCE_ID,
      title: "Hermes Workstation",
    }).pipe(
      Effect.provide(
        testLayer({
          threads,
          dispatched,
          archiveStates: [
            Option.some({
              projectId: agentProject.id,
              archivedAt: "2026-01-02T00:00:00.000Z",
            }),
          ],
          providerInstances: {
            [INSTANCE_ID]: hermesInstance({ homeThreadId: HOME_THREAD_ID }),
          },
        }),
      ),
    );

    assert.equal(resolved, HOME_THREAD_ID);
    const commands = yield* Ref.get(dispatched);
    assert.isUndefined(
      commands.find((command) => command.type === "thread.create"),
      "an archived Home must never be replaced by a new thread",
    );
    // A delivery is the agent raising its hand, so it brings the thread back
    // rather than landing somewhere the user cannot see.
    const unarchive = commands.find((command) => command.type === "thread.unarchive");
    assert.isDefined(unarchive);
    if (unarchive?.type === "thread.unarchive") {
      assert.equal(unarchive.threadId, HOME_THREAD_ID);
    }
  }),
);

it.effect("does not un-archive a Home that was never archived", () =>
  Effect.gen(function* () {
    const threads = yield* Ref.make<ReadonlyArray<Option.Option<OrchestrationThreadShell>>>([
      Option.some(threadShell(HOME_THREAD_ID)),
    ]);
    const dispatched = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);

    yield* getOrCreateHomeThread({
      instanceId: INSTANCE_ID,
      title: "Hermes Workstation",
    }).pipe(
      Effect.provide(
        testLayer({
          threads,
          dispatched,
          archiveStates: [Option.some({ projectId: agentProject.id, archivedAt: null })],
          providerInstances: {
            [INSTANCE_ID]: hermesInstance({ homeThreadId: HOME_THREAD_ID }),
          },
        }),
      ),
    );

    // The common path stays free of writes; this runs on every handshake.
    assert.deepEqual(yield* Ref.get(dispatched), []);
  }),
);
