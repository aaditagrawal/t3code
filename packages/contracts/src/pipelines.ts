import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ModelSelection, ProviderKind, RuntimeMode } from "./orchestration";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const PipelineId = makeEntityId("PipelineId");
export type PipelineId = typeof PipelineId.Type;
export const PipelineStageId = makeEntityId("PipelineStageId");
export type PipelineStageId = typeof PipelineStageId.Type;
export const PipelineExecutionId = makeEntityId("PipelineExecutionId");
export type PipelineExecutionId = typeof PipelineExecutionId.Type;

export const PipelineStageKind = Schema.Literals([
  "agent-task",
  "review",
  "test",
  "gate",
  "parallel-fan-out",
]);
export type PipelineStageKind = typeof PipelineStageKind.Type;

export const PipelineStageStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
  "waiting-approval",
]);
export type PipelineStageStatus = typeof PipelineStageStatus.Type;

export const PipelineStage = Schema.Struct({
  id: PipelineStageId,
  name: TrimmedNonEmptyString,
  kind: PipelineStageKind,
  provider: Schema.optional(ProviderKind),
  modelSelection: Schema.optional(ModelSelection),
  prompt: TrimmedNonEmptyString,
  dependsOn: Schema.Array(PipelineStageId),
  runtimeMode: Schema.optional(RuntimeMode),
  timeoutMs: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 300_000)),
  retryOnFailure: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  maxRetries: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 1)),
});
export type PipelineStage = typeof PipelineStage.Type;

export const PipelineDefinition = Schema.Struct({
  id: PipelineId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  projectId: ProjectId,
  stages: Schema.Array(PipelineStage),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PipelineDefinition = typeof PipelineDefinition.Type;

export const PipelineExecutionStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type PipelineExecutionStatus = typeof PipelineExecutionStatus.Type;

export const PipelineStageExecution = Schema.Struct({
  stageId: PipelineStageId,
  status: PipelineStageStatus,
  threadId: Schema.NullOr(ThreadId),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  error: Schema.NullOr(Schema.String),
  retryCount: NonNegativeInt,
  output: Schema.NullOr(Schema.String),
});
export type PipelineStageExecution = typeof PipelineStageExecution.Type;

export const PipelineExecution = Schema.Struct({
  id: PipelineExecutionId,
  pipelineId: PipelineId,
  projectId: ProjectId,
  status: PipelineExecutionStatus,
  stages: Schema.Array(PipelineStageExecution),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type PipelineExecution = typeof PipelineExecution.Type;

export const PipelineCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  projectId: ProjectId,
  stages: Schema.Array(PipelineStage),
});
export type PipelineCreateInput = typeof PipelineCreateInput.Type;

export const PipelineExecuteInput = Schema.Struct({
  pipelineId: PipelineId,
  projectId: ProjectId,
});
export type PipelineExecuteInput = typeof PipelineExecuteInput.Type;

export const PipelineListInput = Schema.Struct({
  projectId: ProjectId,
});
export type PipelineListInput = typeof PipelineListInput.Type;

export const PipelineListResult = Schema.Struct({
  pipelines: Schema.Array(PipelineDefinition),
});
export type PipelineListResult = typeof PipelineListResult.Type;

export const PipelineGetExecutionInput = Schema.Struct({
  executionId: PipelineExecutionId,
});
export type PipelineGetExecutionInput = typeof PipelineGetExecutionInput.Type;

export const PipelineCancelInput = Schema.Struct({
  executionId: PipelineExecutionId,
});
export type PipelineCancelInput = typeof PipelineCancelInput.Type;

export const PipelineStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("pipeline.execution.updated"),
    execution: PipelineExecution,
  }),
  Schema.Struct({
    type: Schema.Literal("pipeline.stage.updated"),
    executionId: PipelineExecutionId,
    stage: PipelineStageExecution,
  }),
]);
export type PipelineStreamEvent = typeof PipelineStreamEvent.Type;

export class PipelineError extends Schema.TaggedErrorClass<PipelineError>()("PipelineError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}
