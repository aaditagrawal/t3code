import type {
  ProviderApprovalDecision,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
} from "@t3tools/contracts";
import type { ApprovalRequestId, CanonicalRequestType, ThreadId, TurnId } from "@t3tools/contracts";

export const PROVIDER = "kilo" as const;
export const DEFAULT_HOSTNAME = "127.0.0.1";
// Kilo defaults to port 0 (OS-assigned), unlike OpenCode's 6733.
// We use 0 to always spawn a fresh server and parse the URL from stdout.
export const DEFAULT_PORT = 0;
export const SERVER_START_TIMEOUT_MS = 5000;
export const SERVER_PROBE_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// Provider / Session option types
// ---------------------------------------------------------------------------

export type KiloProviderOptions = {
  readonly serverUrl?: string;
  readonly binaryPath?: string;
  readonly hostname?: string;
  readonly port?: number;
  readonly workspace?: string;
  readonly username?: string;
  readonly password?: string;
};

export type KiloSessionStartInput = ProviderSessionStartInput & {
  readonly providerOptions?: ProviderSessionStartInput["providerOptions"] & {
    readonly kilo?: KiloProviderOptions;
  };
};

export type KiloSendTurnInput = ProviderSendTurnInput & {
  readonly modelOptions?: ProviderSendTurnInput["modelOptions"] & {
    readonly kilo?: {
      readonly providerId?: string;
      readonly modelId?: string;
      readonly variant?: string;
      readonly reasoningEffort?: string;
      readonly agent?: string;
    };
  };
};

// ---------------------------------------------------------------------------
// Runtime event types
// ---------------------------------------------------------------------------

export type KiloRuntimeRawSource =
  | "kilo.server.event"
  | "kilo.server.permission"
  | "kilo.server.question";

export type KiloProviderRuntimeEvent = Omit<ProviderRuntimeEvent, "provider" | "raw"> & {
  readonly provider: ProviderRuntimeEvent["provider"] | "kilo";
  readonly raw?: {
    readonly source: KiloRuntimeRawSource;
    readonly method?: string;
    readonly messageType?: string;
    readonly payload: unknown;
  };
};

export type KiloProviderSession = Omit<ProviderSession, "provider"> & {
  readonly provider: ProviderSession["provider"] | "kilo";
};

// ---------------------------------------------------------------------------
// Model discovery types
// ---------------------------------------------------------------------------

export type KiloModel = {
  readonly id: string;
  readonly name: string;
  readonly variants?: Readonly<Record<string, unknown>>;
};

export type KiloListedProvider = {
  readonly id: string;
  readonly name?: string;
  readonly models: Readonly<Record<string, KiloModel>>;
};

export type ProviderListResponse = {
  readonly all: ReadonlyArray<KiloListedProvider>;
  readonly connected: ReadonlyArray<string>;
};

export type KiloConfiguredProvider = {
  readonly id: string;
  readonly name?: string;
  readonly models: Readonly<Record<string, KiloModel>>;
};

export type ConfigProvidersResponse = {
  readonly providers: ReadonlyArray<KiloConfiguredProvider>;
};

export type KiloDiscoveredModel = {
  slug: string;
  name: string;
  variants?: ReadonlyArray<string>;
  connected?: boolean;
};

export type KiloModelDiscoveryOptions = KiloProviderOptions & {
  directory?: string;
};

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export type QuestionInfo = {
  readonly header: string;
  readonly question: string;
  readonly options: ReadonlyArray<{
    readonly label: string;
    readonly description: string;
  }>;
  readonly multiple?: boolean;
  readonly custom?: boolean;
};

export type KiloTodo = {
  readonly content: string;
  readonly status: "completed" | "in_progress" | string;
  readonly priority?: string;
};

export type KiloToolState =
  | {
      readonly status: "pending";
    }
  | {
      readonly status: "running";
      readonly title: string;
      readonly metadata?: Record<string, unknown>;
    }
  | {
      readonly status: "completed";
      readonly title: string;
      readonly output?: string;
      readonly metadata?: Record<string, unknown>;
    }
  | {
      readonly status: "error";
      readonly error: string;
      readonly metadata?: Record<string, unknown>;
    };

export type KiloToolPart = {
  readonly id: string;
  readonly sessionID: string;
  readonly messageID?: string;
  readonly type: "tool";
  readonly tool?: string;
  readonly state: KiloToolState;
};

export type KiloMessagePart =
  | {
      readonly id: string;
      readonly sessionID: string;
      readonly messageID?: string;
      readonly type: "text";
    }
  | {
      readonly id: string;
      readonly sessionID: string;
      readonly messageID?: string;
      readonly type: "reasoning";
    }
  | KiloToolPart;

// ---------------------------------------------------------------------------
// SSE event types
// ---------------------------------------------------------------------------

export type EventSessionStatus = {
  readonly type: "session.status";
  readonly properties: {
    readonly sessionID: string;
    readonly status: {
      readonly type: "busy" | "retry" | "idle" | string;
    };
  };
};

