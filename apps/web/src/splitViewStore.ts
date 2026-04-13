export function resolveSplitViewThreadIds(splitView: SplitView): ThreadId[] {
  const ids: ThreadId[] = [];
  if (splitView.leftThreadId) ids.push(splitView.leftThreadId);
  if (splitView.rightThreadId && splitView.rightThreadId !== splitView.leftThreadId) {
    ids.push(splitView.rightThreadId);
  }
  return ids;
}

export function resolvePreferredSplitViewIdForThread(): string | null {
  return null;
}
