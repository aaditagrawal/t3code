import { Cause, Effect, Layer, Option, Queue, Ref, Schema, Stream } from "effect";
import {
  CommandId,
  EventId,
  type OrchestrationCommand,
  type GitActionProgressEvent,
  type GitManagerServiceError,
  OrchestrationDispatchCommandError,
  type OrchestrationEvent,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetSnapshotError,
  OrchestrationGetTurnDiffError,
  ORCHESTRATION_WS_METHODS,
  ProjectSearchEntriesError,
  ProjectWriteFileError,
  OrchestrationReplayEventsError,
  ThreadId,
  type TerminalEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import { clamp } from "effect/Number";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { CheckpointDiffQuery } from "./checkpointing/Services/CheckpointDiffQuery";
import { ServerConfig } from "./config";
import { GitCore } from "./git/Services/GitCore";
import { GitManager } from "./git/Services/GitManager";
import { Keybindings } from "./keybindings";
import { Open, resolveAvailableEditors } from "./open";
import { normalizeDispatchCommand } from "./orchestration/Normalizer";
import { OrchestrationEngineService } from "./orchestration/Services/OrchestrationEngine";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import {
  observeRpcEffect,
  observeRpcStream,
  observeRpcStreamEffect,
} from "./observability/RpcInstrumentation";
import { ProviderRegistry } from "./provider/Services/ProviderRegistry";
import { ServerLifecycleEvents } from "./serverLifecycleEvents";
import { ServerRuntimeStartup } from "./serverRuntimeStartup";
import { ServerSettingsService } from "./serverSettings";
import { TerminalManager } from "./terminal/Services/Manager";
import { WorkspaceEntries } from "./workspace/Services/WorkspaceEntries";
import { WorkspaceFileSystem } from "./workspace/Services/WorkspaceFileSystem";
import { WorkspacePathOutsideRootError } from "./workspace/Services/WorkspacePaths";
import { ProjectSetupScriptRunner } from "./project/Services/ProjectSetupScriptRunner";
import { CostTrackingService } from "./cost/Services/CostTrackingService";
import { AuditLogService } from "./audit/Services/AuditLogService";
import { CIIntegrationService } from "./ci/Services/CIIntegrationService";
import { ProviderRouterService } from "./routing/Services/ProviderRouterService";
import { PipelineService } from "./pipeline/Services/PipelineService";
import { WorkflowService } from "./workflow/Services/WorkflowService";
import { TaskDecompositionService } from "./task/Services/TaskDecompositionService";
import { ProjectMemoryService } from "./memory/Services/ProjectMemoryService";
import { PresenceService } from "./presence/Services/PresenceService";

const WsRpcLayer = WsRpcGroup.toLayer(
  Effect.gen(function* () {
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const checkpointDiffQuery = yield* CheckpointDiffQuery;
    const keybindings = yield* Keybindings;
    const open = yield* Open;
    const gitManager = yield* GitManager;
    const git = yield* GitCore;
    const terminalManager = yield* TerminalManager;
    const providerRegistry = yield* ProviderRegistry;
    const config = yield* ServerConfig;
    const lifecycleEvents = yield* ServerLifecycleEvents;
    const serverSettings = yield* ServerSettingsService;
    const startup = yield* ServerRuntimeStartup;
    const workspaceEntries = yield* WorkspaceEntries;
    const workspaceFileSystem = yield* WorkspaceFileSystem;
    const projectSetupScriptRunner = yield* ProjectSetupScriptRunner;
    const costTracking = yield* CostTrackingService;
    const auditLog = yield* AuditLogService;
    const ciIntegration = yield* CIIntegrationService;
    const providerRouter = yield* ProviderRouterService;
    const pipelineService = yield* PipelineService;
    const workflowService = yield* WorkflowService;
    const taskDecomposition = yield* TaskDecompositionService;
    const projectMemory = yield* ProjectMemoryService;
    const presenceService = yield* PresenceService;

    const serverCommandId = (tag: string) =>
      CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`);

    const appendSetupScriptActivity = (input: {
      readonly threadId: ThreadId;
      readonly kind: "setup-script.requested" | "setup-script.started" | "setup-script.failed";
      readonly summary: string;
      readonly createdAt: string;
      readonly payload: Record<string, unknown>;
      readonly tone: "info" | "error";
    }) =>
      orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: serverCommandId("setup-script-activity"),
        threadId: input.threadId,
        activity: {
          id: EventId.makeUnsafe(crypto.randomUUID()),
          tone: input.tone,
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt: input.createdAt,
        },
        createdAt: input.createdAt,
      });

    const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
      Schema.is(OrchestrationDispatchCommandError)(cause)
        ? cause
        : new OrchestrationDispatchCommandError({
            message: cause instanceof Error ? cause.message : fallbackMessage,
            cause,
          });

    const toBootstrapDispatchCommandCauseError = (cause: Cause.Cause<unknown>) => {
      const error = Cause.squash(cause);
      return Schema.is(OrchestrationDispatchCommandError)(error)
        ? error
        : new OrchestrationDispatchCommandError({
            message:
              error instanceof Error ? error.message : "Failed to bootstrap thread turn start.",
            cause,
          });
    };

    const dispatchBootstrapTurnStart = (
      command: Extract<OrchestrationCommand, { type: "thread.turn.start" }>,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
      Effect.gen(function* () {
        const bootstrap = command.bootstrap;
        const { bootstrap: _bootstrap, ...finalTurnStartCommand } = command;
        let createdThread = false;
        let targetProjectId = bootstrap?.createThread?.projectId;
        let targetProjectCwd = bootstrap?.prepareWorktree?.projectCwd;
        let targetWorktreePath = bootstrap?.createThread?.worktreePath ?? null;

        const cleanupCreatedThread = () =>
          createdThread
            ? orchestrationEngine
                .dispatch({
                  type: "thread.delete",
                  commandId: serverCommandId("bootstrap-thread-delete"),
                  threadId: command.threadId,
                })
                .pipe(Effect.ignoreCause({ log: true }))
            : Effect.void;

        const recordSetupScriptLaunchFailure = (input: {
          readonly error: unknown;
          readonly requestedAt: string;
          readonly worktreePath: string;
        }) => {
          const detail =
            input.error instanceof Error ? input.error.message : "Unknown setup failure.";
          return appendSetupScriptActivity({
            threadId: command.threadId,
            kind: "setup-script.failed",
            summary: "Setup script failed to start",
            createdAt: input.requestedAt,
            payload: {
              detail,
              worktreePath: input.worktreePath,
            },
            tone: "error",
          }).pipe(
            Effect.ignoreCause({ log: false }),
            Effect.flatMap(() =>
              Effect.logWarning("bootstrap turn start failed to launch setup script", {
                threadId: command.threadId,
                worktreePath: input.worktreePath,
                detail,
              }),
            ),
          );
        };

        const recordSetupScriptStarted = (input: {
          readonly requestedAt: string;
          readonly worktreePath: string;
          readonly scriptId: string;
          readonly scriptName: string;
          readonly terminalId: string;
        }) => {
          const payload = {
            scriptId: input.scriptId,
            scriptName: input.scriptName,
            terminalId: input.terminalId,
            worktreePath: input.worktreePath,
          };
          return Effect.all([
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.requested",
              summary: "Starting setup script",
              createdAt: input.requestedAt,
              payload,
              tone: "info",
            }),
            appendSetupScriptActivity({
              threadId: command.threadId,
              kind: "setup-script.started",
              summary: "Setup script started",
              createdAt: new Date().toISOString(),
              payload,
              tone: "info",
            }),
          ]).pipe(
            Effect.asVoid,
            Effect.catch((error) =>
              Effect.logWarning(
                "bootstrap turn start launched setup script but failed to record setup activity",
                {
                  threadId: command.threadId,
                  worktreePath: input.worktreePath,
                  scriptId: input.scriptId,
                  terminalId: input.terminalId,
                  detail:
                    error instanceof Error
                      ? error.message
                      : "Unknown setup activity dispatch failure.",
                },
              ),
            ),
          );
        };

        const runSetupProgram = () =>
          bootstrap?.runSetupScript && targetWorktreePath
            ? (() => {
                const worktreePath = targetWorktreePath;
                const requestedAt = new Date().toISOString();
                return projectSetupScriptRunner
                  .runForThread({
                    threadId: command.threadId,
                    ...(targetProjectId ? { projectId: targetProjectId } : {}),
                    ...(targetProjectCwd ? { projectCwd: targetProjectCwd } : {}),
                    worktreePath,
                  })
                  .pipe(
                    Effect.matchEffect({
                      onFailure: (error) =>
                        recordSetupScriptLaunchFailure({
                          error,
                          requestedAt,
                          worktreePath,
                        }),
                      onSuccess: (setupResult) => {
                        if (setupResult.status !== "started") {
                          return Effect.void;
                        }
                        return recordSetupScriptStarted({
                          requestedAt,
                          worktreePath,
                          scriptId: setupResult.scriptId,
                          scriptName: setupResult.scriptName,
                          terminalId: setupResult.terminalId,
                        });
                      },
                    }),
                  );
              })()
            : Effect.void;

        const bootstrapProgram = Effect.gen(function* () {
          if (bootstrap?.createThread) {
            yield* orchestrationEngine.dispatch({
              type: "thread.create",
              commandId: serverCommandId("bootstrap-thread-create"),
              threadId: command.threadId,
              projectId: bootstrap.createThread.projectId,
              title: bootstrap.createThread.title,
              modelSelection: bootstrap.createThread.modelSelection,
              runtimeMode: bootstrap.createThread.runtimeMode,
              interactionMode: bootstrap.createThread.interactionMode,
              branch: bootstrap.createThread.branch,
              worktreePath: bootstrap.createThread.worktreePath,
              createdAt: bootstrap.createThread.createdAt,
            });
            createdThread = true;
          }

          if (bootstrap?.prepareWorktree) {
            const worktree = yield* git.createWorktree({
              cwd: bootstrap.prepareWorktree.projectCwd,
              branch: bootstrap.prepareWorktree.baseBranch,
              newBranch: bootstrap.prepareWorktree.branch,
              path: null,
            });
            targetWorktreePath = worktree.worktree.path;
            yield* orchestrationEngine.dispatch({
              type: "thread.meta.update",
              commandId: serverCommandId("bootstrap-thread-meta-update"),
              threadId: command.threadId,
              branch: worktree.worktree.branch,
              worktreePath: targetWorktreePath,
            });
          }

          yield* runSetupProgram();

          return yield* orchestrationEngine.dispatch(finalTurnStartCommand);
        });

        return yield* bootstrapProgram.pipe(
          Effect.catchCause((cause) => {
            const dispatchError = toBootstrapDispatchCommandCauseError(cause);
            if (Cause.hasInterruptsOnly(cause)) {
              return Effect.fail(dispatchError);
            }
            return cleanupCreatedThread().pipe(Effect.flatMap(() => Effect.fail(dispatchError)));
          }),
        );
      });

    const dispatchNormalizedCommand = (
      normalizedCommand: OrchestrationCommand,
    ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> => {
      const dispatchEffect =
        normalizedCommand.type === "thread.turn.start" && normalizedCommand.bootstrap
          ? dispatchBootstrapTurnStart(normalizedCommand)
          : orchestrationEngine
              .dispatch(normalizedCommand)
              .pipe(
                Effect.mapError((cause) =>
                  toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
                ),
              );

      return startup
        .enqueueCommand(dispatchEffect)
        .pipe(
          Effect.mapError((cause) =>
            toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
          ),
        );
    };

    const loadServerConfig = Effect.gen(function* () {
      const keybindingsConfig = yield* keybindings.loadConfigState;
      const providers = yield* providerRegistry.getProviders;
      const settings = yield* serverSettings.getSettings;

      return {
        cwd: config.cwd,
        keybindingsConfigPath: config.keybindingsConfigPath,
        keybindings: keybindingsConfig.keybindings,
        issues: keybindingsConfig.issues,
        providers,
        availableEditors: resolveAvailableEditors(),
        observability: {
          logsDirectoryPath: config.logsDir,
          localTracingEnabled: true,
          ...(config.otlpTracesUrl !== undefined ? { otlpTracesUrl: config.otlpTracesUrl } : {}),
          otlpTracesEnabled: config.otlpTracesUrl !== undefined,
          ...(config.otlpMetricsUrl !== undefined ? { otlpMetricsUrl: config.otlpMetricsUrl } : {}),
          otlpMetricsEnabled: config.otlpMetricsUrl !== undefined,
        },
        settings,
      };
    });

    return WsRpcGroup.of({
      [ORCHESTRATION_WS_METHODS.getSnapshot]: (_input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getSnapshot,
          projectionSnapshotQuery.getSnapshot().pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetSnapshotError({
                  message: "Failed to load orchestration snapshot",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.dispatchCommand,
          Effect.gen(function* () {
            const normalizedCommand = yield* normalizeDispatchCommand(command);
            const result = yield* dispatchNormalizedCommand(normalizedCommand);
            if (normalizedCommand.type === "thread.archive") {
              yield* terminalManager.close({ threadId: normalizedCommand.threadId }).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("failed to close thread terminals after archive", {
                    threadId: normalizedCommand.threadId,
                    error: error.message,
                  }),
                ),
              );
            }
            return result;
          }).pipe(
            Effect.mapError((cause) =>
              Schema.is(OrchestrationDispatchCommandError)(cause)
                ? cause
                : new OrchestrationDispatchCommandError({
                    message: "Failed to dispatch orchestration command",
                    cause,
                  }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getTurnDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getTurnDiff,
          checkpointDiffQuery.getTurnDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetTurnDiffError({
                  message: "Failed to load turn diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.getFullThreadDiff]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.getFullThreadDiff,
          checkpointDiffQuery.getFullThreadDiff(input).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestrationGetFullThreadDiffError({
                  message: "Failed to load full thread diff",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [ORCHESTRATION_WS_METHODS.replayEvents]: (input) =>
        observeRpcEffect(
          ORCHESTRATION_WS_METHODS.replayEvents,
          Stream.runCollect(
            orchestrationEngine.readEvents(
              clamp(input.fromSequenceExclusive, { maximum: Number.MAX_SAFE_INTEGER, minimum: 0 }),
            ),
          ).pipe(
            Effect.map((events) => Array.from(events)),
            Effect.mapError(
              (cause) =>
                new OrchestrationReplayEventsError({
                  message: "Failed to replay orchestration events",
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.subscribeOrchestrationDomainEvents]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeOrchestrationDomainEvents,
          Effect.gen(function* () {
            const snapshot = yield* orchestrationEngine.getReadModel();
            const fromSequenceExclusive = snapshot.snapshotSequence;
            const replayEvents: Array<OrchestrationEvent> = yield* Stream.runCollect(
              orchestrationEngine.readEvents(fromSequenceExclusive),
            ).pipe(
              Effect.map((events) => Array.from(events)),
              Effect.catch(() => Effect.succeed([] as Array<OrchestrationEvent>)),
            );
            const replayStream = Stream.fromIterable(replayEvents);
            const source = Stream.merge(replayStream, orchestrationEngine.streamDomainEvents);
            type SequenceState = {
              readonly nextSequence: number;
              readonly pendingBySequence: Map<number, OrchestrationEvent>;
            };
            const state = yield* Ref.make<SequenceState>({
              nextSequence: fromSequenceExclusive + 1,
              pendingBySequence: new Map<number, OrchestrationEvent>(),
            });

            return source.pipe(
              Stream.mapEffect((event) =>
                Ref.modify(
                  state,
                  ({
                    nextSequence,
                    pendingBySequence,
                  }): [Array<OrchestrationEvent>, SequenceState] => {
                    if (event.sequence < nextSequence || pendingBySequence.has(event.sequence)) {
                      return [[], { nextSequence, pendingBySequence }];
                    }

                    const updatedPending = new Map(pendingBySequence);
                    updatedPending.set(event.sequence, event);

                    const emit: Array<OrchestrationEvent> = [];
                    let expected = nextSequence;
                    for (;;) {
                      const expectedEvent = updatedPending.get(expected);
                      if (!expectedEvent) {
                        break;
                      }
                      emit.push(expectedEvent);
                      updatedPending.delete(expected);
                      expected += 1;
                    }

                    return [emit, { nextSequence: expected, pendingBySequence: updatedPending }];
                  },
                ),
              ),
              Stream.flatMap((events) => Stream.fromIterable(events)),
            );
          }),
          { "rpc.aggregate": "orchestration" },
        ),
      [WS_METHODS.serverGetConfig]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetConfig, loadServerConfig, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverRefreshProviders]: (_input) =>
        observeRpcEffect(
          WS_METHODS.serverRefreshProviders,
          providerRegistry.refresh().pipe(Effect.map((providers) => ({ providers }))),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverUpsertKeybinding]: (rule) =>
        observeRpcEffect(
          WS_METHODS.serverUpsertKeybinding,
          Effect.gen(function* () {
            const keybindingsConfig = yield* keybindings.upsertKeybindingRule(rule);
            return { keybindings: keybindingsConfig, issues: [] };
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.serverGetSettings]: (_input) =>
        observeRpcEffect(WS_METHODS.serverGetSettings, serverSettings.getSettings, {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.serverUpdateSettings]: ({ patch }) =>
        observeRpcEffect(WS_METHODS.serverUpdateSettings, serverSettings.updateSettings(patch), {
          "rpc.aggregate": "server",
        }),
      [WS_METHODS.projectsSearchEntries]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsSearchEntries,
          workspaceEntries.search(input).pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSearchEntriesError({
                  message: `Failed to search workspace entries: ${cause.detail}`,
                  cause,
                }),
            ),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.projectsWriteFile]: (input) =>
        observeRpcEffect(
          WS_METHODS.projectsWriteFile,
          workspaceFileSystem.writeFile(input).pipe(
            Effect.mapError((cause) => {
              const message = Schema.is(WorkspacePathOutsideRootError)(cause)
                ? "Workspace file path must stay within the project root."
                : "Failed to write workspace file";
              return new ProjectWriteFileError({
                message,
                cause,
              });
            }),
          ),
          { "rpc.aggregate": "workspace" },
        ),
      [WS_METHODS.shellOpenInEditor]: (input) =>
        observeRpcEffect(WS_METHODS.shellOpenInEditor, open.openInEditor(input), {
          "rpc.aggregate": "workspace",
        }),
      [WS_METHODS.gitStatus]: (input) =>
        observeRpcEffect(WS_METHODS.gitStatus, gitManager.status(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitPull]: (input) =>
        observeRpcEffect(WS_METHODS.gitPull, git.pullCurrentBranch(input.cwd), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitRunStackedAction]: (input) =>
        observeRpcStream(
          WS_METHODS.gitRunStackedAction,
          Stream.callback<GitActionProgressEvent, GitManagerServiceError>((queue) =>
            gitManager
              .runStackedAction(input, {
                actionId: input.actionId,
                progressReporter: {
                  publish: (event) => Queue.offer(queue, event).pipe(Effect.asVoid),
                },
              })
              .pipe(
                Effect.matchCauseEffect({
                  onFailure: (cause) => Queue.failCause(queue, cause),
                  onSuccess: () => Queue.end(queue).pipe(Effect.asVoid),
                }),
              ),
          ),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitResolvePullRequest]: (input) =>
        observeRpcEffect(WS_METHODS.gitResolvePullRequest, gitManager.resolvePullRequest(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitPreparePullRequestThread]: (input) =>
        observeRpcEffect(
          WS_METHODS.gitPreparePullRequestThread,
          gitManager.preparePullRequestThread(input),
          { "rpc.aggregate": "git" },
        ),
      [WS_METHODS.gitListBranches]: (input) =>
        observeRpcEffect(WS_METHODS.gitListBranches, git.listBranches(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCreateWorktree]: (input) =>
        observeRpcEffect(WS_METHODS.gitCreateWorktree, git.createWorktree(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitRemoveWorktree]: (input) =>
        observeRpcEffect(WS_METHODS.gitRemoveWorktree, git.removeWorktree(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCreateBranch]: (input) =>
        observeRpcEffect(WS_METHODS.gitCreateBranch, git.createBranch(input), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitCheckout]: (input) =>
        observeRpcEffect(WS_METHODS.gitCheckout, Effect.scoped(git.checkoutBranch(input)), {
          "rpc.aggregate": "git",
        }),
      [WS_METHODS.gitInit]: (input) =>
        observeRpcEffect(WS_METHODS.gitInit, git.initRepo(input), { "rpc.aggregate": "git" }),
      [WS_METHODS.terminalOpen]: (input) =>
        observeRpcEffect(WS_METHODS.terminalOpen, terminalManager.open(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalWrite]: (input) =>
        observeRpcEffect(WS_METHODS.terminalWrite, terminalManager.write(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalResize]: (input) =>
        observeRpcEffect(WS_METHODS.terminalResize, terminalManager.resize(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClear]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClear, terminalManager.clear(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalRestart]: (input) =>
        observeRpcEffect(WS_METHODS.terminalRestart, terminalManager.restart(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.terminalClose]: (input) =>
        observeRpcEffect(WS_METHODS.terminalClose, terminalManager.close(input), {
          "rpc.aggregate": "terminal",
        }),
      [WS_METHODS.subscribeTerminalEvents]: (_input) =>
        observeRpcStream(
          WS_METHODS.subscribeTerminalEvents,
          Stream.callback<TerminalEvent>((queue) =>
            Effect.acquireRelease(
              terminalManager.subscribe((event) => Queue.offer(queue, event)),
              (unsubscribe) => Effect.sync(unsubscribe),
            ),
          ),
          { "rpc.aggregate": "terminal" },
        ),
      [WS_METHODS.subscribeServerConfig]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerConfig,
          Effect.gen(function* () {
            const keybindingsUpdates = keybindings.streamChanges.pipe(
              Stream.map((event) => ({
                version: 1 as const,
                type: "keybindingsUpdated" as const,
                payload: {
                  issues: event.issues,
                },
              })),
            );
            const providerStatuses = providerRegistry.streamChanges.pipe(
              Stream.map((providers) => ({
                version: 1 as const,
                type: "providerStatuses" as const,
                payload: { providers },
              })),
            );
            const settingsUpdates = serverSettings.streamChanges.pipe(
              Stream.map((settings) => ({
                version: 1 as const,
                type: "settingsUpdated" as const,
                payload: { settings },
              })),
            );

            return Stream.concat(
              Stream.make({
                version: 1 as const,
                type: "snapshot" as const,
                config: yield* loadServerConfig,
              }),
              Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates)),
            );
          }),
          { "rpc.aggregate": "server" },
        ),
      [WS_METHODS.subscribeServerLifecycle]: (_input) =>
        observeRpcStreamEffect(
          WS_METHODS.subscribeServerLifecycle,
          Effect.gen(function* () {
            const snapshot = yield* lifecycleEvents.snapshot;
            const snapshotEvents = Array.from(snapshot.events).toSorted(
              (left, right) => left.sequence - right.sequence,
            );
            const liveEvents = lifecycleEvents.stream.pipe(
              Stream.filter((event) => event.sequence > snapshot.sequence),
            );
            return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents);
          }),
          { "rpc.aggregate": "server" },
        ),

      // ── Cost Tracking ────────────────────────────────────────────────────
      [WS_METHODS.costGetSummary]: (input) =>
        observeRpcEffect(WS_METHODS.costGetSummary, costTracking.getSummary(input), {
          "rpc.aggregate": "cost",
        }),
      [WS_METHODS.costSetBudget]: (input) =>
        observeRpcEffect(WS_METHODS.costSetBudget, costTracking.setBudget(input), {
          "rpc.aggregate": "cost",
        }),
      [WS_METHODS.costGetBudgets]: (input) =>
        observeRpcEffect(
          WS_METHODS.costGetBudgets,
          costTracking.getBudgets({ projectId: input.projectId }),
          { "rpc.aggregate": "cost" },
        ),
      [WS_METHODS.subscribeCostEvents]: (_input) =>
        observeRpcStream(WS_METHODS.subscribeCostEvents, costTracking.streamEvents, {
          "rpc.aggregate": "cost",
        }),

      // ── Audit Log ────────────────────────────────────────────────────────
      [WS_METHODS.auditQuery]: (input) =>
        observeRpcEffect(WS_METHODS.auditQuery, auditLog.query(input), {
          "rpc.aggregate": "audit",
        }),
      [WS_METHODS.subscribeAuditEvents]: (_input) =>
        observeRpcStream(WS_METHODS.subscribeAuditEvents, auditLog.streamEvents, {
          "rpc.aggregate": "audit",
        }),

      // ── CI/CD ────────────────────────────────────────────────────────────
      [WS_METHODS.ciGetStatus]: (input) =>
        observeRpcEffect(WS_METHODS.ciGetStatus, ciIntegration.getStatus(input), {
          "rpc.aggregate": "ci",
        }),
      [WS_METHODS.ciTriggerRerun]: (input) =>
        observeRpcEffect(
          WS_METHODS.ciTriggerRerun,
          ciIntegration.triggerRerun(input).pipe(Effect.asVoid),
          { "rpc.aggregate": "ci" },
        ),
      [WS_METHODS.ciSetFeedbackPolicy]: (input) =>
        observeRpcEffect(WS_METHODS.ciSetFeedbackPolicy, ciIntegration.setFeedbackPolicy(input), {
          "rpc.aggregate": "ci",
        }),
      [WS_METHODS.subscribeCIEvents]: (_input) =>
        observeRpcStream(WS_METHODS.subscribeCIEvents, ciIntegration.streamEvents, {
          "rpc.aggregate": "ci",
        }),

      // ── Routing ──────────────────────────────────────────────────────────
      [WS_METHODS.routingGetHealth]: (_input) =>
        observeRpcEffect(WS_METHODS.routingGetHealth, providerRouter.getHealth(), {
          "rpc.aggregate": "routing",
        }),
      [WS_METHODS.routingSetRules]: (input) =>
        observeRpcEffect(WS_METHODS.routingSetRules, providerRouter.setRules(input), {
          "rpc.aggregate": "routing",
        }),
      [WS_METHODS.routingGetRules]: (_input) =>
        observeRpcEffect(WS_METHODS.routingGetRules, providerRouter.getRules(), {
          "rpc.aggregate": "routing",
        }),
      [WS_METHODS.subscribeRoutingEvents]: (_input) =>
        observeRpcStream(WS_METHODS.subscribeRoutingEvents, providerRouter.streamEvents, {
          "rpc.aggregate": "routing",
        }),

      // ── Pipelines ────────────────────────────────────────────────────────
      [WS_METHODS.pipelineCreate]: (input) =>
        observeRpcEffect(
          WS_METHODS.pipelineCreate,
          pipelineService
            .create({
              id: crypto.randomUUID(),
              name: input.name,
              description: input.description,
              projectId: input.projectId,
              stages: input.stages.map((s) => ({
                id: s.id,
                name: s.name,
                prompt: s.prompt,
                dependsOn: s.dependsOn,
              })),
            })
            .pipe(
              Effect.map((def) => ({
                id: def.id as import("@t3tools/contracts").PipelineId,
                name: def.name as import("@t3tools/contracts").PipelineDefinition["name"],
                description: def.description,
                projectId:
                  def.projectId as import("@t3tools/contracts").PipelineDefinition["projectId"],
                stages: input.stages,
                createdAt: def.createdAt,
                updatedAt: def.updatedAt,
              })),
            ),
          { "rpc.aggregate": "pipeline" },
        ),
      [WS_METHODS.pipelineList]: (input) =>
        observeRpcEffect(
          WS_METHODS.pipelineList,
          pipelineService.list({ projectId: input.projectId }).pipe(
            Effect.map((defs) => ({
              pipelines: defs.map((def) => ({
                id: def.id as import("@t3tools/contracts").PipelineId,
                name: def.name as import("@t3tools/contracts").PipelineDefinition["name"],
                description: def.description,
                projectId:
                  def.projectId as import("@t3tools/contracts").PipelineDefinition["projectId"],
                stages: JSON.parse(
                  (def as unknown as { stagesJson: string }).stagesJson ?? "[]",
                ) as import("@t3tools/contracts").PipelineStage[],
                createdAt: def.createdAt,
                updatedAt: def.updatedAt,
              })),
            })),
          ),
          { "rpc.aggregate": "pipeline" },
        ),
      [WS_METHODS.pipelineExecute]: (input) =>
        observeRpcEffect(
          WS_METHODS.pipelineExecute,
          pipelineService
            .execute({
              executionId: crypto.randomUUID(),
              pipelineId: input.pipelineId,
              projectId: input.projectId,
              threadId: crypto.randomUUID(),
            })
            .pipe(
              Effect.map((exec) => ({
                id: exec.id as import("@t3tools/contracts").PipelineExecutionId,
                pipelineId:
                  exec.pipelineId as import("@t3tools/contracts").PipelineExecution["pipelineId"],
                projectId:
                  exec.projectId as import("@t3tools/contracts").PipelineExecution["projectId"],
                status: exec.status as import("@t3tools/contracts").PipelineExecution["status"],
                stages: exec.stages.map((s) => ({
                  stageId: s.stageId as import("@t3tools/contracts").PipelineStageId,
                  status: s.status as import("@t3tools/contracts").PipelineStageExecution["status"],
                  threadId: null,
                  startedAt: s.startedAt,
                  completedAt: s.completedAt,
                  error: s.error,
                  retryCount: 0,
                  output: null,
                })),
                startedAt: exec.startedAt,
                completedAt: exec.completedAt,
                updatedAt: exec.updatedAt,
              })),
            ),
          { "rpc.aggregate": "pipeline" },
        ),
      [WS_METHODS.pipelineGetExecution]: (input) =>
        observeRpcEffect(
          WS_METHODS.pipelineGetExecution,
          pipelineService.getExecution({ executionId: input.executionId }).pipe(
            Effect.flatMap((exec) =>
              exec
                ? Effect.succeed({
                    id: exec.id as import("@t3tools/contracts").PipelineExecutionId,
                    pipelineId:
                      exec.pipelineId as import("@t3tools/contracts").PipelineExecution["pipelineId"],
                    projectId:
                      exec.projectId as import("@t3tools/contracts").PipelineExecution["projectId"],
                    status: exec.status as import("@t3tools/contracts").PipelineExecution["status"],
                    stages: exec.stages.map((s) => ({
                      stageId: s.stageId as import("@t3tools/contracts").PipelineStageId,
                      status:
                        s.status as import("@t3tools/contracts").PipelineStageExecution["status"],
                      threadId: null,
                      startedAt: s.startedAt,
                      completedAt: s.completedAt,
                      error: s.error,
                      retryCount: 0,
                      output: null,
                    })),
                    startedAt: exec.startedAt,
                    completedAt: exec.completedAt,
                    updatedAt: exec.updatedAt,
                  })
                : Effect.die(new Error("Execution not found")),
            ),
          ),
          { "rpc.aggregate": "pipeline" },
        ),
      [WS_METHODS.pipelineCancel]: (input) =>
        observeRpcEffect(
          WS_METHODS.pipelineCancel,
          pipelineService.cancel({ executionId: input.executionId }),
          { "rpc.aggregate": "pipeline" },
        ),
      [WS_METHODS.subscribePipelineEvents]: (_input) =>
        observeRpcStream(
          WS_METHODS.subscribePipelineEvents,
          pipelineService.streamEvents.pipe(
            Stream.map((event) => ({
              type: "pipeline.execution.updated" as const,
              execution: {
                id: event.executionId as import("@t3tools/contracts").PipelineExecutionId,
                pipelineId: "" as import("@t3tools/contracts").PipelineExecution["pipelineId"],
                projectId: "" as import("@t3tools/contracts").PipelineExecution["projectId"],
                status: (event.type === "pipeline.completed"
                  ? "completed"
                  : event.type === "pipeline.failed"
                    ? "failed"
                    : "running") as import("@t3tools/contracts").PipelineExecution["status"],
                stages: [],
                startedAt: event.timestamp,
                completedAt: null,
                updatedAt: event.timestamp,
              },
            })),
          ),
          { "rpc.aggregate": "pipeline" },
        ),

      // ── Workflows ────────────────────────────────────────────────────────
      [WS_METHODS.workflowList]: (input) =>
        observeRpcEffect(
          WS_METHODS.workflowList,
          workflowService.list({ category: input.category }).pipe(
            Effect.map((templates) => ({
              templates: templates.map((t) => ({
                id: t.id as import("@t3tools/contracts").WorkflowTemplateId,
                name: t.name as import("@t3tools/contracts").WorkflowTemplate["name"],
                description: t.description,
                category: t.category as import("@t3tools/contracts").WorkflowTemplate["category"],
                variables: t.variables.map((v) => ({
                  name: v.name as import("@t3tools/contracts").WorkflowVariable["name"],
                  description: (v.description ??
                    null) as import("@t3tools/contracts").WorkflowVariable["description"],
                  defaultValue: (v.defaultValue ??
                    null) as import("@t3tools/contracts").WorkflowVariable["defaultValue"],
                  required: false,
                })),
                steps: t.steps.map((s) => ({
                  id: s.id as import("@t3tools/contracts").WorkflowStepId,
                  name: s.name as import("@t3tools/contracts").WorkflowStep["name"],
                  kind: "prompt" as const,
                  prompt: s.prompt,
                  command: null,
                  condition: null,
                  continueOnError: false,
                  timeoutMs: 120_000,
                  dependsOn: s.dependsOn as import("@t3tools/contracts").WorkflowStepId[],
                })),
                isBuiltIn: t.isBuiltIn,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
              })),
            })),
          ),
          { "rpc.aggregate": "workflow" },
        ),
      [WS_METHODS.workflowCreate]: (input) =>
        observeRpcEffect(
          WS_METHODS.workflowCreate,
          workflowService
            .create({
              id: crypto.randomUUID(),
              name: input.name,
              description: input.description,
              category: input.category,
              variables: input.variables.map((v) => ({
                name: v.name,
                description: v.description ?? "",
                defaultValue: v.defaultValue ?? null,
              })),
              steps: input.steps.map((s) => ({
                id: s.id,
                name: s.name,
                prompt: s.prompt ?? "",
                dependsOn: s.dependsOn as unknown as string[],
              })),
            })
            .pipe(
              Effect.map((t) => ({
                id: t.id as import("@t3tools/contracts").WorkflowTemplateId,
                name: t.name as import("@t3tools/contracts").WorkflowTemplate["name"],
                description: t.description,
                category: t.category as import("@t3tools/contracts").WorkflowTemplate["category"],
                variables: input.variables,
                steps: input.steps,
                isBuiltIn: false,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
              })),
            ),
          { "rpc.aggregate": "workflow" },
        ),
      [WS_METHODS.workflowDelete]: (input) =>
        observeRpcEffect(
          WS_METHODS.workflowDelete,
          workflowService.delete({ templateId: input.templateId }),
          { "rpc.aggregate": "workflow" },
        ),
      [WS_METHODS.workflowExecute]: (input) =>
        observeRpcEffect(
          WS_METHODS.workflowExecute,
          workflowService.execute({
            templateId: input.templateId,
            projectId: input.projectId,
            threadId: crypto.randomUUID(),
            variables: input.variables,
            executionId: crypto.randomUUID(),
            pipelineId: crypto.randomUUID(),
          }),
          { "rpc.aggregate": "workflow" },
        ),

      // ── Task Decomposition ───────────────────────────────────────────────
      [WS_METHODS.taskDecompose]: (input) =>
        observeRpcEffect(WS_METHODS.taskDecompose, taskDecomposition.decompose(input), {
          "rpc.aggregate": "task",
        }),
      [WS_METHODS.taskUpdateStatus]: (input) =>
        observeRpcEffect(WS_METHODS.taskUpdateStatus, taskDecomposition.updateStatus(input), {
          "rpc.aggregate": "task",
        }),
      [WS_METHODS.taskGetTree]: (input) =>
        observeRpcEffect(WS_METHODS.taskGetTree, taskDecomposition.getTree(input), {
          "rpc.aggregate": "task",
        }),
      [WS_METHODS.taskListTrees]: (input) =>
        observeRpcEffect(WS_METHODS.taskListTrees, taskDecomposition.listTrees(input), {
          "rpc.aggregate": "task",
        }),
      [WS_METHODS.taskExecute]: (input) =>
        observeRpcEffect(WS_METHODS.taskExecute, taskDecomposition.execute(input), {
          "rpc.aggregate": "task",
        }),
      [WS_METHODS.subscribeTaskEvents]: (_input) =>
        observeRpcStream(WS_METHODS.subscribeTaskEvents, taskDecomposition.streamEvents, {
          "rpc.aggregate": "task",
        }),

      // ── Memory ───────────────────────────────────────────────────────────
      [WS_METHODS.memoryIndex]: (input) =>
        observeRpcEffect(WS_METHODS.memoryIndex, projectMemory.index(input), {
          "rpc.aggregate": "memory",
        }),
      [WS_METHODS.memorySearch]: (input) =>
        observeRpcEffect(WS_METHODS.memorySearch, projectMemory.search(input), {
          "rpc.aggregate": "memory",
        }),
      [WS_METHODS.memoryAdd]: (input) =>
        observeRpcEffect(WS_METHODS.memoryAdd, projectMemory.add(input), {
          "rpc.aggregate": "memory",
        }),
      [WS_METHODS.memoryForget]: (input) =>
        observeRpcEffect(WS_METHODS.memoryForget, projectMemory.forget(input), {
          "rpc.aggregate": "memory",
        }),
      [WS_METHODS.memoryList]: (input) =>
        observeRpcEffect(WS_METHODS.memoryList, projectMemory.list(input), {
          "rpc.aggregate": "memory",
        }),

      // ── Presence ─────────────────────────────────────────────────────────
      [WS_METHODS.presenceJoin]: (input) =>
        observeRpcEffect(WS_METHODS.presenceJoin, presenceService.join(input), {
          "rpc.aggregate": "presence",
        }),
      [WS_METHODS.presenceLeave]: (input) =>
        observeRpcEffect(WS_METHODS.presenceLeave, presenceService.leave(input), {
          "rpc.aggregate": "presence",
        }),
      [WS_METHODS.presenceUpdateCursor]: (input) =>
        observeRpcEffect(WS_METHODS.presenceUpdateCursor, presenceService.updateCursor(input), {
          "rpc.aggregate": "presence",
        }),
      [WS_METHODS.presenceShare]: (input) =>
        observeRpcEffect(WS_METHODS.presenceShare, presenceService.share(input), {
          "rpc.aggregate": "presence",
        }),
      [WS_METHODS.presenceGetParticipants]: (input) =>
        observeRpcEffect(
          WS_METHODS.presenceGetParticipants,
          presenceService.getParticipants(input),
          {
            "rpc.aggregate": "presence",
          },
        ),
      [WS_METHODS.subscribePresenceEvents]: (_input) =>
        observeRpcStream(WS_METHODS.subscribePresenceEvents, presenceService.streamEvents, {
          "rpc.aggregate": "presence",
        }),
    });
  }),
);

export const websocketRpcRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const rpcWebSocketHttpEffect = yield* RpcServer.toHttpEffectWebsocket(WsRpcGroup, {
      spanPrefix: "ws.rpc",
      spanAttributes: {
        "rpc.transport": "websocket",
        "rpc.system": "effect-rpc",
      },
    }).pipe(Effect.provide(Layer.mergeAll(WsRpcLayer, RpcSerialization.layerJson)));
    return HttpRouter.add(
      "GET",
      "/ws",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const config = yield* ServerConfig;
        if (config.authToken) {
          const url = HttpServerRequest.toURL(request);
          if (Option.isNone(url)) {
            return HttpServerResponse.text("Invalid WebSocket URL", { status: 400 });
          }
          const token = url.value.searchParams.get("token");
          if (token !== config.authToken) {
            return HttpServerResponse.text("Unauthorized WebSocket connection", { status: 401 });
          }
        }
        return yield* rpcWebSocketHttpEffect;
      }),
    );
  }),
);
