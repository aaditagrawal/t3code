import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";

export interface OrchestrationBatchEffects {
  promoteDraftThreadIds: ThreadId[];
  clearDeletedThreadIds: ThreadId[];
  removeTerminalStateThreadIds: ThreadId[];
  needsProviderInvalidation: boolean;
}

export function deriveOrchestrationBatchEffects(
  events: readonly OrchestrationEvent[],
): OrchestrationBatchEffects {
  const threadLifecycleEffects = new Map<
    ThreadId,
    {
      clearPromotedDraft: boolean;
      clearDeletedThread: boolean;
      removeTerminalState: boolean;
    }
  >();
  let needsProviderInvalidation = false;

  for (const event of events) {
    switch (event.type) {
      case "thread.turn-diff-completed":
      case "thread.reverted":
      case "thread.session-set": {
        needsProviderInvalidation = true;
        break;
      }

      case "thread.created": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: true,
          clearDeletedThread: false,
          removeTerminalState: false,
        });
        break;
      }

      case "thread.deleted": {
        threadLifecycleEffects.set(event.payload.threadId, {
          clearPromotedDraft: false,
          clearDeletedThread: true,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.archived": {
        const existingArchived = threadLifecycleEffects.get(event.payload.threadId);
        threadLifecycleEffects.set(event.payload.threadId, {
          ...existingArchived,
          clearPromotedDraft: existingArchived?.clearPromotedDraft ?? false,
          clearDeletedThread: existingArchived?.clearDeletedThread ?? false,
          removeTerminalState: true,
        });
        break;
      }

      case "thread.unarchived": {
        const existingUnarchived = threadLifecycleEffects.get(event.payload.threadId);
        threadLifecycleEffects.set(event.payload.threadId, {
          ...existingUnarchived,
          clearPromotedDraft: existingUnarchived?.clearPromotedDraft ?? false,
          clearDeletedThread: existingUnarchived?.clearDeletedThread ?? false,
          removeTerminalState: false,
        });
        break;
      }

      default: {
        break;
      }
    }
  }

  const promoteDraftThreadIds: ThreadId[] = [];
  const clearDeletedThreadIds: ThreadId[] = [];
  const removeTerminalStateThreadIds: ThreadId[] = [];
  for (const [threadId, effect] of threadLifecycleEffects) {
    if (effect.clearPromotedDraft) {
      promoteDraftThreadIds.push(threadId);
    }
    if (effect.clearDeletedThread) {
      clearDeletedThreadIds.push(threadId);
    }
    if (effect.removeTerminalState) {
      removeTerminalStateThreadIds.push(threadId);
    }
  }

  return {
    promoteDraftThreadIds,
    clearDeletedThreadIds,
    removeTerminalStateThreadIds,
    needsProviderInvalidation,
  };
}
