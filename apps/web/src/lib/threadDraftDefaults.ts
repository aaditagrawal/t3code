import { type ProjectId, type ProviderKind } from "@t3tools/contracts";
import { resolveModelSlugForProvider } from "@t3tools/shared/model";
import type { Thread } from "../types";
import { inferProviderForThreadModel } from "./threadProvider";

export interface DraftThreadDefaults {
  readonly provider: ProviderKind;
  readonly model: string;
}

function timestampOrNaN(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return Date.parse(value);
}

function threadRecencyTimestamp(thread: Pick<Thread, "createdAt" | "lastVisitedAt" | "latestTurn">): number {
  return (
    [thread.lastVisitedAt, thread.latestTurn?.completedAt, thread.createdAt]
      .map((value) => timestampOrNaN(value))
      .find((value) => Number.isFinite(value)) ?? 0
  );
}

function compareThreadsByRecency(left: Thread, right: Thread): number {
  const byRecency = threadRecencyTimestamp(right) - threadRecencyTimestamp(left);
  if (byRecency !== 0) return byRecency;
  return right.id.localeCompare(left.id);
}

function latestThread(threads: ReadonlyArray<Thread>, projectId?: ProjectId | null): Thread | null {
  const matchingThreads =
    projectId === undefined || projectId === null
      ? threads
      : threads.filter((thread) => thread.projectId === projectId);
  return matchingThreads.toSorted(compareThreadsByRecency)[0] ?? null;
}

export function resolveDraftThreadDefaults(input: {
  readonly threads: ReadonlyArray<Thread>;
  readonly projectId: ProjectId | null | undefined;
  readonly fallbackModel: string;
}): DraftThreadDefaults {
  const recentThread =
    latestThread(input.threads, input.projectId) ?? latestThread(input.threads) ?? null;
  if (!recentThread) {
    const fallbackProvider = inferProviderForThreadModel({
      model: input.fallbackModel,
      sessionProviderName: null,
    });
    return {
      provider: fallbackProvider,
      model: resolveModelSlugForProvider(fallbackProvider, input.fallbackModel),
    };
  }

  const provider =
    recentThread.provider ??
    inferProviderForThreadModel({
      model: recentThread.model,
      sessionProviderName: recentThread.session?.provider ?? null,
    });

  return {
    provider,
    model: resolveModelSlugForProvider(provider, recentThread.model),
  };
}
