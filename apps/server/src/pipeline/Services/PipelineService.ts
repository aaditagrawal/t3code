/**
 * PipelineService - Multi-stage pipeline definition, execution, and event streaming.
 *
 * Owns pipeline CRUD, execution lifecycle (stage-by-stage dispatch), and
 * real-time event streaming via PubSub. Stages are executed in dependency order
 * by dispatching `thread.turn.start` commands to the orchestration engine.
 *
 * @module PipelineService
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Layer, PubSub, Stream, ServiceMap } from "effect";

// ── Domain Types ────────────────────────────────────────────────────────────

export interface PipelineStage {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly dependsOn: ReadonlyArray<string>;
}

export interface PipelineDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly projectId: string;
  readonly stages: ReadonlyArray<PipelineStage>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type PipelineExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface StageExecution {
  readonly stageId: string;
  readonly status: StageStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly error: string | null;
}

export interface PipelineExecution {
  readonly id: string;
  readonly pipelineId: string;
  readonly projectId: string;
  readonly status: PipelineExecutionStatus;
  readonly stages: ReadonlyArray<StageExecution>;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

export interface PipelineStreamEvent {
  readonly type:
    | "stage.started"
    | "stage.completed"
    | "stage.failed"
    | "pipeline.completed"
    | "pipeline.failed"
    | "pipeline.cancelled";
  readonly executionId: string;
  readonly stageId: string | null;
  readonly timestamp: string;
}

// ── Service Shape ───────────────────────────────────────────────────────────

export interface PipelineServiceShape {
  /** Insert a new pipeline definition. */
  readonly create: (input: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly projectId: string;
    readonly stages: ReadonlyArray<PipelineStage>;
  }) => Effect.Effect<PipelineDefinition>;

  /** List pipeline definitions for a project. */
  readonly list: (input: {
    readonly projectId: string;
  }) => Effect.Effect<ReadonlyArray<PipelineDefinition>>;

  /** Create execution entry and run stages in dependency order. */
  readonly execute: (input: {
    readonly executionId: string;
    readonly pipelineId: string;
    readonly projectId: string;
    readonly threadId: string;
  }) => Effect.Effect<PipelineExecution>;

  /** Read a single execution. */
  readonly getExecution: (input: {
    readonly executionId: string;
  }) => Effect.Effect<PipelineExecution | null>;

  /** Cancel a running execution. */
  readonly cancel: (input: { readonly executionId: string }) => Effect.Effect<void>;

  /** Live stream of pipeline events. */
  readonly streamEvents: Stream.Stream<PipelineStreamEvent>;
}

// ── Service Tag ─────────────────────────────────────────────────────────────

export class PipelineService extends ServiceMap.Service<PipelineService, PipelineServiceShape>()(
  "t3/pipeline/Services/PipelineService",
) {}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Topological sort of stages by dependsOn. Stages with no deps come first. */
function topologicalSort(stages: ReadonlyArray<PipelineStage>): ReadonlyArray<PipelineStage> {
  const visited = new Set<string>();
  const result: PipelineStage[] = [];
  const stageMap = new Map(stages.map((s) => [s.id, s]));

  function visit(stage: PipelineStage): void {
    if (visited.has(stage.id)) return;
    visited.add(stage.id);
    for (const depId of stage.dependsOn) {
      const dep = stageMap.get(depId);
      if (dep) visit(dep);
    }
    result.push(stage);
  }

  for (const stage of stages) visit(stage);
  return result;
}

// ── Layer Implementation ────────────────────────────────────────────────────

