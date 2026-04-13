// @ts-nocheck
// FILE: focusedChatContext.ts
// Purpose: Resolves the currently focused chat context across single and split chat surfaces.
// Layer: Route-aware UI helpers
// Exports: pure resolver and hook used by shortcut, discovery, and thread creation flows

import { ThreadId, type ThreadId as ThreadIdType } from "@t3tools/contracts";
import { useParams, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";
import { type DraftThreadState, useComposerDraftStore } from "./composerDraftStore";
import { parseDiffRouteSearch } from "./diffRouteSearch";
import {
  resolveSplitViewFocusedPaneThreadId,
  selectSplitView,
  type SplitView,
  useSplitViewStore,
} from "./splitViewStore";
import {
  selectProjectsAcrossEnvironments,
  selectThreadsAcrossEnvironments,
  useStore,
} from "./store";
import type { Project, Thread } from "./types";

export interface FocusedChatContext {
  routeThreadId: ThreadIdType | null;
  splitView: SplitView | null;
  focusedThreadId: ThreadIdType | null;
  activeThread: Thread | null;
  activeDraftThread: DraftThreadState | null;
  activeProject: Project | null;
  activeProjectId: Project["id"] | null;
}

export function resolveFocusedChatContext(input: {
  routeThreadId: ThreadIdType | null;
  splitView: SplitView | null;
  threads: readonly Thread[];
  projects: readonly Project[];
  draftThreadsByThreadKey: Record<string, DraftThreadState | undefined>;
}): FocusedChatContext {
  const focusedThreadId = input.splitView
    ? resolveSplitViewFocusedPaneThreadId(input.splitView)
    : input.routeThreadId;
  const activeThread =
    focusedThreadId !== null
      ? (input.threads.find((thread) => thread.id === focusedThreadId) ?? null)
      : null;
  const activeDraftThread =
    focusedThreadId !== null ? (input.draftThreadsByThreadKey[focusedThreadId] ?? null) : null;
  const activeProjectId =
    activeDraftThread?.projectId ??
    activeThread?.projectId ??
    input.splitView?.ownerProjectId ??
    null;
  const activeProject =
    activeProjectId !== null
      ? (input.projects.find((project) => project.id === activeProjectId) ?? null)
      : null;

  return {
    routeThreadId: input.routeThreadId,
    splitView: input.splitView,
    focusedThreadId,
    activeThread,
    activeDraftThread,
    activeProject,
    activeProjectId,
  };
}

export function useFocusedChatContext(): FocusedChatContext {
  const projects = useStore(selectProjectsAcrossEnvironments);
  const threads = useStore(selectThreadsAcrossEnvironments);
  const draftThreadsByThreadKey = useComposerDraftStore((store) => store.draftThreadsByThreadKey);
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.make(params.threadId) : null),
  });
  const routeSearch = useSearch({
    strict: false,
    select: (search) => parseDiffRouteSearch(search),
  });
  const activeSplitView = useSplitViewStore(selectSplitView(null));

  return useMemo(
    () =>
      resolveFocusedChatContext({
        routeThreadId,
        splitView: activeSplitView,
        threads,
        projects,
        draftThreadsByThreadKey,
      }),
    [activeSplitView, draftThreadsByThreadKey, projects, routeThreadId, threads],
  );
}
