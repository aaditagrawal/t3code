/**
 * Thread title regeneration state helpers.
 *
 * `titleRegeneration` carries two states in one record: a request is *pending*
 * while `error` is unset, and *failed* once the server stamps a reason. Both
 * clients read it, so the predicates and the failure diff live here rather than
 * being re-derived per surface.
 *
 * @module threadTitleRegeneration
 */
import type { ThreadTitleRegeneration } from "@t3tools/contracts";

export interface ThreadTitleRegenerationHolder {
  readonly titleRegeneration?: ThreadTitleRegeneration | null | undefined;
}

/** True while generation is in flight — the only state that shows a spinner. */
export function isTitleRegenerationPending(thread: ThreadTitleRegenerationHolder): boolean {
  const regeneration = thread.titleRegeneration;
  return regeneration != null && regeneration.error == null;
}

/** The failure reason for a finished-but-failed request, if any. */
export function titleRegenerationError(thread: ThreadTitleRegenerationHolder): string | null {
  return thread.titleRegeneration?.error ?? null;
}

export interface TitleRegenerationFailure<Key> {
  readonly key: Key;
  readonly requestId: string;
  readonly error: string;
}

/**
 * Failures that appeared between two observations of the same thread set.
 *
 * Only transitions are reported. A thread that is already failed the first time
 * it is seen (a fresh page load, a newly loaded environment) is recorded
 * silently, so restoring persisted state never replays old errors as if they
 * just happened; a repeated failure for the same thread still reports because
 * each request carries its own id.
 *
 * `seen` is mutated in place with the current state and is expected to be
 * long-lived (one map per client session).
 */
export function collectTitleRegenerationFailures<Key, Thread extends ThreadTitleRegenerationHolder>(
  threads: ReadonlyArray<Thread>,
  keyOf: (thread: Thread) => Key,
  seen: Map<Key, string | null>,
): ReadonlyArray<TitleRegenerationFailure<Key>> {
  const failures: TitleRegenerationFailure<Key>[] = [];
  const present = new Set<Key>();

  for (const thread of threads) {
    const key = keyOf(thread);
    present.add(key);
    const regeneration = thread.titleRegeneration ?? null;
    const failedRequestId =
      regeneration != null && regeneration.error != null ? regeneration.requestId : null;
    const wasKnown = seen.has(key);
    const previous = seen.get(key) ?? null;
    seen.set(key, failedRequestId);
    if (
      failedRequestId != null &&
      wasKnown &&
      previous !== failedRequestId &&
      regeneration?.error != null
    ) {
      failures.push({ key, requestId: failedRequestId, error: regeneration.error });
    }
  }

  for (const key of seen.keys()) {
    if (!present.has(key)) seen.delete(key);
  }

  return failures;
}