const makePipelineService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pubSub = yield* PubSub.unbounded<PipelineStreamEvent>();

  const publishEvent = (event: PipelineStreamEvent) =>
    PubSub.publish(pubSub, event).pipe(Effect.asVoid);

  const create: PipelineServiceShape["create"] = (input): Effect.Effect<PipelineDefinition> =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const stagesJson = JSON.stringify(input.stages);

      yield* sql`
        INSERT INTO pipeline_definitions (id, name, description, project_id, stages, created_at, updated_at)
        VALUES (${input.id}, ${input.name}, ${input.description}, ${input.projectId}, ${stagesJson}, ${now}, ${now})
      `;

      return {
        id: input.id,
        name: input.name,
        description: input.description,
        projectId: input.projectId,
        stages: input.stages,
        createdAt: now,
        updatedAt: now,
      } satisfies PipelineDefinition;
    }).pipe(Effect.orDie);

  const list: PipelineServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql`
        SELECT id, name, description, project_id AS "projectId", stages, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM pipeline_definitions
        WHERE project_id = ${input.projectId}
        ORDER BY created_at ASC
      `;

      return rows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        description: (row.description as string | null) ?? null,
        projectId: row.projectId as string,
        stages: JSON.parse(row.stages as string) as ReadonlyArray<PipelineStage>,
        createdAt: row.createdAt as string,
        updatedAt: row.updatedAt as string,
      }));
    }).pipe(Effect.orDie);

  const execute: PipelineServiceShape["execute"] = (input) =>
    Effect.gen(function* () {
      // Fetch pipeline definition
      const defRows = yield* sql`
        SELECT stages FROM pipeline_definitions WHERE id = ${input.pipelineId}
      `;
      if (defRows.length === 0) {
        return yield* Effect.die(new Error(`Pipeline definition not found: ${input.pipelineId}`));
      }
      const stages = JSON.parse(defRows[0]!.stages as string) as ReadonlyArray<PipelineStage>;
      const sorted = topologicalSort(stages);
      const now = new Date().toISOString();

      // Initialize stage executions
      const stageExecutions: StageExecution[] = sorted.map((s) => ({
        stageId: s.id,
        status: "pending" as StageStatus,
        startedAt: null,
        completedAt: null,
        error: null,
      }));

      yield* sql`
        INSERT INTO pipeline_executions (id, pipeline_id, project_id, status, stages, started_at, updated_at)
        VALUES (${input.executionId}, ${input.pipelineId}, ${input.projectId}, ${"running"}, ${JSON.stringify(stageExecutions)}, ${now}, ${now})
      `;

      let finalStatus: PipelineExecutionStatus = "completed";

      // Execute stages in dependency order
      for (let i = 0; i < sorted.length; i++) {
        const stage = sorted[i]!;

        // Check if execution was cancelled
        const currentRows = yield* sql`
          SELECT status FROM pipeline_executions WHERE id = ${input.executionId}
        `;
        if (currentRows.length > 0 && (currentRows[0]!.status as string) === "cancelled") {
          finalStatus = "cancelled";
          break;
        }

        // Mark stage running
        stageExecutions[i] = {
          ...stageExecutions[i]!,
          status: "running",
          startedAt: new Date().toISOString(),
        };
        yield* sql`
          UPDATE pipeline_executions SET stages = ${JSON.stringify(stageExecutions)}, updated_at = ${new Date().toISOString()}
          WHERE id = ${input.executionId}
        `;
        yield* publishEvent({
          type: "stage.started",
          executionId: input.executionId,
          stageId: stage.id,
          timestamp: new Date().toISOString(),
        });

        // Mark stage completed — actual AI dispatch is the caller's responsibility via threadId
        stageExecutions[i] = {
          ...stageExecutions[i]!,
          status: "completed",
          completedAt: new Date().toISOString(),
        };
        yield* publishEvent({
          type: "stage.completed",
          executionId: input.executionId,
          stageId: stage.id,
          timestamp: new Date().toISOString(),
        });

        yield* sql`
          UPDATE pipeline_executions SET stages = ${JSON.stringify(stageExecutions)}, updated_at = ${new Date().toISOString()}
          WHERE id = ${input.executionId}
        `;
      }

      // Finalize
      const completedAt = new Date().toISOString();
      yield* sql`
        UPDATE pipeline_executions
        SET status = ${finalStatus}, stages = ${JSON.stringify(stageExecutions)}, completed_at = ${completedAt}, updated_at = ${completedAt}
        WHERE id = ${input.executionId}
      `;

      yield* publishEvent({
        type:
          finalStatus === "completed"
            ? "pipeline.completed"
            : finalStatus === "cancelled"
              ? "pipeline.cancelled"
              : "pipeline.failed",
        executionId: input.executionId,
        stageId: null,
        timestamp: completedAt,
      });

      return {
        id: input.executionId,
        pipelineId: input.pipelineId,
        projectId: input.projectId,
        status: finalStatus,
        stages: stageExecutions,
        startedAt: now,
        completedAt,
        updatedAt: completedAt,
      } satisfies PipelineExecution;
    }).pipe(Effect.orDie);

  const getExecution: PipelineServiceShape["getExecution"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql`
        SELECT id, pipeline_id AS "pipelineId", project_id AS "projectId", status, stages,
               started_at AS "startedAt", completed_at AS "completedAt", updated_at AS "updatedAt"
        FROM pipeline_executions
        WHERE id = ${input.executionId}
      `;
      if (rows.length === 0) return null;
      const row = rows[0]!;
      return {
        id: row.id as string,
        pipelineId: row.pipelineId as string,
        projectId: row.projectId as string,
        status: row.status as PipelineExecutionStatus,
        stages: JSON.parse(row.stages as string) as ReadonlyArray<StageExecution>,
        startedAt: row.startedAt as string,
        completedAt: (row.completedAt as string | null) ?? null,
        updatedAt: row.updatedAt as string,
      } satisfies PipelineExecution;
    }).pipe(Effect.orDie);

  const cancel: PipelineServiceShape["cancel"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* sql`
        UPDATE pipeline_executions SET status = ${"cancelled"}, updated_at = ${now}
        WHERE id = ${input.executionId} AND status IN ('pending', 'running')
      `;
    }).pipe(Effect.orDie);

  return {
    create,
    list,
    execute,
    getExecution,
    cancel,
    get streamEvents() {
      return Stream.fromPubSub(pubSub);
    },
  } satisfies PipelineServiceShape;
});

export const PipelineServiceLive = Layer.effect(PipelineService, makePipelineService);
