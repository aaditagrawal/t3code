/**
 * Home threads — the one thread per agent instance that receives its agent's
 * proactive output.
 *
 * Hermes has a first-class "home channel" concept: a per-platform default
 * destination for output nobody asked for at a specific address — a cron job's
 * result, an agent-initiated `send_message`, a gateway online notice, a
 * `/handoff`. Every other Hermes surface designates one interactively via
 * `/sethome`. T3 designates one automatically instead, because there is no
 * "current channel" here for a user to point at: threads are created on
 * demand, and asking someone to pick one before their first cron job can fire
 * is setup for a decision they have no basis to make.
 *
 * ## Converge-on-read, like agent projects
 *
 * `getOrCreateHomeThread` is a **precondition every caller runs**, not a
 * lifecycle event one caller owns — the same reasoning as
 * `getOrCreateAgentProject`, and for the same failure modes: an instance
 * enrolled before this shipped has no designation, a dispatch that failed once
 * would otherwise leave the instance permanently unable to receive, and a
 * thread deleted out from under the designation would strand every future
 * delivery. Each of those self-heals on the next handshake.
 *
 * ## Why settings and not a table
 *
 * The designation is per-instance enrollment metadata, exactly like
 * `connectorUrl` and `revoked`, and it lives beside them in the Hermes
 * instance's config blob. That keeps one source of truth for "facts about this
 * enrollment" and avoids a migration for a single nullable id.
 *
 * The plugin's `T3_HOME_CHANNEL` env var is a *cache* of this value, reconciled
 * on every `connection.accepted`. This module is authoritative; drift is
 * bounded by one reconnect.
 *
 * @module orchestration/homeThreads
 */
import {
  CommandId,
  DEFAULT_HERMES_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  HERMES_DRIVER_KIND,
  ThreadId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { ServerSettingsService } from "../serverSettings.ts";
import { getOrCreateAgentProject } from "./agentProjects.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

/**
 * Title of the home thread. Plain, no emoji: it sits in the same list as the
 * user's own threads and should not shout.
 */
export const HOME_THREAD_TITLE = "Home";

/** Read the designated home thread id out of a Hermes instance envelope. */
export const readHomeThreadId = (
  config: ProviderInstanceConfig | undefined,
): ThreadId | undefined => {
  if (!config || config.driver !== HERMES_DRIVER_KIND) return undefined;
  const blob = config.config && typeof config.config === "object" ? config.config : {};
  const raw = (blob as Record<string, unknown>).homeThreadId;
  return typeof raw === "string" && raw !== "" ? ThreadId.make(raw) : undefined;
};

/**
 * Read one instance's designation straight from settings.
 *
 * Callers that only need to *know* the designation use this rather than
 * `getOrCreateHomeThread`, so a read never has the side effect of creating a
 * thread.
 */
export const getDesignatedHomeThreadId = Effect.fn("getDesignatedHomeThreadId")(function* (
  instanceId: ProviderInstanceId,
) {
  const settings = yield* ServerSettingsService;
  const current = yield* settings.getSettings;
  return readHomeThreadId(current.providerInstances[instanceId]);
});

/**
 * Read the designated thread's row regardless of archive state.
 *
 * The snapshot query's thread reads filter `archived_at IS NULL`, which is
 * correct for "what should the user see" and wrong for "does this row exist".
 * Going to the repository directly is what keeps an archived Home from looking
 * deleted — and thereby keeps this module from minting a second one. A
 * soft-deleted row still counts as gone.
 */
const readHomeThreadRow = Effect.fn("readHomeThreadRow")(function* (threadId: ThreadId) {
  const query = yield* ProjectionSnapshotQuery;
  if (query.getThreadArchiveStateById !== undefined) {
    const row = yield* query.getThreadArchiveStateById(threadId);
    return Option.getOrUndefined(row);
  }

  // Compatibility for embedders and test layers implementing the older
  // query shape: active and archived snapshots together distinguish a parked
  // thread from one that was actually deleted. Production uses the indexed
  // query above, so this O(n) fallback is not on the gateway hot path.
  const active = yield* query.getThreadShellById(threadId);
  if (Option.isSome(active)) return { archivedAt: active.value.archivedAt };
  const archived = yield* query.getArchivedShellSnapshot();
  const row = archived.threads.find((thread) => thread.id === threadId);
  return row === undefined ? undefined : { archivedAt: row.archivedAt };
});

/**
 * Persist a designation into the instance's Hermes config blob.
 *
 * A compare-and-set against `expected` — the designation this caller read
 * before deciding to create — rather than a blind write. Two concurrent
 * callers that both mint a thread would otherwise each persist their own id,
 * and the one that wrote first re-reads before the other's overwrite lands, so
 * the two return *different* threads and one is orphaned from the final
 * designation. Standing down when the designation moved out from under us is
 * what makes the caller's re-read below an actual tiebreaker.
 *
 * `expected` still has to be honoured rather than "never overwrite": the
 * self-healing path arrives here with a stale designation pointing at a thread
 * that is really gone, and replacing exactly that value is the whole point.
 */
const persistHomeThreadId = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly threadId: ThreadId;
  /** Designation observed before creating, or `undefined` if there was none. */
  readonly expected: ThreadId | undefined;
}) =>
  Effect.gen(function* () {
    const settings = yield* ServerSettingsService;
    yield* settings.updateSettingsWith((latest) => {
      // Re-read under the settings write lock: the envelope may have been
      // replaced (or the driver changed) between our read and this write, and
      // writing a Hermes designation onto a non-Hermes envelope would corrupt
      // it. Returning an empty patch is the established no-op here.
      const existing = latest.providerInstances[input.instanceId];
      if (!existing || existing.driver !== HERMES_DRIVER_KIND) return {};
      // Someone else designated (or re-designated) while we were creating.
      // Adopt theirs; ours stays an empty thread in the agent project.
      if (readHomeThreadId(existing) !== input.expected) return {};
      const currentConfig =
        existing.config && typeof existing.config === "object"
          ? (existing.config as Record<string, unknown>)
          : {};
      return {
        providerInstances: {
          ...latest.providerInstances,
          [input.instanceId]: {
            ...existing,
            config: { ...currentConfig, homeThreadId: input.threadId },
          },
        },
      };
    });
  });

