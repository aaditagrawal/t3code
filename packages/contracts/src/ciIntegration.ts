import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const CIRunId = makeEntityId("CIRunId");
export type CIRunId = typeof CIRunId.Type;
export const CIJobId = makeEntityId("CIJobId");
export type CIJobId = typeof CIJobId.Type;

export const CIProvider = Schema.Literals(["github-actions", "gitlab-ci", "custom-webhook"]);
export type CIProvider = typeof CIProvider.Type;

export const CIRunStatus = Schema.Literals([
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);
export type CIRunStatus = typeof CIRunStatus.Type;

export const CIConclusion = Schema.Literals([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "neutral",
]);
export type CIConclusion = typeof CIConclusion.Type;

export const CIJob = Schema.Struct({
  id: CIJobId,
  name: TrimmedNonEmptyString,
  status: CIRunStatus,
  conclusion: Schema.NullOr(CIConclusion),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  logUrl: Schema.NullOr(Schema.String),
  logExcerpt: Schema.NullOr(Schema.String),
});
export type CIJob = typeof CIJob.Type;

export const CIRun = Schema.Struct({
  id: CIRunId,
  projectId: ProjectId,
  threadId: Schema.NullOr(ThreadId),
  turnId: Schema.NullOr(TurnId),
  provider: CIProvider,
  workflowName: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  commitSha: TrimmedNonEmptyString,
  status: CIRunStatus,
  conclusion: Schema.NullOr(CIConclusion),
  jobs: Schema.Array(CIJob),
  htmlUrl: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
  updatedAt: IsoDateTime,
});
export type CIRun = typeof CIRun.Type;

export const CIFeedbackAction = Schema.Literals(["auto-fix", "notify", "ignore"]);
export type CIFeedbackAction = typeof CIFeedbackAction.Type;

export const CIFeedbackPolicy = Schema.Struct({
  projectId: ProjectId,
  onFailure: CIFeedbackAction.pipe(Schema.withDecodingDefault(() => "notify" as const)),
  autoFixMaxAttempts: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 3)),
  watchBranches: Schema.Array(TrimmedNonEmptyString),
});
export type CIFeedbackPolicy = typeof CIFeedbackPolicy.Type;

export const CIGetStatusInput = Schema.Struct({
  projectId: ProjectId,
  threadId: Schema.optional(ThreadId),
  branch: Schema.optional(TrimmedNonEmptyString),
  limit: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 20)),
});
export type CIGetStatusInput = typeof CIGetStatusInput.Type;

export const CIGetStatusResult = Schema.Struct({
  runs: Schema.Array(CIRun),
  hasMore: Schema.Boolean,
});
export type CIGetStatusResult = typeof CIGetStatusResult.Type;

export const CITriggerRerunInput = Schema.Struct({
  runId: CIRunId,
  projectId: ProjectId,
  failedOnly: Schema.Boolean.pipe(Schema.withDecodingDefault(() => true)),
});
export type CITriggerRerunInput = typeof CITriggerRerunInput.Type;

export const CISetFeedbackPolicyInput = Schema.Struct({
  projectId: ProjectId,
  onFailure: CIFeedbackAction,
  autoFixMaxAttempts: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 3)),
  watchBranches: Schema.Array(TrimmedNonEmptyString),
});
export type CISetFeedbackPolicyInput = typeof CISetFeedbackPolicyInput.Type;

export const CIStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("ci.run.updated"), run: CIRun }),
  Schema.Struct({
    type: Schema.Literal("ci.feedback.triggered"),
    runId: CIRunId,
    threadId: ThreadId,
    action: CIFeedbackAction,
    detail: Schema.String,
  }),
]);
export type CIStreamEvent = typeof CIStreamEvent.Type;

export class CIIntegrationError extends Schema.TaggedErrorClass<CIIntegrationError>()(
  "CIIntegrationError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
