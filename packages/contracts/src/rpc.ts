import { Schema } from "effect";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuditLogError, AuditQueryInput, AuditQueryResult, AuditStreamEvent } from "./auditLog";
import {
  CIGetStatusInput,
  CIGetStatusResult,
  CIIntegrationError,
  CISetFeedbackPolicyInput,
  CIFeedbackPolicy,
  CIStreamEvent,
  CITriggerRerunInput,
} from "./ciIntegration";
import {
  CostBudget,
  CostGetBudgetsInput,
  CostGetSummaryInput,
  CostSetBudgetInput,
  CostStreamEvent,
  CostSummary,
  CostTrackingError,
} from "./costTracking";
import { OpenError, OpenInEditorInput } from "./editor";
import {
  GitActionProgressEvent,
  GitCheckoutInput,
  GitCommandError,
  GitCreateBranchInput,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitManagerServiceError,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitRunStackedActionInput,
  GitStatusInput,
  GitStatusResult,
} from "./git";
import { KeybindingsConfigError } from "./keybindings";
import {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  OrchestrationGetFullThreadDiffError,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetSnapshotError,
  OrchestrationGetSnapshotInput,
  OrchestrationGetTurnDiffError,
  OrchestrationGetTurnDiffInput,
  OrchestrationReplayEventsError,
  OrchestrationReplayEventsInput,
  OrchestrationRpcSchemas,
} from "./orchestration";
import {
  ProjectSearchEntriesError,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileError,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalError,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";
import {
  MemoryAddInput,
  MemoryEntry,
  MemoryForgetInput,
  MemoryIndexInput,
  MemoryIndexResult,
  MemoryListInput,
  MemoryListResult,
  MemorySearchInput,
  MemorySearchOutput,
  ProjectMemoryError,
} from "./projectMemory";
import {
  PipelineCreateInput,
  PipelineDefinition,
  PipelineError,
  PipelineExecution,
  PipelineExecuteInput,
  PipelineGetExecutionInput,
  PipelineListInput,
  PipelineListResult,
  PipelineCancelInput,
  PipelineStreamEvent,
} from "./pipelines";
import {
  PresenceError,
  PresenceGetParticipantsInput,
  PresenceGetParticipantsResult,
  PresenceJoinInput,
  PresenceLeaveInput,
  PresenceShareInput,
  PresenceStreamEvent,
  PresenceUpdateCursorInput,
  SessionShare,
  Participant,
} from "./presence";
import {
  ProviderRoutingError,
  RoutingGetHealthInput,
  RoutingGetHealthResult,
  RoutingGetRulesResult,
  RoutingSetRulesInput,
  RoutingStreamEvent,
} from "./routing";
import {
  ServerConfigStreamEvent,
  ServerConfig,
  ServerLifecycleStreamEvent,
  ServerProviderUpdatedPayload,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import { ServerSettings, ServerSettingsError, ServerSettingsPatch } from "./settings";
import {
  TaskDecomposeInput,
  TaskDecompositionError,
  TaskExecuteInput,
  TaskGetTreeInput,
  TaskListTreesInput,
  TaskListTreesResult,
  TaskStreamEvent,
  TaskTree,
  TaskUpdateStatusInput,
} from "./taskDecomposition";
import {
  WorkflowCreateInput,
  WorkflowDeleteInput,
  WorkflowError,
  WorkflowExecuteInput,
  WorkflowListInput,
  WorkflowListResult,
  WorkflowTemplate,
} from "./workflows";

export const WS_METHODS = {
  // Project registry methods
  projectsList: "projects.list",
  projectsAdd: "projects.add",
  projectsRemove: "projects.remove",
  projectsSearchEntries: "projects.searchEntries",
  projectsWriteFile: "projects.writeFile",

  // Shell methods
  shellOpenInEditor: "shell.openInEditor",

  // Git methods
  gitPull: "git.pull",
  gitStatus: "git.status",
  gitRunStackedAction: "git.runStackedAction",
  gitListBranches: "git.listBranches",
  gitCreateWorktree: "git.createWorktree",
  gitRemoveWorktree: "git.removeWorktree",
  gitCreateBranch: "git.createBranch",
  gitCheckout: "git.checkout",
  gitInit: "git.init",
  gitResolvePullRequest: "git.resolvePullRequest",
  gitPreparePullRequestThread: "git.preparePullRequestThread",

  // Terminal methods
  terminalOpen: "terminal.open",
  terminalWrite: "terminal.write",
  terminalResize: "terminal.resize",
  terminalClear: "terminal.clear",
  terminalRestart: "terminal.restart",
  terminalClose: "terminal.close",

  // Server meta
  serverGetConfig: "server.getConfig",
  serverRefreshProviders: "server.refreshProviders",
  serverUpsertKeybinding: "server.upsertKeybinding",
  serverGetSettings: "server.getSettings",
  serverUpdateSettings: "server.updateSettings",

  // Cost tracking
  costGetSummary: "cost.getSummary",
  costSetBudget: "cost.setBudget",
  costGetBudgets: "cost.getBudgets",

  // Audit log
  auditQuery: "audit.query",

  // CI/CD integration
  ciGetStatus: "ci.getStatus",
  ciTriggerRerun: "ci.triggerRerun",
  ciSetFeedbackPolicy: "ci.setFeedbackPolicy",

  // Provider routing
  routingGetHealth: "routing.getHealth",
  routingSetRules: "routing.setRules",
  routingGetRules: "routing.getRules",

  // Pipelines
  pipelineCreate: "pipeline.create",
  pipelineList: "pipeline.list",
  pipelineExecute: "pipeline.execute",
  pipelineGetExecution: "pipeline.getExecution",
  pipelineCancel: "pipeline.cancel",

  // Workflows
  workflowList: "workflow.list",
  workflowCreate: "workflow.create",
  workflowDelete: "workflow.delete",
  workflowExecute: "workflow.execute",

  // Task decomposition
  taskDecompose: "task.decompose",
  taskUpdateStatus: "task.updateStatus",
  taskGetTree: "task.getTree",
  taskListTrees: "task.listTrees",
  taskExecute: "task.execute",

  // Project memory
  memoryIndex: "memory.index",
  memorySearch: "memory.search",
  memoryAdd: "memory.add",
  memoryForget: "memory.forget",
  memoryList: "memory.list",

  // Presence
  presenceJoin: "presence.join",
  presenceLeave: "presence.leave",
  presenceUpdateCursor: "presence.updateCursor",
  presenceShare: "presence.share",
  presenceGetParticipants: "presence.getParticipants",

  // Streaming subscriptions
  subscribeOrchestrationDomainEvents: "subscribeOrchestrationDomainEvents",
  subscribeTerminalEvents: "subscribeTerminalEvents",
  subscribeServerConfig: "subscribeServerConfig",
  subscribeServerLifecycle: "subscribeServerLifecycle",
  subscribeCostEvents: "subscribeCostEvents",
  subscribeAuditEvents: "subscribeAuditEvents",
  subscribeCIEvents: "subscribeCIEvents",
  subscribeRoutingEvents: "subscribeRoutingEvents",
  subscribePipelineEvents: "subscribePipelineEvents",
  subscribeTaskEvents: "subscribeTaskEvents",
  subscribePresenceEvents: "subscribePresenceEvents",
} as const;

export const WsServerUpsertKeybindingRpc = Rpc.make(WS_METHODS.serverUpsertKeybinding, {
  payload: ServerUpsertKeybindingInput,
  success: ServerUpsertKeybindingResult,
  error: KeybindingsConfigError,
});

export const WsServerGetConfigRpc = Rpc.make(WS_METHODS.serverGetConfig, {
  payload: Schema.Struct({}),
  success: ServerConfig,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
});

export const WsServerRefreshProvidersRpc = Rpc.make(WS_METHODS.serverRefreshProviders, {
  payload: Schema.Struct({}),
  success: ServerProviderUpdatedPayload,
});

export const WsServerGetSettingsRpc = Rpc.make(WS_METHODS.serverGetSettings, {
  payload: Schema.Struct({}),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsServerUpdateSettingsRpc = Rpc.make(WS_METHODS.serverUpdateSettings, {
  payload: Schema.Struct({ patch: ServerSettingsPatch }),
  success: ServerSettings,
  error: ServerSettingsError,
});

export const WsProjectsSearchEntriesRpc = Rpc.make(WS_METHODS.projectsSearchEntries, {
  payload: ProjectSearchEntriesInput,
  success: ProjectSearchEntriesResult,
  error: ProjectSearchEntriesError,
});

export const WsProjectsWriteFileRpc = Rpc.make(WS_METHODS.projectsWriteFile, {
  payload: ProjectWriteFileInput,
  success: ProjectWriteFileResult,
  error: ProjectWriteFileError,
});

export const WsShellOpenInEditorRpc = Rpc.make(WS_METHODS.shellOpenInEditor, {
  payload: OpenInEditorInput,
  error: OpenError,
});

export const WsGitStatusRpc = Rpc.make(WS_METHODS.gitStatus, {
  payload: GitStatusInput,
  success: GitStatusResult,
  error: GitManagerServiceError,
});

export const WsGitPullRpc = Rpc.make(WS_METHODS.gitPull, {
  payload: GitPullInput,
  success: GitPullResult,
  error: GitCommandError,
});

export const WsGitRunStackedActionRpc = Rpc.make(WS_METHODS.gitRunStackedAction, {
  payload: GitRunStackedActionInput,
  success: GitActionProgressEvent,
  error: GitManagerServiceError,
  stream: true,
});

export const WsGitResolvePullRequestRpc = Rpc.make(WS_METHODS.gitResolvePullRequest, {
  payload: GitPullRequestRefInput,
  success: GitResolvePullRequestResult,
  error: GitManagerServiceError,
});

export const WsGitPreparePullRequestThreadRpc = Rpc.make(WS_METHODS.gitPreparePullRequestThread, {
  payload: GitPreparePullRequestThreadInput,
  success: GitPreparePullRequestThreadResult,
  error: GitManagerServiceError,
});

export const WsGitListBranchesRpc = Rpc.make(WS_METHODS.gitListBranches, {
  payload: GitListBranchesInput,
  success: GitListBranchesResult,
  error: GitCommandError,
});

export const WsGitCreateWorktreeRpc = Rpc.make(WS_METHODS.gitCreateWorktree, {
  payload: GitCreateWorktreeInput,
  success: GitCreateWorktreeResult,
  error: GitCommandError,
});

export const WsGitRemoveWorktreeRpc = Rpc.make(WS_METHODS.gitRemoveWorktree, {
  payload: GitRemoveWorktreeInput,
  error: GitCommandError,
});

export const WsGitCreateBranchRpc = Rpc.make(WS_METHODS.gitCreateBranch, {
  payload: GitCreateBranchInput,
  error: GitCommandError,
});

export const WsGitCheckoutRpc = Rpc.make(WS_METHODS.gitCheckout, {
  payload: GitCheckoutInput,
  error: GitCommandError,
});

export const WsGitInitRpc = Rpc.make(WS_METHODS.gitInit, {
  payload: GitInitInput,
  error: GitCommandError,
});

export const WsTerminalOpenRpc = Rpc.make(WS_METHODS.terminalOpen, {
  payload: TerminalOpenInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalWriteRpc = Rpc.make(WS_METHODS.terminalWrite, {
  payload: TerminalWriteInput,
  error: TerminalError,
});

export const WsTerminalResizeRpc = Rpc.make(WS_METHODS.terminalResize, {
  payload: TerminalResizeInput,
  error: TerminalError,
});

export const WsTerminalClearRpc = Rpc.make(WS_METHODS.terminalClear, {
  payload: TerminalClearInput,
  error: TerminalError,
});

export const WsTerminalRestartRpc = Rpc.make(WS_METHODS.terminalRestart, {
  payload: TerminalRestartInput,
  success: TerminalSessionSnapshot,
  error: TerminalError,
});

export const WsTerminalCloseRpc = Rpc.make(WS_METHODS.terminalClose, {
  payload: TerminalCloseInput,
  error: TerminalError,
});

export const WsOrchestrationGetSnapshotRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getSnapshot, {
  payload: OrchestrationGetSnapshotInput,
  success: OrchestrationRpcSchemas.getSnapshot.output,
  error: OrchestrationGetSnapshotError,
});

export const WsOrchestrationDispatchCommandRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.dispatchCommand,
  {
    payload: ClientOrchestrationCommand,
    success: OrchestrationRpcSchemas.dispatchCommand.output,
    error: OrchestrationDispatchCommandError,
  },
);

export const WsOrchestrationGetTurnDiffRpc = Rpc.make(ORCHESTRATION_WS_METHODS.getTurnDiff, {
  payload: OrchestrationGetTurnDiffInput,
  success: OrchestrationRpcSchemas.getTurnDiff.output,
  error: OrchestrationGetTurnDiffError,
});

export const WsOrchestrationGetFullThreadDiffRpc = Rpc.make(
  ORCHESTRATION_WS_METHODS.getFullThreadDiff,
  {
    payload: OrchestrationGetFullThreadDiffInput,
    success: OrchestrationRpcSchemas.getFullThreadDiff.output,
    error: OrchestrationGetFullThreadDiffError,
  },
);

export const WsOrchestrationReplayEventsRpc = Rpc.make(ORCHESTRATION_WS_METHODS.replayEvents, {
  payload: OrchestrationReplayEventsInput,
  success: OrchestrationRpcSchemas.replayEvents.output,
  error: OrchestrationReplayEventsError,
});

export const WsSubscribeOrchestrationDomainEventsRpc = Rpc.make(
  WS_METHODS.subscribeOrchestrationDomainEvents,
  {
    payload: Schema.Struct({}),
    success: OrchestrationEvent,
    stream: true,
  },
);

export const WsSubscribeTerminalEventsRpc = Rpc.make(WS_METHODS.subscribeTerminalEvents, {
  payload: Schema.Struct({}),
  success: TerminalEvent,
  stream: true,
});

export const WsSubscribeServerConfigRpc = Rpc.make(WS_METHODS.subscribeServerConfig, {
  payload: Schema.Struct({}),
  success: ServerConfigStreamEvent,
  error: Schema.Union([KeybindingsConfigError, ServerSettingsError]),
  stream: true,
});

export const WsSubscribeServerLifecycleRpc = Rpc.make(WS_METHODS.subscribeServerLifecycle, {
  payload: Schema.Struct({}),
  success: ServerLifecycleStreamEvent,
  stream: true,
});

// --- Cost Tracking RPCs ---
export const WsCostGetSummaryRpc = Rpc.make(WS_METHODS.costGetSummary, {
  payload: CostGetSummaryInput,
  success: CostSummary,
  error: CostTrackingError,
});
export const WsCostSetBudgetRpc = Rpc.make(WS_METHODS.costSetBudget, {
  payload: CostSetBudgetInput,
  success: CostBudget,
  error: CostTrackingError,
});
export const WsCostGetBudgetsRpc = Rpc.make(WS_METHODS.costGetBudgets, {
  payload: CostGetBudgetsInput,
  success: Schema.Struct({ budgets: Schema.Array(CostBudget) }),
  error: CostTrackingError,
});
export const WsSubscribeCostEventsRpc = Rpc.make(WS_METHODS.subscribeCostEvents, {
  payload: Schema.Struct({}),
  success: CostStreamEvent,
  stream: true,
});

// --- Audit Log RPCs ---
export const WsAuditQueryRpc = Rpc.make(WS_METHODS.auditQuery, {
  payload: AuditQueryInput,
  success: AuditQueryResult,
  error: AuditLogError,
});
export const WsSubscribeAuditEventsRpc = Rpc.make(WS_METHODS.subscribeAuditEvents, {
  payload: Schema.Struct({}),
  success: AuditStreamEvent,
  stream: true,
});

// --- CI/CD RPCs ---
export const WsCIGetStatusRpc = Rpc.make(WS_METHODS.ciGetStatus, {
  payload: CIGetStatusInput,
  success: CIGetStatusResult,
  error: CIIntegrationError,
});
export const WsCITriggerRerunRpc = Rpc.make(WS_METHODS.ciTriggerRerun, {
  payload: CITriggerRerunInput,
  error: CIIntegrationError,
});
export const WsCISetFeedbackPolicyRpc = Rpc.make(WS_METHODS.ciSetFeedbackPolicy, {
  payload: CISetFeedbackPolicyInput,
  success: CIFeedbackPolicy,
  error: CIIntegrationError,
});
export const WsSubscribeCIEventsRpc = Rpc.make(WS_METHODS.subscribeCIEvents, {
  payload: Schema.Struct({}),
  success: CIStreamEvent,
  stream: true,
});

// --- Routing RPCs ---
export const WsRoutingGetHealthRpc = Rpc.make(WS_METHODS.routingGetHealth, {
  payload: RoutingGetHealthInput,
  success: RoutingGetHealthResult,
  error: ProviderRoutingError,
});
export const WsRoutingSetRulesRpc = Rpc.make(WS_METHODS.routingSetRules, {
  payload: RoutingSetRulesInput,
  success: RoutingGetRulesResult,
  error: ProviderRoutingError,
});
export const WsRoutingGetRulesRpc = Rpc.make(WS_METHODS.routingGetRules, {
  payload: Schema.Struct({}),
  success: RoutingGetRulesResult,
  error: ProviderRoutingError,
});
export const WsSubscribeRoutingEventsRpc = Rpc.make(WS_METHODS.subscribeRoutingEvents, {
  payload: Schema.Struct({}),
  success: RoutingStreamEvent,
  stream: true,
});

// --- Pipeline RPCs ---
export const WsPipelineCreateRpc = Rpc.make(WS_METHODS.pipelineCreate, {
  payload: PipelineCreateInput,
  success: PipelineDefinition,
  error: PipelineError,
});
export const WsPipelineListRpc = Rpc.make(WS_METHODS.pipelineList, {
  payload: PipelineListInput,
  success: PipelineListResult,
  error: PipelineError,
});
export const WsPipelineExecuteRpc = Rpc.make(WS_METHODS.pipelineExecute, {
  payload: PipelineExecuteInput,
  success: PipelineExecution,
  error: PipelineError,
});
export const WsPipelineGetExecutionRpc = Rpc.make(WS_METHODS.pipelineGetExecution, {
  payload: PipelineGetExecutionInput,
  success: PipelineExecution,
  error: PipelineError,
});
export const WsPipelineCancelRpc = Rpc.make(WS_METHODS.pipelineCancel, {
  payload: PipelineCancelInput,
  error: PipelineError,
});
export const WsSubscribePipelineEventsRpc = Rpc.make(WS_METHODS.subscribePipelineEvents, {
  payload: Schema.Struct({}),
  success: PipelineStreamEvent,
  stream: true,
});

// --- Workflow RPCs ---
export const WsWorkflowListRpc = Rpc.make(WS_METHODS.workflowList, {
  payload: WorkflowListInput,
  success: WorkflowListResult,
  error: WorkflowError,
});
export const WsWorkflowCreateRpc = Rpc.make(WS_METHODS.workflowCreate, {
  payload: WorkflowCreateInput,
  success: WorkflowTemplate,
  error: WorkflowError,
});
export const WsWorkflowDeleteRpc = Rpc.make(WS_METHODS.workflowDelete, {
  payload: WorkflowDeleteInput,
  error: WorkflowError,
});
export const WsWorkflowExecuteRpc = Rpc.make(WS_METHODS.workflowExecute, {
  payload: WorkflowExecuteInput,
  error: WorkflowError,
});

// --- Task Decomposition RPCs ---
export const WsTaskDecomposeRpc = Rpc.make(WS_METHODS.taskDecompose, {
  payload: TaskDecomposeInput,
  success: TaskTree,
  error: TaskDecompositionError,
});
export const WsTaskUpdateStatusRpc = Rpc.make(WS_METHODS.taskUpdateStatus, {
  payload: TaskUpdateStatusInput,
  success: TaskTree,
  error: TaskDecompositionError,
});
export const WsTaskGetTreeRpc = Rpc.make(WS_METHODS.taskGetTree, {
  payload: TaskGetTreeInput,
  success: TaskTree,
  error: TaskDecompositionError,
});
export const WsTaskListTreesRpc = Rpc.make(WS_METHODS.taskListTrees, {
  payload: TaskListTreesInput,
  success: TaskListTreesResult,
  error: TaskDecompositionError,
});
export const WsTaskExecuteRpc = Rpc.make(WS_METHODS.taskExecute, {
  payload: TaskExecuteInput,
  success: TaskTree,
  error: TaskDecompositionError,
});
export const WsSubscribeTaskEventsRpc = Rpc.make(WS_METHODS.subscribeTaskEvents, {
  payload: Schema.Struct({}),
  success: TaskStreamEvent,
  stream: true,
});

// --- Memory RPCs ---
export const WsMemoryIndexRpc = Rpc.make(WS_METHODS.memoryIndex, {
  payload: MemoryIndexInput,
  success: MemoryIndexResult,
  error: ProjectMemoryError,
});
export const WsMemorySearchRpc = Rpc.make(WS_METHODS.memorySearch, {
  payload: MemorySearchInput,
  success: MemorySearchOutput,
  error: ProjectMemoryError,
});
export const WsMemoryAddRpc = Rpc.make(WS_METHODS.memoryAdd, {
  payload: MemoryAddInput,
  success: MemoryEntry,
  error: ProjectMemoryError,
});
export const WsMemoryForgetRpc = Rpc.make(WS_METHODS.memoryForget, {
  payload: MemoryForgetInput,
  error: ProjectMemoryError,
});
export const WsMemoryListRpc = Rpc.make(WS_METHODS.memoryList, {
  payload: MemoryListInput,
  success: MemoryListResult,
  error: ProjectMemoryError,
});

// --- Presence RPCs ---
export const WsPresenceJoinRpc = Rpc.make(WS_METHODS.presenceJoin, {
  payload: PresenceJoinInput,
  success: Participant,
  error: PresenceError,
});
export const WsPresenceLeaveRpc = Rpc.make(WS_METHODS.presenceLeave, {
  payload: PresenceLeaveInput,
  error: PresenceError,
});
export const WsPresenceUpdateCursorRpc = Rpc.make(WS_METHODS.presenceUpdateCursor, {
  payload: PresenceUpdateCursorInput,
  error: PresenceError,
});
export const WsPresenceShareRpc = Rpc.make(WS_METHODS.presenceShare, {
  payload: PresenceShareInput,
  success: SessionShare,
  error: PresenceError,
});
export const WsPresenceGetParticipantsRpc = Rpc.make(WS_METHODS.presenceGetParticipants, {
  payload: PresenceGetParticipantsInput,
  success: PresenceGetParticipantsResult,
  error: PresenceError,
});
export const WsSubscribePresenceEventsRpc = Rpc.make(WS_METHODS.subscribePresenceEvents, {
  payload: Schema.Struct({}),
  success: PresenceStreamEvent,
  stream: true,
});

export const WsRpcGroup = RpcGroup.make(
  WsServerGetConfigRpc,
  WsServerRefreshProvidersRpc,
  WsServerUpsertKeybindingRpc,
  WsServerGetSettingsRpc,
  WsServerUpdateSettingsRpc,
  WsProjectsSearchEntriesRpc,
  WsProjectsWriteFileRpc,
  WsShellOpenInEditorRpc,
  WsGitStatusRpc,
  WsGitPullRpc,
  WsGitRunStackedActionRpc,
  WsGitResolvePullRequestRpc,
  WsGitPreparePullRequestThreadRpc,
  WsGitListBranchesRpc,
  WsGitCreateWorktreeRpc,
  WsGitRemoveWorktreeRpc,
  WsGitCreateBranchRpc,
  WsGitCheckoutRpc,
  WsGitInitRpc,
  WsTerminalOpenRpc,
  WsTerminalWriteRpc,
  WsTerminalResizeRpc,
  WsTerminalClearRpc,
  WsTerminalRestartRpc,
  WsTerminalCloseRpc,
  WsSubscribeOrchestrationDomainEventsRpc,
  WsSubscribeTerminalEventsRpc,
  WsSubscribeServerConfigRpc,
  WsSubscribeServerLifecycleRpc,
  WsOrchestrationGetSnapshotRpc,
  WsOrchestrationDispatchCommandRpc,
  WsOrchestrationGetTurnDiffRpc,
  WsOrchestrationGetFullThreadDiffRpc,
  WsOrchestrationReplayEventsRpc,
  // Cost tracking
  WsCostGetSummaryRpc,
  WsCostSetBudgetRpc,
  WsCostGetBudgetsRpc,
  WsSubscribeCostEventsRpc,
  // Audit log
  WsAuditQueryRpc,
  WsSubscribeAuditEventsRpc,
  // CI/CD
  WsCIGetStatusRpc,
  WsCITriggerRerunRpc,
  WsCISetFeedbackPolicyRpc,
  WsSubscribeCIEventsRpc,
  // Routing
  WsRoutingGetHealthRpc,
  WsRoutingSetRulesRpc,
  WsRoutingGetRulesRpc,
  WsSubscribeRoutingEventsRpc,
  // Pipelines
  WsPipelineCreateRpc,
  WsPipelineListRpc,
  WsPipelineExecuteRpc,
  WsPipelineGetExecutionRpc,
  WsPipelineCancelRpc,
  WsSubscribePipelineEventsRpc,
  // Workflows
  WsWorkflowListRpc,
  WsWorkflowCreateRpc,
  WsWorkflowDeleteRpc,
  WsWorkflowExecuteRpc,
  // Tasks
  WsTaskDecomposeRpc,
  WsTaskUpdateStatusRpc,
  WsTaskGetTreeRpc,
  WsTaskListTreesRpc,
  WsTaskExecuteRpc,
  WsSubscribeTaskEventsRpc,
  // Memory
  WsMemoryIndexRpc,
  WsMemorySearchRpc,
  WsMemoryAddRpc,
  WsMemoryForgetRpc,
  WsMemoryListRpc,
  // Presence
  WsPresenceJoinRpc,
  WsPresenceLeaveRpc,
  WsPresenceUpdateCursorRpc,
  WsPresenceShareRpc,
  WsPresenceGetParticipantsRpc,
  WsSubscribePresenceEventsRpc,
);