/**
 * Resolve the home thread for one provider instance, creating it if absent.
 *
 * Safe to call on every handshake: the common path is one settings read plus
 * one indexed thread read. Idempotent, and concurrent callers converge —
 * the loser of a race re-reads and adopts the winner's thread.
 */
export const getOrCreateHomeThread = Effect.fn("getOrCreateHomeThread")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  /** Instance nickname, used as the agent project's title on first creation. */
  readonly title: string;
}) {
  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;

  const designated = yield* getDesignatedHomeThreadId(input.instanceId);
  if (designated !== undefined) {
    // Deliberately NOT `getThreadShellById`: that query filters
    // `archived_at IS NULL`, so an archived Home reads as absent and this
    // function would "self-heal" by minting a second Home — stranding the
    // history in the archived one and silently re-pointing the designation.
    // Archiving is a user parking a thread, not destroying it; only a row
    // that is really gone justifies a replacement.
    const existing = yield* readHomeThreadRow(designated);
    if (existing !== undefined) {
      // Un-archive rather than deliver into a hidden thread. A delivery is
      // the agent raising its hand, and the same rule the decider applies to
      // settled/snoozed threads applies here: incoming activity brings the
      // thread back. Best-effort — a failure here must not cost the delivery.
      if (existing.archivedAt !== null) {
        yield* engine
          .dispatch({
            type: "thread.unarchive",
            commandId: CommandId.make(yield* crypto.randomUUIDv4),
            threadId: designated,
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("could not un-archive the home thread", {
                instanceId: input.instanceId,
                threadId: designated,
                cause: Cause.pretty(cause),
              }),
            ),
          );
      }
      return designated;
    }
  }

  const project = yield* getOrCreateAgentProject({
    instanceId: input.instanceId,
    title: input.title,
  });

  const threadId = ThreadId.make(yield* crypto.randomUUIDv4);
  const createdAt = DateTime.formatIso(yield* DateTime.now);

  const dispatched = yield* Effect.result(
    engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      threadId,
      projectId: project.id,
      title: HOME_THREAD_TITLE,
      // The same fixed slug every Hermes thread binds to — the reported model
      // name is display-only, and following it here would orphan the thread
      // whenever Hermes' own config changed.
      modelSelection: { instanceId: input.instanceId, model: DEFAULT_HERMES_MODEL },
      runtimeMode: "full-access",
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt,
    }),
  );

  if (dispatched._tag === "Failure") {
    // A concurrent handshake may have won and already persisted its thread.
    // Re-read before surfacing the error, matching getOrCreateAgentProject.
    const raced = yield* getDesignatedHomeThreadId(input.instanceId);
    if (raced !== undefined) return raced;
    return yield* Effect.fail(dispatched.failure);
  }

  yield* persistHomeThreadId({ instanceId: input.instanceId, threadId, expected: designated });

  // Re-read rather than trusting our own write: if a racing caller persisted
  // first, both callers must agree on one thread, and settings is the
  // tiebreaker. Our orphaned thread stays as an empty thread in the project
  // rather than becoming a second home.
  const settled = yield* getDesignatedHomeThreadId(input.instanceId);
  return settled ?? threadId;
});
