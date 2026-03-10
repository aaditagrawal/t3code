import { Fragment, type ReactNode, createElement, useEffect } from "react";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ProviderKind,
  ThreadId,
  type OrchestrationReadModel,
  type OrchestrationSessionStatus,
} from "@t3tools/contracts";
import { resolveModelSlug, resolveModelSlugForProvider } from "@t3tools/shared/model";
import { create } from "zustand";
import { inferProviderForThreadModel, toProviderKind } from "./lib/threadProvider";
import { type ChatMessage, type Project, type Thread } from "./types";


// ── State ────────────────────────────────────────────────────────────

export interface AppState {
  projects: Project[];
  threads: Thread[];
  threadsHydrated: boolean;
}

const PERSISTED_STATE_KEY = "t3code:renderer-state:v8";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

const initialState: AppState = {
  projects: [],
  threads: [],
  threadsHydrated: false,
};
const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];

// ── Persist helpers ──────────────────────────────────────────────────

function readPersistedState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as {
      expandedProjectCwds?: string[];
      projectOrderCwds?: string[];
    };
    persistedExpandedProjectCwds.clear();
    persistedProjectOrderCwds.length = 0;
    for (const cwd of parsed.expandedProjectCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedExpandedProjectCwds.add(cwd);
      }
    }
    for (const cwd of parsed.projectOrderCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
        persistedProjectOrderCwds.push(cwd);
      }
    }
    return { ...initialState };
  } catch {
    return initialState;
  }
}

let legacyKeysCleanedUp = false;

function persistState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds: state.projects
          .filter((project) => project.expanded)
          .map((project) => project.cwd),
        projectOrderCwds: state.projects.map((project) => project.cwd),
      }),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}


// ── Pure helpers ──────────────────────────────────────────────────────

function updateThread(
  threads: Thread[],
  threadId: ThreadId,
  updater: (t: Thread) => Thread,
): Thread[] {
  let changed = false;
  const next = threads.map((t) => {
    if (t.id !== threadId) return t;
    const updated = updater(t);
    if (updated !== t) changed = true;
    return updated;
  });
  return changed ? next : threads;
}

function arraysShallowEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function updateArrayWithStructuralSharing<TSource, TTarget>(params: {
  incoming: readonly TSource[];
  previous: readonly TTarget[];
  getIncomingKey: (item: TSource) => string;
  getPreviousKey: (item: TTarget) => string;
  mapItem: (item: TSource, previous: TTarget | undefined) => TTarget;
}): TTarget[] {
  const previousByKey = new Map(
    params.previous.map((item) => [params.getPreviousKey(item), item] as const),
  );
  let changed = params.incoming.length !== params.previous.length;
  const next = params.incoming.map((item, index) => {
    const mapped = params.mapItem(item, previousByKey.get(params.getIncomingKey(item)));
    if (!changed && mapped !== params.previous[index]) {
      changed = true;
    }
    return mapped;
  });
  return changed ? next : (params.previous as TTarget[]);
}

function updateOrderedArrayWithStructuralSharing<T>(params: {
  incoming: readonly T[];
  previous: readonly T[];
  mapItem: (item: T, previous: T | undefined) => T;
}): T[] {
  let changed = params.incoming.length !== params.previous.length;
  const next = params.incoming.map((item, index) => {
    const mapped = params.mapItem(item, params.previous[index]);
    if (!changed && mapped !== params.previous[index]) {
      changed = true;
    }
    return mapped;
  });
  return changed ? next : (params.previous as T[]);
}

function normalizeProjectScript(script: Project["scripts"][number]): Project["scripts"][number] {
  return { ...script };
}

function areUnknownValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  const leftIsStructured =
    typeof left === "object" && left !== null && (Array.isArray(left) || left.constructor === Object);
  const rightIsStructured =
    typeof right === "object" &&
    right !== null &&
    (Array.isArray(right) || right.constructor === Object);
  if (!leftIsStructured || !rightIsStructured) {
    return false;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function areProjectScriptsEqual(
  left: Project["scripts"][number],
  right: Project["scripts"][number],
): boolean {
  return areUnknownValuesEqual(left, right);
}

function mapProjectScripts(
  incoming: readonly Project["scripts"][number][],
  previous: readonly Project["scripts"][number][],
): Project["scripts"] {
  return updateOrderedArrayWithStructuralSharing({
    incoming,
    previous,
    mapItem: (script, existing) => {
      const normalized = normalizeProjectScript(script);
      return existing && areProjectScriptsEqual(existing, normalized) ? existing : normalized;
    },
  });
}

function areAttachmentsEqual(
  left: NonNullable<ChatMessage["attachments"]>,
  right: NonNullable<ChatMessage["attachments"]>,
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (!leftItem || !rightItem) return false;
    if (
      leftItem.type !== rightItem.type ||
      leftItem.id !== rightItem.id ||
      leftItem.name !== rightItem.name ||
      leftItem.mimeType !== rightItem.mimeType ||
      leftItem.sizeBytes !== rightItem.sizeBytes ||
      leftItem.previewUrl !== rightItem.previewUrl
    ) {
      return false;
    }
  }
  return true;
}

function normalizeMessage(
  message: OrchestrationReadModel["threads"][number]["messages"][number],
  existing?: ChatMessage,
): ChatMessage {
  const attachments = message.attachments?.map((attachment) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
  }));
  const normalizedMessage: ChatMessage = {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
  const existingAttachments = existing?.attachments;
  const normalizedAttachments = normalizedMessage.attachments;
  const attachmentsEqual =
    existingAttachments === undefined && normalizedAttachments === undefined
      ? true
      : existingAttachments !== undefined &&
          normalizedAttachments !== undefined &&
          areAttachmentsEqual(existingAttachments, normalizedAttachments);
  if (
    existing &&
    existing.id === normalizedMessage.id &&
    existing.role === normalizedMessage.role &&
    existing.text === normalizedMessage.text &&
    existing.createdAt === normalizedMessage.createdAt &&
    existing.streaming === normalizedMessage.streaming &&
    existing.completedAt === normalizedMessage.completedAt &&
    attachmentsEqual
  ) {
    return existing;
  }
  return normalizedMessage;
}

function mapMessages(
  incoming: readonly OrchestrationReadModel["threads"][number]["messages"][number][],
  previous: readonly ChatMessage[],
): ChatMessage[] {
  return updateArrayWithStructuralSharing({
    incoming,
    previous,
    getIncomingKey: (message) => message.id,
    getPreviousKey: (message) => message.id,
    mapItem: normalizeMessage,
  });
}

