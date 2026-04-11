import { randomUUID } from "node:crypto";

import {
  EventId,
  TurnId,
  type CanonicalRequestType,
  type ProviderApprovalDecision,
} from "@t3tools/contracts";

import type {
  ConfigProvidersResponse,
  KiloConfiguredProvider,
  KiloDiscoveredModel,
  KiloFileDiff,
  KiloListedProvider,
  KiloModel,
  KiloProviderSession,
  KiloTodo,
  KiloToolState,
  ProviderListResponse,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function eventId(prefix: string): EventId {
  return EventId.make(`${prefix}:${randomUUID()}`);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createTurnId(): TurnId {
  return TurnId.make(`turn:${randomUUID()}`);
}

export function textPart(text: string) {
  return {
    type: "text" as const,
    text,
  };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function buildAuthHeader(username?: string, password?: string): string | undefined {
  if (!password) {
    return undefined;
  }
  const resolvedUsername = username && username.length > 0 ? username : "kilo";
  return `Basic ${Buffer.from(`${resolvedUsername}:${password}`).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Session / resume helpers
// ---------------------------------------------------------------------------

export function readResumeSessionId(resumeCursor: unknown): string | undefined {
  const record = asRecord(resumeCursor);
  return asString(record?.sessionId);
}

export function stripTransientSessionFields(session: KiloProviderSession) {
  const { activeTurnId: _activeTurnId, lastError: _lastError, ...rest } = session;
  return rest;
}

// ---------------------------------------------------------------------------
// Model parsing
// ---------------------------------------------------------------------------

export function parseKiloModel(model: string | undefined):
  | {
      providerId: string;
      modelId: string;
      variant?: string;
    }
  | undefined {
  const value = asString(model);
  if (!value) {
    return undefined;
  }
  const index = value.indexOf("/");
  if (index < 1 || index >= value.length - 1) {
    return undefined;
  }
  const providerId = value.slice(0, index);
  const modelAndVariant = value.slice(index + 1);
  const variantIndex = modelAndVariant.lastIndexOf("#");
  const modelId = variantIndex >= 1 ? modelAndVariant.slice(0, variantIndex) : modelAndVariant;
  const variant =
    variantIndex >= 1 && variantIndex < modelAndVariant.length - 1
      ? modelAndVariant.slice(variantIndex + 1)
      : undefined;
  return {
    providerId,
    modelId,
    ...(variant ? { variant } : {}),
  };
}

const PREFERRED_VARIANT_ORDER = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

function compareKiloVariantNames(left: string, right: string): number {
  const leftIndex = PREFERRED_VARIANT_ORDER.indexOf(
    left as (typeof PREFERRED_VARIANT_ORDER)[number],
  );
  const rightIndex = PREFERRED_VARIANT_ORDER.indexOf(
    right as (typeof PREFERRED_VARIANT_ORDER)[number],
  );
  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
  }
  return left.localeCompare(right);
}

function modelOptionsFromProvider(
  providerId: string,
  providerName: string,
  model: KiloModel,
  connected?: boolean,
): ReadonlyArray<KiloDiscoveredModel> {
  const variantNames = Object.keys(model.variants ?? {})
    .filter((variant) => variant.length > 0)
    .toSorted(compareKiloVariantNames);
  return [
    {
      slug: `${providerId}/${model.id}`,
      name: `${providerName} / ${model.name}`,
      ...(variantNames.length > 0 ? { variants: variantNames } : {}),
      ...(connected != null ? { connected } : {}),
    },
  ];
}

export function parseProviderModels(
  providers: ReadonlyArray<
    Pick<KiloListedProvider, "id" | "name" | "models"> | KiloConfiguredProvider
  >,
  connectedIds?: ReadonlySet<string>,
): ReadonlyArray<KiloDiscoveredModel> {
  const sorted = providers.toSorted((a, b) => {
    const nameA = a.name || a.id;
    const nameB = b.name || b.id;
    return nameA.localeCompare(nameB);
  });
  return sorted.flatMap((provider) => {
    const providerName = provider.name || provider.id;
    const isConnected = connectedIds ? connectedIds.has(provider.id) : undefined;
    return Object.values(provider.models).flatMap((model) =>
      modelOptionsFromProvider(provider.id, providerName, model, isConnected),
    );
  });
}

// ---------------------------------------------------------------------------
// Permission / request type mapping
// ---------------------------------------------------------------------------

export function toKiloRequestType(permission: string | undefined): CanonicalRequestType {
  switch (permission) {
    case "bash":
      return "exec_command_approval";
    case "edit":
    case "write":
      return "file_change_approval";
    case "read":
    case "glob":
    case "grep":
    case "list":
    case "codesearch":
    case "lsp":
    case "external_directory":
      return "file_read_approval";
    default:
      return "unknown";
  }
}

export function toPermissionReply(
  decision: ProviderApprovalDecision,
): "once" | "always" | "reject" {
  switch (decision) {
    case "acceptForSession":
      return "always";
    case "accept":
      return "once";
    case "decline":
    case "cancel":
      return "reject";
  }
}

// ---------------------------------------------------------------------------
// Tool state helpers
// ---------------------------------------------------------------------------

function readMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function toolStateTitle(state: KiloToolState): string | undefined {
  switch (state.status) {
    case "pending":
      return undefined;
    case "running":
    case "completed":
      return state.title;
    case "error":
      return readMetadataString(state.metadata, "title");
  }
}

export function toolStateDetail(state: KiloToolState): string | undefined {
  switch (state.status) {
    case "pending":
      return undefined;
    case "running":
      return readMetadataString(state.metadata, "summary") ?? state.title;
    case "completed":
      return readMetadataString(state.metadata, "summary") ?? state.output;
    case "error":
      return state.error;
  }
}

export function toPlanStepStatus(status: string): "pending" | "inProgress" | "completed" {
  switch (status) {
    case "completed":
      return "completed";
    case "in_progress":
      return "inProgress";
    default:
      return "pending";
  }
}

export function toToolItemType(
  toolName: string | undefined,
):
  | "command_execution"
  | "file_change"
  | "web_search"
  | "collab_agent_tool_call"
  | "dynamic_tool_call" {
  switch (toolName) {
    case "bash":
      return "command_execution";
    case "write":
    case "edit":
    case "apply_patch":
      return "file_change";
    case "webfetch":
      return "web_search";
    case "task":
      return "collab_agent_tool_call";
    default:
      return "dynamic_tool_call";
  }
}

export function toToolTitle(toolName: string | undefined): string {
  const value = asString(toolName) ?? "tool";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

export function toToolLifecycleEventType(
  previous: { kind: string } | undefined,
  status: KiloToolState["status"],
): "item.started" | "item.updated" | "item.completed" {
  if (status === "completed" || status === "error") {
    return "item.completed";
  }
  return previous?.kind === "tool" ? "item.updated" : "item.started";
}

// ---------------------------------------------------------------------------
// Server URL parsing
// ---------------------------------------------------------------------------

export function parseServerUrl(output: string): string | undefined {
  const match = output.match(/kilo server listening on\s+(https?:\/\/[^\s]+)(?=\r?\n)/);
  return match?.[1];
}

// ---------------------------------------------------------------------------
// SDK response helpers
// ---------------------------------------------------------------------------

export async function readJsonData<T>(promise: Promise<T>): Promise<T> {
  return promise;
}

export function readProviderListResponse(
  value:
    | ProviderListResponse
    | { data: ProviderListResponse; error?: undefined }
    | { data?: undefined; error: unknown },
): ProviderListResponse {
  if ("all" in value && "connected" in value) {
    return value;
  }
  if (value.data !== undefined) {
    return value.data;
  }
  throw new Error("Kilo SDK returned an empty provider list response");
}

export function readConfigProvidersResponse(
  value:
    | ConfigProvidersResponse
    | { data: ConfigProvidersResponse; error?: undefined }
    | { data?: undefined; error: unknown },
): ConfigProvidersResponse {
  if ("providers" in value) {
    return value;
  }
  if (value.data !== undefined) {
    return value.data;
  }
  throw new Error("Kilo SDK returned an empty config providers response");
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

/**
 * Converts an array of Kilo file diffs into a single unified diff string.
 * The format approximates standard unified diff output (--- a/file, +++ b/file,
 * with addition/deletion counts) without full line-level hunks since Kilo
 * only provides before/after snapshots and summary counts.
 */
export function fileDiffsToUnifiedDiff(diffs: ReadonlyArray<KiloFileDiff>): string {
  if (diffs.length === 0) {
    return "";
  }
  return diffs
    .map((d) => {
      const header = `--- a/${d.file}\n+++ b/${d.file}`;
      const stats = `@@ +${d.additions},-${d.deletions} @@`;
      return `${header}\n${stats}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Todo / plan helpers
// ---------------------------------------------------------------------------

/**
 * Prefixes a todo's content with its priority when available, e.g. `"[HIGH] task"`.
 */
export function todoPriorityPrefix(todo: KiloTodo): string {
  if (todo.priority && todo.priority.length > 0) {
    return `[${todo.priority.toUpperCase()}] ${todo.content}`;
  }
  return todo.content;
}
