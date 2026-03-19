/**
 * ProviderAdapter - Provider-specific runtime adapter contract.
 *
 * Defines the provider-native session/protocol operations that `ProviderService`
 * routes to after resolving the target provider. Implementations should focus
 * on provider behavior only and avoid cross-provider orchestration concerns.
 *
 * @module ProviderAdapter
 */
import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderKind,
  ProviderUserInputAnswers,
  ProviderRuntimeEvent,
  ProviderSendTurnInput,
  ProviderSession,
  ProviderSessionStartInput,
  ThreadId,
  ProviderTurnStartResult,
  TurnId,
} from "@t3tools/contracts";
import type { Effect } from "effect";
import type { Stream } from "effect";

export type ProviderSessionModelSwitchMode = "in-session" | "restart-session" | "unsupported";
export type ProviderTransport =
  | "app-server-json-rpc"
  | "sdk-cli-server"
  | "sdk-query"
  | "acp-stdio"
  | "http-sse"
  | "cli-headless-json"
  | "cli-persistent-json";
export type ProviderModelDiscovery =
  | "native"
  | "acp-or-config"
  | "config-or-static"
  | "session-native"
  | "unsupported";
export type ProviderHarnessOperation =
  | "startSession"
  | "sendTurn"
  | "interruptTurn"
  | "respondToRequest"
  | "respondToUserInput"
  | "readThread"
  | "rollbackThread"
  | "stopSession"
  | "streamEvents";

export const PROVIDER_HARNESS_OPERATIONS: ReadonlyArray<ProviderHarnessOperation> = [
  "startSession",
  "sendTurn",
  "interruptTurn",
  "respondToRequest",
  "respondToUserInput",
  "readThread",
  "rollbackThread",
  "stopSession",
  "streamEvents",
] as const;

export interface ProviderAdapterCapabilities {
  /**
   * Declares whether changing the model on an existing session is supported.
   */
  readonly sessionModelSwitch: ProviderSessionModelSwitchMode;
  /**
   * Declares the provider transport family used by the adapter.
   */
  readonly transport: ProviderTransport;
  /**
   * Describes how model discovery is sourced for this provider.
   */
  readonly modelDiscovery: ProviderModelDiscovery;
  /**
   * Quick boolean check for whether model discovery is available at all.
   */
  readonly supportsModelDiscovery: boolean;
  /**
   * Whether a stopped or missing runtime can be recovered from persisted resume
   * state.
   */
  readonly supportsResume: boolean;
  /**
   * Whether conversation rollback is supported by the underlying provider.
   */
  readonly supportsRollback: boolean;
  /**
   * Whether the adapter accepts chat attachments.
   */
  readonly supportsAttachments: boolean;
  /**
   * Whether the provider keeps a runtime/session alive across turns after
   * `startSession`.
   */
  readonly persistentRuntime: boolean;
}

export const PROVIDER_CAPABILITIES_BY_PROVIDER: Readonly<
  Record<ProviderKind, ProviderAdapterCapabilities>
> = {
  codex: {
    sessionModelSwitch: "in-session",
    transport: "app-server-json-rpc",
    modelDiscovery: "native",
    supportsModelDiscovery: true,
    supportsResume: true,
    supportsRollback: true,
    supportsAttachments: true,
    persistentRuntime: true,
  },
  copilot: {
    sessionModelSwitch: "in-session",
    transport: "sdk-cli-server",
    modelDiscovery: "native",
    supportsModelDiscovery: true,
    supportsResume: true,
    supportsRollback: false,
    supportsAttachments: true,
    persistentRuntime: true,
  },
  claudeCode: {
    sessionModelSwitch: "in-session",
    transport: "sdk-query",
    modelDiscovery: "session-native",
    supportsModelDiscovery: true,
    supportsResume: true,
    supportsRollback: false,
    supportsAttachments: true,
    persistentRuntime: true,
  },
  cursor: {
    sessionModelSwitch: "unsupported",
    transport: "acp-stdio",
    modelDiscovery: "acp-or-config",
    supportsModelDiscovery: true,
    supportsResume: true,
    supportsRollback: false,
    supportsAttachments: false,
    persistentRuntime: true,
  },
  opencode: {
    sessionModelSwitch: "in-session",
    transport: "http-sse",
    modelDiscovery: "native",
    supportsModelDiscovery: true,
    supportsResume: true,
    supportsRollback: true,
    supportsAttachments: false,
    persistentRuntime: true,
  },
  geminiCli: {
    sessionModelSwitch: "restart-session",
    transport: "cli-headless-json",
    modelDiscovery: "config-or-static",
    supportsModelDiscovery: true,
    supportsResume: true,
    supportsRollback: false,
    supportsAttachments: false,
    persistentRuntime: false,
  },
  amp: {
    sessionModelSwitch: "restart-session",
    transport: "cli-persistent-json",
    modelDiscovery: "config-or-static",
    supportsModelDiscovery: true,
    supportsResume: false,
    supportsRollback: false,
    supportsAttachments: false,
    persistentRuntime: true,
  },
  kilo: {
    sessionModelSwitch: "in-session",
    transport: "http-sse",
    modelDiscovery: "native",
    supportsModelDiscovery: true,
    supportsResume: true,
    supportsRollback: true,
    supportsAttachments: false,
    persistentRuntime: true,
  },
} as const;

