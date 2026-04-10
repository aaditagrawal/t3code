import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { ModelSelection, ProviderKind, RuntimeMode } from "./orchestration";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const WorkflowTemplateId = makeEntityId("WorkflowTemplateId");
export type WorkflowTemplateId = typeof WorkflowTemplateId.Type;
export const WorkflowStepId = makeEntityId("WorkflowStepId");
export type WorkflowStepId = typeof WorkflowStepId.Type;

export const WorkflowStepKind = Schema.Literals([
  "prompt",
  "shell",
  "git-commit",
  "git-push",
  "create-pr",
  "run-tests",
  "lint",
  "wait-ci",
  "conditional",
]);
export type WorkflowStepKind = typeof WorkflowStepKind.Type;

export const WorkflowVariable = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  defaultValue: Schema.NullOr(Schema.String),
  required: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
});
export type WorkflowVariable = typeof WorkflowVariable.Type;

export const WorkflowStep = Schema.Struct({
  id: WorkflowStepId,
  name: TrimmedNonEmptyString,
  kind: WorkflowStepKind,
  provider: Schema.optional(ProviderKind),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  prompt: Schema.NullOr(Schema.String),
  command: Schema.NullOr(Schema.String),
  condition: Schema.NullOr(Schema.String),
  continueOnError: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  timeoutMs: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 120_000)),
  dependsOn: Schema.Array(WorkflowStepId),
});
export type WorkflowStep = typeof WorkflowStep.Type;

export const WorkflowTemplate = Schema.Struct({
  id: WorkflowTemplateId,
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  category: TrimmedNonEmptyString,
  variables: Schema.Array(WorkflowVariable),
  steps: Schema.Array(WorkflowStep),
  isBuiltIn: Schema.Boolean.pipe(Schema.withDecodingDefault(() => false)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type WorkflowTemplate = typeof WorkflowTemplate.Type;

export const WorkflowListInput = Schema.Struct({
  category: Schema.optional(TrimmedNonEmptyString),
});
export type WorkflowListInput = typeof WorkflowListInput.Type;

export const WorkflowListResult = Schema.Struct({
  templates: Schema.Array(WorkflowTemplate),
});
export type WorkflowListResult = typeof WorkflowListResult.Type;

export const WorkflowCreateInput = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  category: TrimmedNonEmptyString,
  variables: Schema.Array(WorkflowVariable),
  steps: Schema.Array(WorkflowStep),
});
export type WorkflowCreateInput = typeof WorkflowCreateInput.Type;

export const WorkflowDeleteInput = Schema.Struct({
  templateId: WorkflowTemplateId,
});
export type WorkflowDeleteInput = typeof WorkflowDeleteInput.Type;

export const WorkflowExecuteInput = Schema.Struct({
  templateId: WorkflowTemplateId,
  projectId: ProjectId,
  variables: Schema.Record(Schema.String, Schema.String),
});
export type WorkflowExecuteInput = typeof WorkflowExecuteInput.Type;

export class WorkflowError extends Schema.TaggedErrorClass<WorkflowError>()("WorkflowError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}
