/**
 * CIIntegrationService - Service interface for CI pipeline integration.
 *
 * Tracks CI runs, manages feedback policies for automated responses to
 * failures, and exposes a live event stream for CI status updates.
 *
 * @module CIIntegrationService
 */
import type {
  CIFeedbackPolicy,
  CIGetStatusInput,
  CIGetStatusResult,
  CIRun,
  CIRunId,
  CISetFeedbackPolicyInput,
  CIStreamEvent,
  CITriggerRerunInput,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface CIIntegrationServiceShape {
  /**
   * Query CI run status with project/thread/branch filters.
   */
  readonly getStatus: (input: CIGetStatusInput) => Effect.Effect<CIGetStatusResult>;

  /**
   * Record or update a CI run entry.
   */
  readonly recordRun: (run: CIRun) => Effect.Effect<CIRun>;

  /**
   * Trigger a re-run of a CI pipeline. Records an audit-style activity
   * event and returns the run being re-triggered.
   */
  readonly triggerRerun: (input: CITriggerRerunInput) => Effect.Effect<CIRun>;

  /**
   * Create or update the feedback policy for a project.
   */
  readonly setFeedbackPolicy: (input: CISetFeedbackPolicyInput) => Effect.Effect<CIFeedbackPolicy>;

  /**
   * Retrieve the feedback policy for a project, if one exists.
   */
  readonly getFeedbackPolicy: (projectId: string) => Effect.Effect<CIFeedbackPolicy | null>;

  /**
   * Live stream of CI events (run updates, feedback triggers).
   *
   * Each access creates a fresh PubSub subscription so multiple consumers
   * independently receive all events.
   */
  readonly streamEvents: Stream.Stream<CIStreamEvent>;
}

export class CIIntegrationService extends ServiceMap.Service<
  CIIntegrationService,
  CIIntegrationServiceShape
>()("t3/ci/Services/CIIntegrationService") {}

const makeCIIntegrationService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pubsub = yield* PubSub.unbounded<CIStreamEvent>();

  const runFromRow = (r: Record<string, unknown>): CIRun => ({
    id: r["id"] as CIRunId,
    projectId: r["project_id"] as CIRun["projectId"],
    threadId: (r["thread_id"] ?? null) as CIRun["threadId"],
    turnId: (r["turn_id"] ?? null) as CIRun["turnId"],
    provider: r["provider"] as CIRun["provider"],
    workflowName: r["workflow_name"] as CIRun["workflowName"],
    branch: r["branch"] as CIRun["branch"],
    commitSha: r["commit_sha"] as CIRun["commitSha"],
    status: r["status"] as CIRun["status"],
    conclusion: (r["conclusion"] ?? null) as CIRun["conclusion"],
    jobs: JSON.parse(r["jobs"] as string),
    htmlUrl: (r["html_url"] ?? null) as CIRun["htmlUrl"],
    startedAt: r["started_at"] as string,
    completedAt: (r["completed_at"] ?? null) as CIRun["completedAt"],
    updatedAt: r["updated_at"] as string,
  });

  const getStatus: CIIntegrationServiceShape["getStatus"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql.unsafe<Record<string, unknown>>(
        `SELECT * FROM ci_runs WHERE project_id = ?${input.threadId ? " AND thread_id = ?" : ""}${input.branch ? " AND branch = ?" : ""} ORDER BY started_at DESC LIMIT ?`,
        [
          input.projectId,
          ...(input.threadId ? [input.threadId] : []),
          ...(input.branch ? [input.branch] : []),
          input.limit,
        ],
      );
      return { runs: rows.map(runFromRow), hasMore: rows.length === input.limit } as const;
    }).pipe(Effect.orDie);

  const recordRun: CIIntegrationServiceShape["recordRun"] = (run) =>
    Effect.gen(function* () {
      yield* sql`INSERT OR REPLACE INTO ci_runs (id, project_id, thread_id, turn_id, provider, workflow_name, branch, commit_sha, status, conclusion, jobs, html_url, started_at, completed_at, updated_at)
        VALUES (${run.id}, ${run.projectId}, ${run.threadId}, ${run.turnId}, ${run.provider}, ${run.workflowName}, ${run.branch}, ${run.commitSha}, ${run.status}, ${run.conclusion}, ${JSON.stringify(run.jobs)}, ${run.htmlUrl}, ${run.startedAt}, ${run.completedAt}, ${run.updatedAt})`;
      yield* PubSub.publish(pubsub, { type: "ci.run.updated" as const, run });
      return run;
    }).pipe(Effect.orDie);

  const triggerRerun: CIIntegrationServiceShape["triggerRerun"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<
        Record<string, unknown>
      >`SELECT * FROM ci_runs WHERE id = ${input.runId}`;
      const run = rows[0];
      if (!run) return yield* Effect.fail(new Error(`CI run ${input.runId} not found`));
      const now = new Date().toISOString();
      const requeued = {
        ...runFromRow(run),
        status: "queued" as const,
        conclusion: null,
        updatedAt: now,
      };
      yield* recordRun(requeued);
      return requeued;
    }).pipe(Effect.orDie);

  const setFeedbackPolicy: CIIntegrationServiceShape["setFeedbackPolicy"] = (input) =>
    Effect.gen(function* () {
      yield* sql`INSERT OR REPLACE INTO ci_feedback_policies (project_id, on_failure, auto_fix_max_attempts, watch_branches)
        VALUES (${input.projectId}, ${input.onFailure}, ${input.autoFixMaxAttempts}, ${JSON.stringify(input.watchBranches)})`;
      return {
        projectId: input.projectId,
        onFailure: input.onFailure,
        autoFixMaxAttempts: input.autoFixMaxAttempts,
        watchBranches: input.watchBranches,
      } satisfies CIFeedbackPolicy;
    }).pipe(Effect.orDie);

  const getFeedbackPolicy: CIIntegrationServiceShape["getFeedbackPolicy"] = (projectId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        project_id: string;
        on_failure: string;
        auto_fix_max_attempts: number;
        watch_branches: string;
      }>`SELECT * FROM ci_feedback_policies WHERE project_id = ${projectId}`;
      const row = rows[0];
      if (!row) return null;
      return {
        projectId: row.project_id as CIFeedbackPolicy["projectId"],
        onFailure: row.on_failure as CIFeedbackPolicy["onFailure"],
        autoFixMaxAttempts: row.auto_fix_max_attempts,
        watchBranches: JSON.parse(row.watch_branches),
      } satisfies CIFeedbackPolicy;
    }).pipe(Effect.orDie);

  return {
    getStatus,
    recordRun,
    triggerRerun,
    setFeedbackPolicy,
    getFeedbackPolicy,
    streamEvents: Stream.fromPubSub(pubsub),
  };
});

export const CIIntegrationServiceLive = Layer.effect(
  CIIntegrationService,
  makeCIIntegrationService,
);