export function getProviderCapabilities(provider: ProviderKind): ProviderAdapterCapabilities {
  return PROVIDER_CAPABILITIES_BY_PROVIDER[provider];
}

export function validateProviderAdapterConformance<TError>(
  adapter: ProviderAdapterShape<TError>,
): ReadonlyArray<string> {
  const issues: string[] = [];
  const expected = getProviderCapabilities(adapter.provider);

  for (const operation of PROVIDER_HARNESS_OPERATIONS) {
    if (operation === "streamEvents") {
      if (adapter.streamEvents === undefined || adapter.streamEvents === null) {
        issues.push(`missing operation '${operation}'`);
      }
      continue;
    }

    if (typeof adapter[operation] !== "function") {
      issues.push(`missing operation '${operation}'`);
    }
  }

  for (const [key, value] of Object.entries(expected) as Array<
    [
      keyof ProviderAdapterCapabilities,
      ProviderAdapterCapabilities[keyof ProviderAdapterCapabilities],
    ]
  >) {
    if (adapter.capabilities[key] !== value) {
      issues.push(
        `capability mismatch for '${String(key)}': expected '${String(value)}', received '${String(
          adapter.capabilities[key],
        )}'`,
      );
    }
  }

  return issues;
}

export interface ProviderThreadTurnSnapshot {
  readonly id: TurnId;
  readonly items: ReadonlyArray<unknown>;
}

export interface ProviderThreadSnapshot {
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<ProviderThreadTurnSnapshot>;
}

export interface ProviderAdapterShape<TError> {
  /**
   * Provider kind implemented by this adapter.
   */
  readonly provider: ProviderKind;
  readonly capabilities: ProviderAdapterCapabilities;

  /**
   * Start a provider-backed session.
   */
  readonly startSession: (
    input: ProviderSessionStartInput,
  ) => Effect.Effect<ProviderSession, TError>;

  /**
   * Send a turn to an active provider session.
   */
  readonly sendTurn: (
    input: ProviderSendTurnInput,
  ) => Effect.Effect<ProviderTurnStartResult, TError>;

  /**
   * Interrupt an active turn.
   */
  readonly interruptTurn: (threadId: ThreadId, turnId?: TurnId) => Effect.Effect<void, TError>;

  /**
   * Respond to an interactive approval request.
   */
  readonly respondToRequest: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Effect.Effect<void, TError>;

  /**
   * Respond to a structured user-input request.
   */
  readonly respondToUserInput: (
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers,
  ) => Effect.Effect<void, TError>;

  /**
   * Stop one provider session.
   */
  readonly stopSession: (threadId: ThreadId) => Effect.Effect<void, TError>;

  /**
   * List currently active provider sessions for this adapter.
   */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<ProviderSession>>;

  /**
   * Check whether this adapter owns an active session id.
   */
  readonly hasSession: (threadId: ThreadId) => Effect.Effect<boolean>;

  /**
   * Read a provider thread snapshot.
   */
  readonly readThread: (threadId: ThreadId) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Roll back a provider thread by N turns.
   */
  readonly rollbackThread: (
    threadId: ThreadId,
    numTurns: number,
  ) => Effect.Effect<ProviderThreadSnapshot, TError>;

  /**
   * Stop all sessions owned by this adapter.
   */
  readonly stopAll: () => Effect.Effect<void, TError>;

  /**
   * Canonical runtime event stream emitted by this adapter.
   */
  readonly streamEvents: Stream.Stream<ProviderRuntimeEvent>;
}