/**
 * Matches the SDK's `EventSessionError` type. The `error` union covers all
 * known error names from `@opencode-ai/sdk/v2`:
 *
 *  - ProviderAuthError:      { providerID, message }
 *  - UnknownError:           { message }
 *  - MessageAbortedError:    { message }
 *  - StructuredOutputError:  { message, retries }
 *  - ContextOverflowError:   { message, responseBody? }
 *  - APIError:               { message, statusCode?, isRetryable, ... }
 *  - MessageOutputLengthError: { [key: string]: unknown }
 */
export type EventSessionError = {
  readonly type: "session.error";
  readonly properties: {
    readonly sessionID?: string;
    readonly error?:
      | {
          readonly name: "ProviderAuthError";
          readonly data: {
            readonly providerID: string;
            readonly message: string;
          };
        }
      | {
          readonly name: "APIError";
          readonly data: {
            readonly message: string;
            readonly statusCode?: number;
            readonly isRetryable: boolean;
            readonly responseHeaders?: Record<string, string>;
            readonly responseBody?: string;
            readonly metadata?: Record<string, unknown>;
          };
        }
      | {
          readonly name: "ContextOverflowError";
          readonly data: {
            readonly message: string;
            readonly responseBody?: string;
          };
        }
      | {
          readonly name: "StructuredOutputError";
          readonly data: {
            readonly message: string;
            readonly retries: number;
          };
        }
      | {
          readonly name: "UnknownError" | "MessageAbortedError";
          readonly data: {
            readonly message: string;
          };
        }
      | {
          readonly name: "MessageOutputLengthError";
          readonly data?: Record<string, unknown>;
        }
      | {
          readonly name: string;
          readonly data?: {
            readonly message?: string;
          };
        };
  };
};

export type EventPermissionAsked = {
  readonly type: "permission.asked";
  readonly properties: {
    readonly id: string;
    readonly sessionID: string;
    readonly permission?: string;
    readonly title?: string;
    readonly pattern?: string;
    readonly metadata?: Record<string, unknown>;
    readonly tool?: string;
  };
};

export type EventPermissionReplied = {
  readonly type: "permission.replied";
  readonly properties: {
    readonly requestID: string;
    readonly sessionID: string;
    readonly reply: string;
  };
};

export type EventQuestionAsked = {
  readonly type: "question.asked";
  readonly properties: {
    readonly id: string;
    readonly sessionID: string;
    readonly questions: ReadonlyArray<QuestionInfo>;
  };
};

export type EventQuestionReplied = {
  readonly type: "question.replied";
  readonly properties: {
    readonly requestID: string;
    readonly sessionID: string;
    readonly answers: ReadonlyArray<ReadonlyArray<string>>;
  };
};

export type EventQuestionRejected = {
  readonly type: "question.rejected";
  readonly properties: {
    readonly requestID: string;
    readonly sessionID: string;
  };
};

export type EventMessagePartUpdated = {
  readonly type: "message.part.updated";
  readonly properties: {
    readonly part: KiloMessagePart;
  };
};

export type EventMessagePartDelta = {
  readonly type: "message.part.delta";
  readonly properties: {
    readonly sessionID: string;
    readonly partID: string;
    readonly delta: string;
  };
};

export type EventTodoUpdated = {
  readonly type: "todo.updated";
  readonly properties: {
    readonly sessionID: string;
    readonly todos: ReadonlyArray<KiloTodo>;
  };
};

export type EventSessionIdle = {
  readonly type: "session.idle";
  readonly properties: {
    readonly sessionID: string;
  };
};

export type KiloFileDiff = {
  readonly file: string;
  readonly before: string;
  readonly after: string;
  readonly additions: number;
  readonly deletions: number;
};

export type EventSessionDiff = {
  readonly type: "session.diff";
  readonly properties: {
    readonly sessionID: string;
    readonly diff: ReadonlyArray<KiloFileDiff>;
  };
};

export type EventSessionCompacted = {
  readonly type: "session.compacted";
  readonly properties: {
    readonly sessionID: string;
  };
};

export type EventSessionUpdated = {
  readonly type: "session.updated";
  readonly properties: {
    readonly sessionID: string;
    readonly info?: {
      readonly title?: string;
      readonly shareURL?: string;
      readonly [key: string]: unknown;
    };
  };
};

export type EventVcsBranchUpdated = {
  readonly type: "vcs.branch.updated";
  readonly properties: {
    readonly sessionID?: string;
    readonly branch: string;
  };
};

export type EventFileEdited = {
  readonly type: "file.edited";
  readonly properties: {
    readonly sessionID?: string;
    readonly filename: string;
    readonly fileId?: string;
  };
};

export type EventCommandExecuted = {
  readonly type: "command.executed";
  readonly properties: {
    readonly sessionID: string;
    readonly command: string;
    readonly args?: Record<string, unknown>;
  };
};

export type EventMessagePartRemoved = {
  readonly type: "message.part.removed";
  readonly properties: {
    readonly sessionID: string;
    readonly partID: string;
  };
};

