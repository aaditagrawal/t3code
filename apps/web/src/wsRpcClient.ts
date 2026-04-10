import {
  type GitActionProgressEvent,
  type GitRunStackedActionInput,
  type GitRunStackedActionResult,
  type NativeApi,
  ORCHESTRATION_WS_METHODS,
  type ServerSettingsPatch,
  WS_METHODS,
} from "@t3tools/contracts";
import { Effect, Stream } from "effect";

import { type WsRpcProtocolClient } from "./rpc/protocol";
import { resetWsReconnectBackoff } from "./rpc/wsConnectionState";
import { WsTransport } from "./wsTransport";

type RpcTag = keyof WsRpcProtocolClient & string;
type RpcMethod<TTag extends RpcTag> = WsRpcProtocolClient[TTag];
type RpcInput<TTag extends RpcTag> = Parameters<RpcMethod<TTag>>[0];

interface StreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

type RpcUnaryMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? (input: RpcInput<TTag>) => Promise<TSuccess>
    : never;

type RpcUnaryNoArgMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Effect.Effect<infer TSuccess, any, any>
    ? () => Promise<TSuccess>
    : never;

type RpcStreamMethod<TTag extends RpcTag> =
  RpcMethod<TTag> extends (input: any, options?: any) => Stream.Stream<infer TEvent, any, any>
    ? (listener: (event: TEvent) => void, options?: StreamSubscriptionOptions) => () => void
    : never;

interface GitRunStackedActionOptions {
  readonly onProgress?: (event: GitActionProgressEvent) => void;
}

