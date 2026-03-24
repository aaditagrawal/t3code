declare module "@anthropic-ai/claude-agent-sdk" {
  export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";

  export interface PermissionUpdate {
    readonly [key: string]: unknown;
  }

  export type PermissionResult =
    | {
        readonly behavior: "allow";
        readonly updatedInput?: unknown;
        readonly message?: string;
      }
    | {
        readonly behavior: "deny";
        readonly updatedInput?: unknown;
        readonly message?: string;
      };

  export interface CanUseToolCallbackOptions {
    readonly signal: AbortSignal;
    readonly toolUseID?: string;
    readonly suggestions?: ReadonlyArray<PermissionUpdate>;
    readonly [key: string]: unknown;
  }

  export type CanUseTool = (
    toolName: string,
    toolInput: Record<string, unknown>,
    callbackOptions: CanUseToolCallbackOptions,
  ) => Promise<PermissionResult>;

  export interface SDKUserMessage {
    readonly [key: string]: unknown;
  }

  export interface SDKResultMessage {
    readonly subtype?: string;
    readonly duration_ms?: number;
    readonly durationMs?: number;
    readonly is_error?: boolean;
    readonly isError?: boolean;
    readonly num_turns?: number;
    readonly total_cost_usd?: number;
    readonly stop_reason?: string | null;
    readonly errors?: ReadonlyArray<unknown>;
    readonly usage?: {
      readonly input_tokens?: number;
      readonly output_tokens?: number;
      readonly cache_creation_input_tokens?: number;
      readonly cache_read_input_tokens?: number;
      readonly server_tool_use?: {
        readonly web_search_requests?: number;
      };
    };
    readonly modelUsage?: { readonly [key: string]: unknown };
    readonly result?: string;
    readonly session_id?: string;
    readonly [key: string]: unknown;
  }

  export interface SDKMessage {
    readonly type?: string;
    readonly subtype?: string;
    readonly role?: string;
    readonly message?: {
      readonly id?: string;
      readonly content?: ReadonlyArray<unknown>;
      readonly [key: string]: unknown;
    };
    readonly content?: ReadonlyArray<Record<string, unknown>>;
    readonly uuid?: string;
    readonly session_id?: string;
    readonly parent_tool_use_id?: string;
    readonly tool_use_id?: string;
    readonly tool_name?: string;
    readonly input?: Record<string, unknown>;
    readonly result?: string;
    readonly error?: string;
    readonly errors?: ReadonlyArray<unknown>;
    readonly content_block?: Record<string, unknown>;
    readonly index?: number;
    readonly preceding_tool_use_ids?: ReadonlyArray<string>;
    readonly is_error?: boolean;
    readonly suggestions?: ReadonlyArray<PermissionUpdate>;

    // System message fields
    readonly status?: string;
    readonly hook_id?: string;
    readonly hook_name?: string;
    readonly hook_event?: string;
    readonly output?: string;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly outcome?: "error" | "cancelled" | "success";
    readonly exit_code?: number;

    // Task fields
    readonly task_id?: string;
    readonly description?: string;
    readonly task_type?: string;
    readonly summary?: string;
    readonly usage?: { readonly [key: string]: unknown };
    readonly last_tool_name?: string;

    // File persistence fields
    readonly files?: ReadonlyArray<{ readonly filename: string; readonly file_id: string }>;
    readonly failed?: ReadonlyArray<{ readonly filename: string; readonly error: string }>;

    // Tool progress fields
    readonly elapsed_time_seconds?: number;

    // Auth status fields
    readonly isAuthenticating?: boolean;

    // Stream event fields
    readonly event?: Record<string, unknown>;

    readonly [key: string]: unknown;
  }

  export type ThinkingConfig =
    | { readonly type: "adaptive" }
    | { readonly type: "enabled"; readonly budgetTokens?: number }
    | { readonly type: "disabled" };

  export type EffortLevel = "low" | "medium" | "high" | "max";

  export interface SpawnOptions {
    readonly args: string[];
    readonly env?: Record<string, string | undefined>;
    readonly cwd?: string;
    readonly [key: string]: unknown;
  }

  export interface SpawnedProcess {
    readonly stdin: NodeJS.WritableStream;
    readonly stdout: NodeJS.ReadableStream;
    killed: boolean;
    exitCode: number | null;
    kill(signal: NodeJS.Signals): boolean;
    on(event: "exit" | "error", listener: (...args: unknown[]) => void): void;
    once(event: "exit" | "error", listener: (...args: unknown[]) => void): void;
    off(event: "exit" | "error", listener: (...args: unknown[]) => void): void;
  }

  export type SettingSource = "user" | "project" | "local";

  export interface Options {
    readonly cwd?: string;
    readonly model?: string;
    readonly pathToClaudeCodeExecutable?: string;
    readonly permissionMode?: PermissionMode;
    readonly allowDangerouslySkipPermissions?: boolean;
    /** @deprecated Use `thinking` instead. */
    readonly maxThinkingTokens?: number;
    readonly thinking?: ThinkingConfig;
    readonly effort?: EffortLevel;
    readonly resume?: string;
    readonly resumeSessionAt?: string;
    readonly includePartialMessages?: boolean;
    readonly persistSession?: boolean;
    readonly sessionId?: string;
    readonly settings?: Record<string, unknown>;
    readonly settingSources?: SettingSource[];
    readonly spawnClaudeCodeProcess?: (options: SpawnOptions) => SpawnedProcess;
    readonly canUseTool?: CanUseTool;
    readonly env?: Record<string, string | undefined>;
    readonly additionalDirectories?: ReadonlyArray<string>;
    readonly stderr?: (message: string) => void;
  }

  export type Query = AsyncIterable<SDKMessage> & {
    readonly interrupt?: () => Promise<void>;
    readonly setModel?: (model?: string) => Promise<void>;
    readonly setPermissionMode?: (mode: PermissionMode) => Promise<void>;
    readonly setMaxThinkingTokens?: (maxThinkingTokens: number | null) => Promise<void>;
    readonly close?: () => void;
    readonly initializationResult?: () => Promise<Record<string, unknown>>;
  };

  export function query(input: {
    readonly prompt: string | AsyncIterable<SDKUserMessage>;
    readonly options?: Options;
  }): Query;
}
