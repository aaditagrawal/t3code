import { scopeThreadRef } from "@t3tools/client-runtime";
import type { ScopedProjectRef, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { type DraftThreadEnvMode } from "../composerDraftStore";
import { selectThreadsAcrossEnvironments, useStore } from "../store";
import { buildThreadRouteParams } from "../threadRoutes";
import { useHandleNewThread } from "./useHandleNewThread";

interface OpenProjectThreadOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
}

function latestThreadIdForProject(
  projectRef: ScopedProjectRef,
  threads: ReadonlyArray<{
    id: ThreadId;
    projectId: ScopedProjectRef["projectId"];
    environmentId: ScopedProjectRef["environmentId"];
    createdAt: string;
  }>,
): ThreadId | null {
  const latestThread = threads
    .filter(
      (thread) =>
        thread.projectId === projectRef.projectId &&
        thread.environmentId === projectRef.environmentId,
    )
    .toSorted((left, right) => {
      const byDate = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
      if (byDate !== 0) return byDate;
      return right.id.localeCompare(left.id);
    })[0];

  return latestThread?.id ?? null;
}

export function useProjectThreadNavigation(routeThreadRef: ScopedThreadRef | null) {
  const threads = useStore(selectThreadsAcrossEnvironments);
  const navigate = useNavigate();
  const { handleNewThread } = useHandleNewThread();

  const navigateToThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      if (
        routeThreadRef &&
        routeThreadRef.threadId === threadRef.threadId &&
        routeThreadRef.environmentId === threadRef.environmentId
      ) {
        return;
      }

      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [navigate, routeThreadRef],
  );

  const openOrCreateThread = useCallback(
    async (projectRef: ScopedProjectRef, options?: OpenProjectThreadOptions) => {
      await handleNewThread(projectRef, options);
    },
    [handleNewThread],
  );

  const openProject = useCallback(
    async (projectRef: ScopedProjectRef) => {
      const latestThreadId = latestThreadIdForProject(projectRef, threads);
      if (latestThreadId) {
        await navigateToThread(scopeThreadRef(projectRef.environmentId, latestThreadId));
        return;
      }

      await handleNewThread(projectRef);
    },
    [handleNewThread, navigateToThread, threads],
  );

  return {
    openOrCreateThread,
    openProject,
  };
}