export interface WsRpcClient {
  readonly dispose: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly terminal: {
    readonly open: RpcUnaryMethod<typeof WS_METHODS.terminalOpen>;
    readonly write: RpcUnaryMethod<typeof WS_METHODS.terminalWrite>;
    readonly resize: RpcUnaryMethod<typeof WS_METHODS.terminalResize>;
    readonly clear: RpcUnaryMethod<typeof WS_METHODS.terminalClear>;
    readonly restart: RpcUnaryMethod<typeof WS_METHODS.terminalRestart>;
    readonly close: RpcUnaryMethod<typeof WS_METHODS.terminalClose>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTerminalEvents>;
  };
  readonly projects: {
    readonly searchEntries: RpcUnaryMethod<typeof WS_METHODS.projectsSearchEntries>;
    readonly writeFile: RpcUnaryMethod<typeof WS_METHODS.projectsWriteFile>;
  };
  readonly shell: {
    readonly openInEditor: (input: {
      readonly cwd: Parameters<NativeApi["shell"]["openInEditor"]>[0];
      readonly editor: Parameters<NativeApi["shell"]["openInEditor"]>[1];
    }) => ReturnType<NativeApi["shell"]["openInEditor"]>;
  };
  readonly git: {
    readonly pull: RpcUnaryMethod<typeof WS_METHODS.gitPull>;
    readonly status: RpcUnaryMethod<typeof WS_METHODS.gitStatus>;
    readonly runStackedAction: (
      input: GitRunStackedActionInput,
      options?: GitRunStackedActionOptions,
    ) => Promise<GitRunStackedActionResult>;
    readonly listBranches: RpcUnaryMethod<typeof WS_METHODS.gitListBranches>;
    readonly createWorktree: RpcUnaryMethod<typeof WS_METHODS.gitCreateWorktree>;
    readonly removeWorktree: RpcUnaryMethod<typeof WS_METHODS.gitRemoveWorktree>;
    readonly createBranch: RpcUnaryMethod<typeof WS_METHODS.gitCreateBranch>;
    readonly checkout: RpcUnaryMethod<typeof WS_METHODS.gitCheckout>;
    readonly init: RpcUnaryMethod<typeof WS_METHODS.gitInit>;
    readonly resolvePullRequest: RpcUnaryMethod<typeof WS_METHODS.gitResolvePullRequest>;
    readonly preparePullRequestThread: RpcUnaryMethod<
      typeof WS_METHODS.gitPreparePullRequestThread
    >;
  };
  readonly server: {
    readonly getConfig: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetConfig>;
    readonly refreshProviders: RpcUnaryNoArgMethod<typeof WS_METHODS.serverRefreshProviders>;
    readonly upsertKeybinding: RpcUnaryMethod<typeof WS_METHODS.serverUpsertKeybinding>;
    readonly getSettings: RpcUnaryNoArgMethod<typeof WS_METHODS.serverGetSettings>;
    readonly updateSettings: (
      patch: ServerSettingsPatch,
    ) => ReturnType<RpcUnaryMethod<typeof WS_METHODS.serverUpdateSettings>>;
    readonly subscribeConfig: RpcStreamMethod<typeof WS_METHODS.subscribeServerConfig>;
    readonly subscribeLifecycle: RpcStreamMethod<typeof WS_METHODS.subscribeServerLifecycle>;
  };
  readonly orchestration: {
    readonly getSnapshot: RpcUnaryNoArgMethod<typeof ORCHESTRATION_WS_METHODS.getSnapshot>;
    readonly dispatchCommand: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.dispatchCommand>;
    readonly getTurnDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getTurnDiff>;
    readonly getFullThreadDiff: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.getFullThreadDiff>;
    readonly replayEvents: RpcUnaryMethod<typeof ORCHESTRATION_WS_METHODS.replayEvents>;
    readonly onDomainEvent: RpcStreamMethod<typeof WS_METHODS.subscribeOrchestrationDomainEvents>;
  };
  readonly cost: {
    readonly getSummary: RpcUnaryMethod<typeof WS_METHODS.costGetSummary>;
    readonly setBudget: RpcUnaryMethod<typeof WS_METHODS.costSetBudget>;
    readonly getBudgets: RpcUnaryMethod<typeof WS_METHODS.costGetBudgets>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeCostEvents>;
  };
  readonly audit: {
    readonly query: RpcUnaryMethod<typeof WS_METHODS.auditQuery>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeAuditEvents>;
  };
  readonly ci: {
    readonly getStatus: RpcUnaryMethod<typeof WS_METHODS.ciGetStatus>;
    readonly triggerRerun: RpcUnaryMethod<typeof WS_METHODS.ciTriggerRerun>;
    readonly setFeedbackPolicy: RpcUnaryMethod<typeof WS_METHODS.ciSetFeedbackPolicy>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeCIEvents>;
  };
  readonly routing: {
    readonly getHealth: RpcUnaryNoArgMethod<typeof WS_METHODS.routingGetHealth>;
    readonly setRules: RpcUnaryMethod<typeof WS_METHODS.routingSetRules>;
    readonly getRules: RpcUnaryNoArgMethod<typeof WS_METHODS.routingGetRules>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeRoutingEvents>;
  };
  readonly pipeline: {
    readonly create: RpcUnaryMethod<typeof WS_METHODS.pipelineCreate>;
    readonly list: RpcUnaryMethod<typeof WS_METHODS.pipelineList>;
    readonly execute: RpcUnaryMethod<typeof WS_METHODS.pipelineExecute>;
    readonly getExecution: RpcUnaryMethod<typeof WS_METHODS.pipelineGetExecution>;
    readonly cancel: RpcUnaryMethod<typeof WS_METHODS.pipelineCancel>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribePipelineEvents>;
  };
  readonly workflow: {
    readonly list: RpcUnaryMethod<typeof WS_METHODS.workflowList>;
    readonly create: RpcUnaryMethod<typeof WS_METHODS.workflowCreate>;
    readonly delete: RpcUnaryMethod<typeof WS_METHODS.workflowDelete>;
    readonly execute: RpcUnaryMethod<typeof WS_METHODS.workflowExecute>;
  };
  readonly task: {
    readonly decompose: RpcUnaryMethod<typeof WS_METHODS.taskDecompose>;
    readonly updateStatus: RpcUnaryMethod<typeof WS_METHODS.taskUpdateStatus>;
    readonly getTree: RpcUnaryMethod<typeof WS_METHODS.taskGetTree>;
    readonly listTrees: RpcUnaryMethod<typeof WS_METHODS.taskListTrees>;
    readonly execute: RpcUnaryMethod<typeof WS_METHODS.taskExecute>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribeTaskEvents>;
  };
  readonly memory: {
    readonly index: RpcUnaryMethod<typeof WS_METHODS.memoryIndex>;
    readonly search: RpcUnaryMethod<typeof WS_METHODS.memorySearch>;
    readonly add: RpcUnaryMethod<typeof WS_METHODS.memoryAdd>;
    readonly forget: RpcUnaryMethod<typeof WS_METHODS.memoryForget>;
    readonly list: RpcUnaryMethod<typeof WS_METHODS.memoryList>;
  };
  readonly presence: {
    readonly join: RpcUnaryMethod<typeof WS_METHODS.presenceJoin>;
    readonly leave: RpcUnaryMethod<typeof WS_METHODS.presenceLeave>;
    readonly updateCursor: RpcUnaryMethod<typeof WS_METHODS.presenceUpdateCursor>;
    readonly share: RpcUnaryMethod<typeof WS_METHODS.presenceShare>;
    readonly getParticipants: RpcUnaryMethod<typeof WS_METHODS.presenceGetParticipants>;
    readonly onEvent: RpcStreamMethod<typeof WS_METHODS.subscribePresenceEvents>;
  };
}