function normalizeProposedPlan(
  proposedPlan: OrchestrationReadModel["threads"][number]["proposedPlans"][number],
  existing?: Thread["proposedPlans"][number],
): Thread["proposedPlans"][number] {
  const normalized = {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
  if (
    existing &&
    existing.id === normalized.id &&
    existing.turnId === normalized.turnId &&
    existing.planMarkdown === normalized.planMarkdown &&
    existing.createdAt === normalized.createdAt &&
    existing.updatedAt === normalized.updatedAt
  ) {
    return existing;
  }
  return normalized;
}

function mapProposedPlans(
  incoming: OrchestrationReadModel["threads"][number]["proposedPlans"],
  previous: Thread["proposedPlans"],
): Thread["proposedPlans"] {
  return updateArrayWithStructuralSharing({
    incoming,
    previous,
    getIncomingKey: (plan) => plan.id,
    getPreviousKey: (plan) => plan.id,
    mapItem: normalizeProposedPlan,
  });
}

function normalizeTurnDiffSummary(
  checkpoint: OrchestrationReadModel["threads"][number]["checkpoints"][number],
  existing?: Thread["turnDiffSummaries"][number],
): Thread["turnDiffSummaries"][number] {
  const files = updateOrderedArrayWithStructuralSharing({
    incoming: checkpoint.files,
    previous: existing?.files ?? [],
    mapItem: (file, previousFile) => {
      const normalized = { ...file };
      if (
        previousFile &&
        previousFile.path === normalized.path &&
        previousFile.kind === normalized.kind &&
        previousFile.additions === normalized.additions &&
        previousFile.deletions === normalized.deletions
      ) {
        return previousFile;
      }
      return normalized;
    },
  });
  const normalized = {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files,
  };
  if (
    existing &&
    existing.turnId === normalized.turnId &&
    existing.completedAt === normalized.completedAt &&
    existing.status === normalized.status &&
    existing.assistantMessageId === normalized.assistantMessageId &&
    existing.checkpointTurnCount === normalized.checkpointTurnCount &&
    existing.checkpointRef === normalized.checkpointRef &&
    arraysShallowEqual(existing.files, normalized.files)
  ) {
    return existing;
  }
  return normalized;
}

function mapTurnDiffSummaries(
  incoming: OrchestrationReadModel["threads"][number]["checkpoints"],
  previous: Thread["turnDiffSummaries"],
): Thread["turnDiffSummaries"] {
  return updateArrayWithStructuralSharing({
    incoming,
    previous,
    getIncomingKey: (checkpoint) => checkpoint.turnId,
    getPreviousKey: (summary) => summary.turnId,
    mapItem: normalizeTurnDiffSummary,
  });
}

function normalizeActivity(
  activity: OrchestrationReadModel["threads"][number]["activities"][number],
  existing?: Thread["activities"][number],
): Thread["activities"][number] {
  const normalized = { ...activity };
  if (
    existing &&
    existing.id === normalized.id &&
    existing.kind === normalized.kind &&
    existing.tone === normalized.tone &&
    existing.summary === normalized.summary &&
    existing.turnId === normalized.turnId &&
    existing.createdAt === normalized.createdAt &&
    existing.sequence === normalized.sequence &&
    areUnknownValuesEqual(existing.payload, normalized.payload)
  ) {
    return existing;
  }
  return normalized;
}

function mapActivities(
  incoming: OrchestrationReadModel["threads"][number]["activities"],
  previous: Thread["activities"],
): Thread["activities"] {
  return updateOrderedArrayWithStructuralSharing({
    incoming,
    previous,
    mapItem: normalizeActivity,
  });
}

function normalizeSession(
  session: OrchestrationReadModel["threads"][number]["session"],
  existing: Thread["session"],
): Thread["session"] {
  if (!session) {
    return null;
  }
  const normalized = {
    provider: toLegacyProvider(session.providerName),
    status: toLegacySessionStatus(session.status),
    orchestrationStatus: session.status,
    activeTurnId: session.activeTurnId ?? undefined,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    ...(session.lastError ? { lastError: session.lastError } : {}),
  };
  if (
    existing &&
    existing.provider === normalized.provider &&
    existing.status === normalized.status &&
    existing.orchestrationStatus === normalized.orchestrationStatus &&
    existing.activeTurnId === normalized.activeTurnId &&
    existing.createdAt === normalized.createdAt &&
    existing.updatedAt === normalized.updatedAt &&
    existing.lastError === normalized.lastError
  ) {
    return existing;
  }
  return normalized;
}

function normalizeLatestTurn(
  latestTurn: OrchestrationReadModel["threads"][number]["latestTurn"],
  existing: Thread["latestTurn"],
): Thread["latestTurn"] {
  if (!latestTurn) return null;
  const usage =
    existing?.usage &&
    existing.usage.input_tokens === latestTurn.usage?.input_tokens &&
    existing.usage.output_tokens === latestTurn.usage?.output_tokens &&
    existing.usage.total_tokens === latestTurn.usage?.total_tokens &&
    existing.usage.cached_tokens === latestTurn.usage?.cached_tokens &&
    existing.usage.duration_ms === latestTurn.usage?.duration_ms &&
    existing.usage.tool_calls === latestTurn.usage?.tool_calls
      ? existing.usage
      : latestTurn.usage
        ? { ...latestTurn.usage }
        : undefined;
  if (
    existing &&
    existing.turnId === latestTurn.turnId &&
    existing.state === latestTurn.state &&
    existing.requestedAt === latestTurn.requestedAt &&
    existing.startedAt === latestTurn.startedAt &&
    existing.completedAt === latestTurn.completedAt &&
    existing.assistantMessageId === latestTurn.assistantMessageId &&
    existing.usage === usage
  ) {
    return existing;
  }
  return {
    ...latestTurn,
    ...(usage ? { usage } : {}),
  };
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  const previousByCwd = new Map(previous.map((project) => [project.cwd, project] as const));
  const mappedProjects = incoming.map((project) => {
    const existing = previousById.get(project.id) ?? previousByCwd.get(project.workspaceRoot);
    const scripts = mapProjectScripts(project.scripts, existing?.scripts ?? []);
    const normalized: Project = {
      id: project.id,
      name: project.title,
      cwd: project.workspaceRoot,
      model:
        existing?.model ??
        resolveModelSlug(project.defaultModel ?? DEFAULT_MODEL_BY_PROVIDER.codex),
      expanded:
        existing?.expanded ??
        (persistedExpandedProjectCwds.size > 0
          ? persistedExpandedProjectCwds.has(project.workspaceRoot)
          : true),
      scripts,
    };
    if (
      existing &&
      existing.id === normalized.id &&
      existing.name === normalized.name &&
      existing.cwd === normalized.cwd &&
      existing.model === normalized.model &&
      existing.expanded === normalized.expanded &&
      arraysShallowEqual(existing.scripts, scripts)
    ) {
      return existing;
    }
    return normalized;
  });

  const projectOrderCwds =
    previous.length > 0 ? previous.map((project) => project.cwd) : persistedProjectOrderCwds;
  if (projectOrderCwds.length === 0) {
    return mappedProjects;
  }

  const projectOrderByCwd = new Map(
    projectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );

  const orderedProjects = mappedProjects.toSorted((left, right) => {
    const leftIndex = projectOrderByCwd.get(left.cwd);
    const rightIndex = projectOrderByCwd.get(right.cwd);
    if (leftIndex === undefined && rightIndex === undefined) return 0;
    if (leftIndex === undefined) return 1;
    if (rightIndex === undefined) return -1;
    return leftIndex - rightIndex;
  });
  return arraysShallowEqual(orderedProjects, previous) ? previous : orderedProjects;
}

function toLegacySessionStatus(
  status: OrchestrationSessionStatus,
): "connecting" | "ready" | "running" | "error" | "closed" {
  switch (status) {
    case "starting":
      return "connecting";
    case "running":
      return "running";
    case "error":
      return "error";
    case "ready":
    case "interrupted":
      return "ready";
    case "idle":
    case "stopped":
      return "closed";
  }
}

function toLegacyProvider(providerName: string | null): ProviderKind {
  return toProviderKind(providerName) ?? "codex";
}

function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") return "";
  const bridgeWsUrl = window.desktopBridge?.getWsUrl?.();
  const envWsUrl = import.meta.env.VITE_WS_URL as string | undefined;
  const wsCandidate =
    typeof bridgeWsUrl === "string" && bridgeWsUrl.length > 0
      ? bridgeWsUrl
      : typeof envWsUrl === "string" && envWsUrl.length > 0
        ? envWsUrl
        : null;
  if (!wsCandidate) return window.location.origin;
  try {
    const wsUrl = new URL(wsCandidate);
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol;
    return `${protocol}//${wsUrl.host}`;
  } catch {
    return window.location.origin;
  }
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

// ── Pure state transition functions ────────────────────────────────────

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const projects = mapProjectsFromReadModel(
    readModel.projects.filter((project) => project.deletedAt === null),
    state.projects,
  );
  const existingThreadById = new Map(state.threads.map((thread) => [thread.id, thread] as const));
  const threads = readModel.threads
    .filter((thread) => thread.deletedAt === null)
    .map((thread) => {
      const existing = existingThreadById.get(thread.id);
      const provider = inferProviderForThreadModel({
        model: thread.model,
        sessionProviderName:
          thread.session?.providerName ?? existing?.provider ?? existing?.session?.provider ?? null,
      });
      const session = normalizeSession(thread.session, existing?.session ?? null);
      const messages = mapMessages(thread.messages, existing?.messages ?? []);
      const proposedPlans = mapProposedPlans(thread.proposedPlans, existing?.proposedPlans ?? []);
      const turnDiffSummaries = mapTurnDiffSummaries(
        thread.checkpoints,
        existing?.turnDiffSummaries ?? [],
      );
      const activities = mapActivities(thread.activities, existing?.activities ?? []);
      const latestTurn = normalizeLatestTurn(thread.latestTurn, existing?.latestTurn ?? null);
      const normalizedThread: Thread = {
        id: thread.id,
        codexThreadId: null,
        projectId: thread.projectId,
        title: thread.title,
        provider,
        model: resolveModelSlugForProvider(provider, thread.model),
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        session,
        messages,
        proposedPlans,
        error: thread.session?.lastError ?? null,
        createdAt: thread.createdAt,
        latestTurn,
        lastVisitedAt: existing?.lastVisitedAt ?? thread.updatedAt,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        turnDiffSummaries,
        activities,
      };
      if (
        existing &&
        existing.id === normalizedThread.id &&
        existing.codexThreadId === normalizedThread.codexThreadId &&
        existing.projectId === normalizedThread.projectId &&
        existing.title === normalizedThread.title &&
        existing.provider === normalizedThread.provider &&
        existing.model === normalizedThread.model &&
        existing.runtimeMode === normalizedThread.runtimeMode &&
        existing.interactionMode === normalizedThread.interactionMode &&
        existing.session === normalizedThread.session &&
        existing.messages === normalizedThread.messages &&
        existing.proposedPlans === normalizedThread.proposedPlans &&
        existing.error === normalizedThread.error &&
        existing.createdAt === normalizedThread.createdAt &&
        existing.latestTurn === normalizedThread.latestTurn &&
        existing.lastVisitedAt === normalizedThread.lastVisitedAt &&
        existing.branch === normalizedThread.branch &&
        existing.worktreePath === normalizedThread.worktreePath &&
        existing.turnDiffSummaries === normalizedThread.turnDiffSummaries &&
        existing.activities === normalizedThread.activities
      ) {
        return existing;
      }
      return normalizedThread;
    });
  const nextThreads = arraysShallowEqual(threads, state.threads) ? state.threads : threads;
  const nextProjects = arraysShallowEqual(projects, state.projects) ? state.projects : projects;
  if (
    nextProjects === state.projects &&
    nextThreads === state.threads &&
    state.threadsHydrated
  ) {
    return state;
  }
  return {
    ...state,
    projects: nextProjects,
    threads: nextThreads,
    threadsHydrated: true,
  };
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const threads = updateThread(state.threads, threadId, (thread) => {
    const previousVisitedAtMs = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
    if (
      Number.isFinite(previousVisitedAtMs) &&
      Number.isFinite(visitedAtMs) &&
      previousVisitedAtMs >= visitedAtMs
    ) {
      return thread;
    }
    return { ...thread, lastVisitedAt: at };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  const threads = updateThread(state.threads, threadId, (thread) => {
    if (!thread.latestTurn?.completedAt) return thread;
    const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
    if (Number.isNaN(latestTurnCompletedAtMs)) return thread;
    const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
    if (thread.lastVisitedAt === unreadVisitedAt) return thread;
    return { ...thread, lastVisitedAt: unreadVisitedAt };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === projectId ? { ...p, expanded: !p.expanded } : p)),
  };
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  let changed = false;
  const projects = state.projects.map((p) => {
    if (p.id !== projectId || p.expanded === expanded) return p;
    changed = true;
    return { ...p, expanded };
  });
  return changed ? { ...state, projects } : state;
}

export function reorderProjects(
  state: AppState,
  draggedProjectId: Project["id"],
  targetProjectId: Project["id"],
): AppState {
  if (draggedProjectId === targetProjectId) return state;
  const draggedIndex = state.projects.findIndex((project) => project.id === draggedProjectId);
  const targetIndex = state.projects.findIndex((project) => project.id === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const projects = [...state.projects];
  const [draggedProject] = projects.splice(draggedIndex, 1);
  if (!draggedProject) return state;
  projects.splice(targetIndex, 0, draggedProject);
  return { ...state, projects };
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.error === error) return t;
    return { ...t, error };
  });
  return threads === state.threads ? state : { ...state, threads };
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const threads = updateThread(state.threads, threadId, (t) => {
    if (t.branch === branch && t.worktreePath === worktreePath) return t;
    const cwdChanged = t.worktreePath !== worktreePath;
    return {
      ...t,
      branch,
      worktreePath,
      ...(cwdChanged ? { session: null } : {}),
    };
  });
  return threads === state.threads ? state : { ...state, threads };
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  reorderProjects: (draggedProjectId: Project["id"], targetProjectId: Project["id"]) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...readPersistedState(),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
}));

// Persist only when the project list changes. Message streaming updates should not
// touch localStorage because the persisted payload only depends on project metadata.
useStore.subscribe((state, previousState) => {
  if (state.projects === previousState.projects) {
    return;
  }
  persistState(state);
});

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistState(useStore.getState());
  }, []);
  return createElement(Fragment, null, children);
}
