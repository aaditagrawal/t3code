/**
 * Thread title regeneration state helpers.
 *
 * Regeneration has two independent pieces of state: `titleRegeneration` while a
 * request is in flight, and `titleRegenerationFailure` describing why the last
 * finished request produced no title. Both clients read them, so the predicates
 * and the failure diff live here rather than being re-derived per surface.
 *
 * @module threadTitleRegeneration
 */
import type { ThreadTitleRegeneration, ThreadTitleRegenerationFailure } from "@t3tools/contracts";

export interface ThreadTitleRegenerationHolder {
  readonly titleRegeneration?: ThreadTitleRegeneration | null | undefined;
  readonly titleRegenerationFailure?: ThreadTitleRegenerationFailure | null | undefined;
}

/** True while generation is in flight — the only state that shows a spinner. */
export function isTitleRegenerationPending(thread: ThreadTitleRegenerationHolder): boolean {
  return thread.titleRegeneration != null;
}

/** Why the last finished request produced no title, if it failed. */
export function titleRegenerationFailureReason(
  thread: ThreadTitleRegenerationHolder,
): string | null {
  // A pending retry supersedes the previous reason on the server, but a client
  // applying events out of order could briefly hold both. Pending wins.
  if (thread.titleRegeneration != null) return null;
  return thread.titleRegenerationFailure?.error ?? null;
}

export interface TitleRegenerationFailureNotice<Key> {
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
 * just happened; the reason stays available on the thread for surfaces that
 * render it directly. A repeated failure still reports because each request
 * carries its own id.
 *
 * `seen` is mutated in place with the current state and is expected to be
 * long-lived (one map per client session).
 */
export function collectTitleRegenerationFailures<Key, Thread extends ThreadTitleRegenerationHolder>(
  threads: ReadonlyArray<Thread>,
  keyOf: (thread: Thread) => Key,
  seen: Map<Key, string | null>,
): ReadonlyArray<TitleRegenerationFailureNotice<Key>> {
  const failures: TitleRegenerationFailureNotice<Key>[] = [];
  const present = new Set<Key>();

  for (const thread of threads) {
    const key = keyOf(thread);
    present.add(key);
    const failure = thread.titleRegenerationFailure ?? null;
    const wasKnown = seen.has(key);
    const previous = seen.get(key) ?? null;
    seen.set(key, failure?.requestId ?? null);
    if (failure != null && wasKnown && previous !== failure.requestId) {
      failures.push({ key, requestId: failure.requestId, error: failure.error });
    }
  }

  for (const key of seen.keys()) {
    if (!present.has(key)) seen.delete(key);
  }

  return failures;
}