export type KiloEvent =
  | EventSessionStatus
  | EventSessionError
  | EventSessionIdle
  | EventSessionDiff
  | EventSessionCompacted
  | EventSessionUpdated
  | EventPermissionAsked
  | EventPermissionReplied
  | EventQuestionAsked
  | EventQuestionReplied
  | EventQuestionRejected
  | EventMessagePartUpdated
  | EventMessagePartDelta
  | EventMessagePartRemoved
  | EventTodoUpdated
  | EventVcsBranchUpdated
  | EventFileEdited
  | EventCommandExecuted;

// ---------------------------------------------------------------------------
// SDK client types
// ---------------------------------------------------------------------------

export type KiloDataResponse<T> =
  | T
  | {
      readonly data: T;
      readonly error?: undefined;
    }
  | {
      readonly data?: undefined;
      readonly error: unknown;
    };

export type OpencodeClientConfig = {
  readonly baseUrl: string;
  readonly directory?: string;
  readonly responseStyle?: "data" | string;
  readonly throwOnError?: boolean;
  readonly headers?: Record<string, string>;
};

export type KiloClient = {
  readonly session: {
    readonly get: (input: {
      readonly sessionID: string;
      readonly workspace?: string;
    }) => Promise<unknown>;
    readonly create: (input: {
      readonly workspace?: string;
      readonly title: string;
    }) => Promise<unknown>;
    readonly promptAsync: (input: {
      readonly sessionID: string;
      readonly workspace?: string;
      readonly model?: {
        readonly providerID: string;
        readonly modelID: string;
      };
      readonly agent?: string;
      readonly variant?: string;
      readonly parts: ReadonlyArray<{
        readonly type: "text";
        readonly text: string;
      }>;
    }) => Promise<unknown>;
    readonly abort: (input: {
      readonly sessionID: string;
      readonly workspace?: string;
    }) => Promise<unknown>;
    readonly messages: (input: {
      readonly sessionID: string;
      readonly workspace?: string;
    }) => Promise<ReadonlyArray<unknown>>;
    readonly revert: (input: {
      readonly sessionID: string;
      readonly messageID: string;
      readonly workspace?: string;
    }) => Promise<unknown>;
    readonly unrevert: (input: {
      readonly sessionID: string;
      readonly workspace?: string;
    }) => Promise<unknown>;
  };
  readonly permission: {
    readonly reply: (input: {
      readonly requestID: string;
      readonly workspace?: string;
      readonly reply: "once" | "always" | "reject";
    }) => Promise<unknown>;
  };
  readonly question: {
    readonly reply: (input: {
      readonly requestID: string;
      readonly workspace?: string;
      readonly answers: ReadonlyArray<ReadonlyArray<string>>;
    }) => Promise<unknown>;
  };
  readonly provider: {
    readonly list: (input: {
      readonly workspace?: string;
    }) => Promise<KiloDataResponse<ProviderListResponse>>;
  };
  readonly config: {
    readonly providers: (input: {
      readonly workspace?: string;
    }) => Promise<KiloDataResponse<ConfigProvidersResponse>>;
  };
  readonly event: {
    readonly subscribe: (
      input: {
        readonly workspace?: string;
      },
      options: {
        readonly signal?: AbortSignal;
      },
    ) => Promise<{
      readonly stream: AsyncIterable<KiloEvent>;
    }>;
  };
};

export type KiloSdkModule = {
  createOpencodeClient(options: OpencodeClientOptions): KiloClient;
};

export type OpencodeClientOptions = OpencodeClientConfig & {
  directory?: string;
};

// ---------------------------------------------------------------------------
// Session context types
// ---------------------------------------------------------------------------

export interface PendingPermissionRequest {
  readonly requestId: ApprovalRequestId;
  readonly requestType: CanonicalRequestType;
}

export interface PendingQuestionRequest {
  readonly requestId: ApprovalRequestId;
  readonly questionIds: ReadonlyArray<string>;
  readonly questions: ReadonlyArray<{
    readonly answerIndex: number;
    readonly id: string;
    readonly header: string;
    readonly question: string;
    readonly options: ReadonlyArray<{
      readonly label: string;
      readonly description: string;
    }>;
  }>;
}

export interface PartStreamState {
  readonly kind: "text" | "reasoning" | "tool";
  readonly streamKind?: "assistant_text" | "reasoning_text";
}

export interface KiloSessionContext {
  readonly threadId: ThreadId;
  readonly directory: string;
  readonly workspace?: string;
  readonly client: KiloClient;
  readonly providerSessionId: string;
  readonly pendingPermissions: Map<string, PendingPermissionRequest>;
  readonly pendingQuestions: Map<string, PendingQuestionRequest>;
  readonly partStreamById: Map<string, PartStreamState>;
  readonly messageIds: string[];
  readonly streamAbortController: AbortController;
  streamTask: Promise<void>;
  session: KiloProviderSession;
  activeTurnId: TurnId | undefined;
  lastError: string | undefined;
}

export interface SharedServerState {
  readonly baseUrl: string;
  readonly authHeader?: string;
  readonly child?: {
    kill: () => boolean;
  };
}

export interface KiloManagerEvents {
  event: [ProviderRuntimeEvent];
}
