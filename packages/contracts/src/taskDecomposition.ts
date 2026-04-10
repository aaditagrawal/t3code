import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ProviderKind } from "./orchestration";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const TaskId = makeEntityId("TaskId");
export type TaskId = typeof TaskId.Type;
export const TaskTreeId = makeEntityId("TaskTreeId");
export type TaskTreeId = typeof TaskTreeId.Type;

export const TaskStatus = Schema.Literals([
  "pending",
  "in-progress",
  "completed",
  "failed",
  "blocked",
  "skipped",
]);
export type TaskStatus = typeof TaskStatus.Type;

export const TaskPriority = Schema.Literals(["low", "medium", "high", "critical"]);
export type TaskPriority = typeof TaskPriority.Type;

export const TaskComplexity = Schema.Literals(["trivial", "simple", "moderate", "complex"]);
export type TaskComplexity = typeof TaskComplexity.Type;

export const TaskNode = Schema.Struct({
  id: TaskId,
  parentId: Schema.NullOr(TaskId),
  title: TrimmedNonEmptyString,
  description: Schema.NullOr(Schema.String),
  status: TaskStatus,
  priority: TaskPriority,
  complexity: TaskComplexity,
  provider: Schema.optional(ProviderKind),
  threadId: Schema.NullOr(ThreadId),
  dependsOn: Schema.Array(TaskId),
  estimatedTokens: Schema.NullOr(NonNegativeInt),
  order: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime),
});
export type TaskNode = typeof TaskNode.Type;

export const TaskTree = Schema.Struct({
  id: TaskTreeId,
  projectId: ProjectId,
  rootPrompt: TrimmedNonEmptyString,
  tasks: Schema.Array(TaskNode),
  status: TaskStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskTree = typeof TaskTree.Type;

export const TaskDecomposeInput = Schema.Struct({
  projectId: ProjectId,
  prompt: TrimmedNonEmptyString,
  provider: Schema.optional(ProviderKind),
  maxDepth: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 3)),
});
export type TaskDecomposeInput = typeof TaskDecomposeInput.Type;

export const TaskUpdateStatusInput = Schema.Struct({
  treeId: TaskTreeId,
  taskId: TaskId,
  status: TaskStatus,
});
export type TaskUpdateStatusInput = typeof TaskUpdateStatusInput.Type;

export const TaskGetTreeInput = Schema.Struct({
  treeId: TaskTreeId,
});
export type TaskGetTreeInput = typeof TaskGetTreeInput.Type;

export const TaskListTreesInput = Schema.Struct({
  projectId: ProjectId,
});
export type TaskListTreesInput = typeof TaskListTreesInput.Type;

export const TaskListTreesResult = Schema.Struct({
  trees: Schema.Array(TaskTree),
});
export type TaskListTreesResult = typeof TaskListTreesResult.Type;

export const TaskExecuteInput = Schema.Struct({
  treeId: TaskTreeId,
  taskId: Schema.optional(TaskId),
});
export type TaskExecuteInput = typeof TaskExecuteInput.Type;

export const TaskStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("task.tree.updated"), tree: TaskTree }),
  Schema.Struct({
    type: Schema.Literal("task.node.updated"),
    treeId: TaskTreeId,
    node: TaskNode,
  }),
]);
export type TaskStreamEvent = typeof TaskStreamEvent.Type;

export class TaskDecompositionError extends Schema.TaggedErrorClass<TaskDecompositionError>()(
  "TaskDecompositionError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
