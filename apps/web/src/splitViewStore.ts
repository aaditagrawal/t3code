// FILE: splitViewStore.ts
// Purpose: Stub for split-view state used by toast visibility and notification routing.
// Layer: Store stubs
// Exports: SplitView type, resolver helpers, and useSplitViewStore hook stub

import type { ProjectId, ThreadId } from "@t3tools/contracts";

export interface SplitViewPanelState {
  panel: string | null;
  diffTurnId: string | null;
  diffFilePath: string | null;
  hasOpenedPanel: boolean;
  lastOpenPanel: string;
}

export interface SplitView {
  id: string;
  sourceThreadId: ThreadId;
  ownerProjectId: ProjectId;
  leftThreadId: ThreadId;
  rightThreadId: ThreadId | null;
  focusedPane: "left" | "right";
  ratio: number;
  leftPanel: SplitViewPanelState;
  rightPanel: SplitViewPanelState;
  createdAt: string;
  updatedAt: string;
}

interface SplitViewStoreState {
  splitViewsById: Record<string, SplitView>;
  splitViewIdBySourceThreadId: Record<string, string>;
}

const emptySplitViewState: SplitViewStoreState = {
  splitViewsById: {},
  splitViewIdBySourceThreadId: {},
};

export function useSplitViewStore<T>(selector: (state: SplitViewStoreState) => T): T {
  return selector(emptySplitViewState);
}

export function resolveSplitViewThreadIds(splitView: SplitView): ThreadId[] {
  const ids: ThreadId[] = [];
  if (splitView.leftThreadId) ids.push(splitView.leftThreadId);
  if (splitView.rightThreadId && splitView.rightThreadId !== splitView.leftThreadId) {
    ids.push(splitView.rightThreadId);
  }
  return ids;
}

export function resolvePreferredSplitViewIdForThread(
  _input?: {
    splitViewsById?: Record<string, SplitView>;
    splitViewIdBySourceThreadId?: Record<string, string>;
    threadId?: ThreadId;
  } | void,
): string | null {
  return null;
}
