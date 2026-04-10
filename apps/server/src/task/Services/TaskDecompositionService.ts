import type {
  TaskTree,
  TaskNode,
  TaskTreeId,
  TaskId,
  TaskDecomposeInput,
  TaskUpdateStatusInput,
  TaskGetTreeInput,
  TaskListTreesInput,
  TaskListTreesResult,
  TaskExecuteInput,
  TaskStreamEvent,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface TaskDecompositionServiceShape {
  readonly decompose: (input: TaskDecomposeInput) => Effect.Effect<TaskTree>;
  readonly updateStatus: (input: TaskUpdateStatusInput) => Effect.Effect<TaskTree>;
  readonly getTree: (input: TaskGetTreeInput) => Effect.Effect<TaskTree>;
  readonly listTrees: (input: TaskListTreesInput) => Effect.Effect<TaskListTreesResult>;
  readonly execute: (input: TaskExecuteInput) => Effect.Effect<TaskTree>;
  readonly streamEvents: Stream.Stream<TaskStreamEvent>;
}

export class TaskDecompositionService extends ServiceMap.Service<
  TaskDecompositionService,
  TaskDecompositionServiceShape
>()("t3/task/Services/TaskDecompositionService") {}

/**
 * Decomposes a prompt into subtasks using simple heuristic parsing.
 * Each sentence/paragraph becomes a task node; numbered lists become subtasks.
 */
function decomposePromptToTasks(prompt: string, now: string): TaskNode[] {
  const lines = prompt
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const tasks: TaskNode[] = [];
  let order = 0;

  for (const line of lines) {
    const id = crypto.randomUUID() as TaskId;
    const isNumbered = /^\d+[.)]\s/.test(line);
    tasks.push({
      id,
      parentId: null,
      title: line.replace(/^\d+[.)]\s/, "").slice(0, 200),
      description: null,
      status: "pending",
      priority: "medium",
      complexity: line.length > 100 ? "complex" : "simple",
      provider: undefined,
      threadId: null,
      dependsOn: order > 0 && !isNumbered ? [] : [],
      estimatedTokens: null,
      order,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    order++;
  }

  return tasks.length > 0
    ? tasks
    : [
        {
          id: crypto.randomUUID() as TaskId,
          parentId: null,
          title: prompt.slice(0, 200),
          description: null,
          status: "pending",
          priority: "medium",
          complexity: "moderate",
          provider: undefined,
          threadId: null,
          dependsOn: [],
          estimatedTokens: null,
          order: 0,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
      ];
}

const makeTaskDecompositionService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pubsub = yield* PubSub.unbounded<TaskStreamEvent>();

  const persistTree = (tree: TaskTree) =>
    sql`INSERT OR REPLACE INTO task_trees (id, project_id, root_prompt, tasks, status, created_at, updated_at)
      VALUES (${tree.id}, ${tree.projectId}, ${tree.rootPrompt}, ${JSON.stringify(tree.tasks)}, ${tree.status}, ${tree.createdAt}, ${tree.updatedAt})`;

  const readTree = (id: string): Effect.Effect<TaskTree> =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        id: string;
        project_id: string;
        root_prompt: string;
        tasks: string;
        status: string;
        created_at: string;
        updated_at: string;
      }>`SELECT * FROM task_trees WHERE id = ${id}`;
      const row = rows[0];
      if (!row) return yield* Effect.die(new Error(`Task tree ${id} not found`));
      return {
        id: row.id as TaskTreeId,
        projectId: row.project_id as TaskTree["projectId"],
        rootPrompt: row.root_prompt as TaskTree["rootPrompt"],
        tasks: JSON.parse(row.tasks) as TaskNode[],
        status: row.status as TaskTree["status"],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }).pipe(Effect.orDie);

  const decompose: TaskDecompositionServiceShape["decompose"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const id = crypto.randomUUID() as TaskTreeId;
      const tasks = decomposePromptToTasks(input.prompt, now);
      const tree: TaskTree = {
        id,
        projectId: input.projectId,
        rootPrompt: input.prompt,
        tasks,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      yield* persistTree(tree);
      yield* PubSub.publish(pubsub, { type: "task.tree.updated" as const, tree });
      return tree;
    }).pipe(Effect.orDie);

  const updateStatus: TaskDecompositionServiceShape["updateStatus"] = (input) =>
    Effect.gen(function* () {
      const tree = yield* readTree(input.treeId);
      const now = new Date().toISOString();
      const updatedTasks = tree.tasks.map((t) =>
        t.id === input.taskId
          ? {
              ...t,
              status: input.status,
              updatedAt: now,
              completedAt: input.status === "completed" ? now : t.completedAt,
            }
          : t,
      );
      const allDone = updatedTasks.every((t) => t.status === "completed" || t.status === "skipped");
      const anyFailed = updatedTasks.some((t) => t.status === "failed");
      const treeStatus = allDone ? "completed" : anyFailed ? "failed" : "in-progress";
      const updatedTree: TaskTree = {
        ...tree,
        tasks: updatedTasks,
        status: treeStatus as TaskTree["status"],
        updatedAt: now,
      };
      yield* persistTree(updatedTree);
      const updatedNode = updatedTasks.find((t) => t.id === input.taskId)!;
      yield* PubSub.publish(pubsub, {
        type: "task.node.updated" as const,
        treeId: input.treeId,
        node: updatedNode,
      });
      yield* PubSub.publish(pubsub, { type: "task.tree.updated" as const, tree: updatedTree });
      return updatedTree;
    }).pipe(Effect.orDie);

  const getTree: TaskDecompositionServiceShape["getTree"] = (input) => readTree(input.treeId);

  const listTrees: TaskDecompositionServiceShape["listTrees"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        id: string;
        project_id: string;
        root_prompt: string;
        tasks: string;
        status: string;
        created_at: string;
        updated_at: string;
      }>`SELECT * FROM task_trees WHERE project_id = ${input.projectId} ORDER BY created_at DESC`;
      return {
        trees: rows.map((r) => ({
          id: r.id as TaskTreeId,
          projectId: r.project_id as TaskTree["projectId"],
          rootPrompt: r.root_prompt as TaskTree["rootPrompt"],
          tasks: JSON.parse(r.tasks) as TaskNode[],
          status: r.status as TaskTree["status"],
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    }).pipe(Effect.orDie);

  const execute: TaskDecompositionServiceShape["execute"] = (input) =>
    Effect.gen(function* () {
      const tree = yield* readTree(input.treeId);
      const now = new Date().toISOString();
      const tasksToRun = input.taskId
        ? tree.tasks.filter((t) => t.id === input.taskId)
        : tree.tasks.filter((t) => t.status === "pending");

      const updatedTasks = tree.tasks.map((t) =>
        tasksToRun.some((r) => r.id === t.id)
          ? { ...t, status: "in-progress" as const, updatedAt: now }
          : t,
      );
      const updatedTree: TaskTree = {
        ...tree,
        tasks: updatedTasks,
        status: "in-progress",
        updatedAt: now,
      };
      yield* persistTree(updatedTree);
      yield* PubSub.publish(pubsub, { type: "task.tree.updated" as const, tree: updatedTree });
      return updatedTree;
    }).pipe(Effect.orDie);

  return {
    decompose,
    updateStatus,
    getTree,
    listTrees,
    execute,
    streamEvents: Stream.fromPubSub(pubsub),
  };
});

export const TaskDecompositionServiceLive = Layer.effect(
  TaskDecompositionService,
  makeTaskDecompositionService,
);
