// @ts-nocheck
// Stub: split-view store for focused chat context resolution.
import { create } from "zustand";
import type { ProjectId, ThreadId } from "@t3tools/contracts";

export interface SplitView {
  id: string;
  sourceThreadId: ThreadId;
  ownerProjectId: ProjectId;
  leftThreadId: ThreadId | null;
  rightThreadId: ThreadId | null;
  focusedPane: "left" | "right";
  ratio: number;
  leftPanel: SplitViewPanelState;
  rightPanel: SplitViewPanelState;
  createdAt: string;
  updatedAt: string;
}

interface SplitViewPanelState {
  panel: string | null;
  diffTurnId: string | null;
  diffFilePath: string | null;
  hasOpenedPanel: boolean;
  lastOpenPanel: string;
}

interface SplitViewStoreState {
  splitView: SplitView | null;
}

export const useSplitViewStore = create<SplitViewStoreState>()(() => ({
  splitView: null,
}));

export function selectSplitView(
  _splitViewId: string | null,
): (state: SplitViewStoreState) => SplitView | null {
  return (state) => state.splitView;
}

export function resolveSplitViewFocusedPaneThreadId(splitView: SplitView): ThreadId | null {
  return splitView.focusedPane === "left" ? splitView.leftThreadId : splitView.rightThreadId;
}

export function resolveSplitViewThreadIds(splitView: SplitView): ThreadId[] {
  const ids: ThreadId[] = [];
  if (splitView.leftThreadId) ids.push(splitView.leftThreadId);
  if (splitView.rightThreadId && splitView.rightThreadId !== splitView.leftThreadId)
    ids.push(splitView.rightThreadId);
  return ids;
}

export function resolvePreferredSplitViewIdForThread(): string | null {
  return null;
}