let sharedWsRpcClient: WsRpcClient | null = null;

export function getWsRpcClient(): WsRpcClient {
  if (sharedWsRpcClient) {
    return sharedWsRpcClient;
  }
  sharedWsRpcClient = createWsRpcClient();
  return sharedWsRpcClient;
}

export async function __resetWsRpcClientForTests() {
  await sharedWsRpcClient?.dispose();
  sharedWsRpcClient = null;
}

export function createWsRpcClient(transport = new WsTransport()): WsRpcClient {
  return {
    dispose: () => transport.dispose(),
    reconnect: async () => {
      resetWsReconnectBackoff();
      await transport.reconnect();
    },
    terminal: {
      open: (input) => transport.request((client) => client[WS_METHODS.terminalOpen](input)),
      write: (input) => transport.request((client) => client[WS_METHODS.terminalWrite](input)),
      resize: (input) => transport.request((client) => client[WS_METHODS.terminalResize](input)),
      clear: (input) => transport.request((client) => client[WS_METHODS.terminalClear](input)),
      restart: (input) => transport.request((client) => client[WS_METHODS.terminalRestart](input)),
      close: (input) => transport.request((client) => client[WS_METHODS.terminalClose](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTerminalEvents]({}),
          listener,
          options,
        ),
    },
    projects: {
      searchEntries: (input) =>
        transport.request((client) => client[WS_METHODS.projectsSearchEntries](input)),
      writeFile: (input) =>
        transport.request((client) => client[WS_METHODS.projectsWriteFile](input)),
    },
    shell: {
      openInEditor: (input) =>
        transport.request((client) => client[WS_METHODS.shellOpenInEditor](input)),
    },
    git: {
      pull: (input) => transport.request((client) => client[WS_METHODS.gitPull](input)),
      status: (input) => transport.request((client) => client[WS_METHODS.gitStatus](input)),
      runStackedAction: async (input, options) => {
        let result: GitRunStackedActionResult | null = null;

        await transport.requestStream(
          (client) => client[WS_METHODS.gitRunStackedAction](input),
          (event) => {
            options?.onProgress?.(event);
            if (event.kind === "action_finished") {
              result = event.result;
            }
          },
        );

        if (result) {
          return result;
        }

        throw new Error("Git action stream completed without a final result.");
      },
      listBranches: (input) =>
        transport.request((client) => client[WS_METHODS.gitListBranches](input)),
      createWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateWorktree](input)),
      removeWorktree: (input) =>
        transport.request((client) => client[WS_METHODS.gitRemoveWorktree](input)),
      createBranch: (input) =>
        transport.request((client) => client[WS_METHODS.gitCreateBranch](input)),
      checkout: (input) => transport.request((client) => client[WS_METHODS.gitCheckout](input)),
      init: (input) => transport.request((client) => client[WS_METHODS.gitInit](input)),
      resolvePullRequest: (input) =>
        transport.request((client) => client[WS_METHODS.gitResolvePullRequest](input)),
      preparePullRequestThread: (input) =>
        transport.request((client) => client[WS_METHODS.gitPreparePullRequestThread](input)),
    },
    server: {
      getConfig: () => transport.request((client) => client[WS_METHODS.serverGetConfig]({})),
      refreshProviders: () =>
        transport.request((client) => client[WS_METHODS.serverRefreshProviders]({})),
      upsertKeybinding: (input) =>
        transport.request((client) => client[WS_METHODS.serverUpsertKeybinding](input)),
      getSettings: () => transport.request((client) => client[WS_METHODS.serverGetSettings]({})),
      updateSettings: (patch) =>
        transport.request((client) => client[WS_METHODS.serverUpdateSettings]({ patch })),
      subscribeConfig: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerConfig]({}),
          listener,
          options,
        ),
      subscribeLifecycle: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeServerLifecycle]({}),
          listener,
          options,
        ),
    },
    orchestration: {
      getSnapshot: () =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getSnapshot]({})),
      dispatchCommand: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.dispatchCommand](input)),
      getTurnDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getTurnDiff](input)),
      getFullThreadDiff: (input) =>
        transport.request((client) => client[ORCHESTRATION_WS_METHODS.getFullThreadDiff](input)),
      replayEvents: (input) =>
        transport
          .request((client) => client[ORCHESTRATION_WS_METHODS.replayEvents](input))
          .then((events) => [...events]),
      onDomainEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeOrchestrationDomainEvents]({}),
          listener,
          options,
        ),
    },
    cost: {
      getSummary: (input) =>
        transport.request((client) => client[WS_METHODS.costGetSummary](input)),
      setBudget: (input) => transport.request((client) => client[WS_METHODS.costSetBudget](input)),
      getBudgets: (input) =>
        transport.request((client) => client[WS_METHODS.costGetBudgets](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeCostEvents]({}),
          listener,
          options,
        ),
    },
    audit: {
      query: (input) => transport.request((client) => client[WS_METHODS.auditQuery](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeAuditEvents]({}),
          listener,
          options,
        ),
    },
    ci: {
      getStatus: (input) => transport.request((client) => client[WS_METHODS.ciGetStatus](input)),
      triggerRerun: (input) =>
        transport.request((client) => client[WS_METHODS.ciTriggerRerun](input)),
      setFeedbackPolicy: (input) =>
        transport.request((client) => client[WS_METHODS.ciSetFeedbackPolicy](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeCIEvents]({}),
          listener,
          options,
        ),
    },
    routing: {
      getHealth: () => transport.request((client) => client[WS_METHODS.routingGetHealth]({})),
      setRules: (input) => transport.request((client) => client[WS_METHODS.routingSetRules](input)),
      getRules: () => transport.request((client) => client[WS_METHODS.routingGetRules]({})),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeRoutingEvents]({}),
          listener,
          options,
        ),
    },
    pipeline: {
      create: (input) => transport.request((client) => client[WS_METHODS.pipelineCreate](input)),
      list: (input) => transport.request((client) => client[WS_METHODS.pipelineList](input)),
      execute: (input) => transport.request((client) => client[WS_METHODS.pipelineExecute](input)),
      getExecution: (input) =>
        transport.request((client) => client[WS_METHODS.pipelineGetExecution](input)),
      cancel: (input) => transport.request((client) => client[WS_METHODS.pipelineCancel](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribePipelineEvents]({}),
          listener,
          options,
        ),
    },
    workflow: {
      list: (input) => transport.request((client) => client[WS_METHODS.workflowList](input)),
      create: (input) => transport.request((client) => client[WS_METHODS.workflowCreate](input)),
      delete: (input) => transport.request((client) => client[WS_METHODS.workflowDelete](input)),
      execute: (input) => transport.request((client) => client[WS_METHODS.workflowExecute](input)),
    },
    task: {
      decompose: (input) => transport.request((client) => client[WS_METHODS.taskDecompose](input)),
      updateStatus: (input) =>
        transport.request((client) => client[WS_METHODS.taskUpdateStatus](input)),
      getTree: (input) => transport.request((client) => client[WS_METHODS.taskGetTree](input)),
      listTrees: (input) => transport.request((client) => client[WS_METHODS.taskListTrees](input)),
      execute: (input) => transport.request((client) => client[WS_METHODS.taskExecute](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribeTaskEvents]({}),
          listener,
          options,
        ),
    },
    memory: {
      index: (input) => transport.request((client) => client[WS_METHODS.memoryIndex](input)),
      search: (input) => transport.request((client) => client[WS_METHODS.memorySearch](input)),
      add: (input) => transport.request((client) => client[WS_METHODS.memoryAdd](input)),
      forget: (input) => transport.request((client) => client[WS_METHODS.memoryForget](input)),
      list: (input) => transport.request((client) => client[WS_METHODS.memoryList](input)),
    },
    presence: {
      join: (input) => transport.request((client) => client[WS_METHODS.presenceJoin](input)),
      leave: (input) => transport.request((client) => client[WS_METHODS.presenceLeave](input)),
      updateCursor: (input) =>
        transport.request((client) => client[WS_METHODS.presenceUpdateCursor](input)),
      share: (input) => transport.request((client) => client[WS_METHODS.presenceShare](input)),
      getParticipants: (input) =>
        transport.request((client) => client[WS_METHODS.presenceGetParticipants](input)),
      onEvent: (listener, options) =>
        transport.subscribe(
          (client) => client[WS_METHODS.subscribePresenceEvents]({}),
          listener,
          options,
        ),
    },
  };
}
