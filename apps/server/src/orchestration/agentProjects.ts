/**
 * Agent projects — the synthetic project rows that back directoryless threads.
 *
 * `projection_threads.project_id` is `NOT NULL`, so a thread with a provider
 * that owns its own machine (Hermes) still needs a project row to point at.
 * That row is *synthetic*: its deterministic workspace root is a real but
 * empty directory under `<t3home>/agents/<instanceId>/`. The path is also the
 * stable lookup key, avoiding a Hermes-specific field in core project state.
 *
 * ## Why converge-on-read instead of create-on-enrollment
 *
 * The obvious design is to create the project when an instance enrolls and
 * delete it when the instance is removed. That leaves the system able to reach
 * states it cannot recover from on its own:
 *
 *   - enrollment succeeds but the project dispatch fails → the instance has no
 *     project, forever, and every thread start fails
 *   - instances enrolled before this code shipped have no project at all
 *   - a project soft-deleted by hand (or by a removal that later gets undone)
 *     leaves live threads unopenable
 *
 * `getOrCreateAgentProject` is instead a **precondition every caller runs**,
 * not a lifecycle event one caller owns. It reads, and creates only what is
 * missing. Any of the states above self-heals on the next call, and callers
 * never have to reason about ordering. Enrollment still calls it, but only to
 * warm the row — nothing depends on that call having happened.
 *
 * @module orchestration/agentProjects
 */
import {
  CommandId,
  ProjectId,
  type OrchestrationProject,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";

/** Directory name under `<t3home>` holding one directory per agent instance. */
export const AGENT_WORKSPACE_DIR = "agents";

/**
 * Workspace root for one agent instance.
 *
 * A real directory, not a marker string: `OrchestrationProject.workspaceRoot`
 * is a non-empty string that plenty of code will happily `stat`, and handing
 * it a path that cannot exist would turn a cosmetic problem into a crash.
 */
export function agentWorkspaceRoot(input: {
  readonly baseDir: string;
  readonly instanceId: ProviderInstanceId;
  readonly join: (...parts: ReadonlyArray<string>) => string;
}): string {
  return input.join(input.baseDir, AGENT_WORKSPACE_DIR, input.instanceId);
}

/**
 * Resolve the agent project for one provider instance, creating it if absent.
 *
 * Safe to call on every request: the common path is a single indexed read.
 * Callers should treat this as a precondition rather than a mutation — it is
 * idempotent, and concurrent callers converge on one row (see the recovery
 * read below).
 */
export const getOrCreateAgentProject = Effect.fn("getOrCreateAgentProject")(function* (input: {
  readonly instanceId: ProviderInstanceId;
  /** Instance nickname, used as the project title on first creation. */
  readonly title: string;
}) {
  const query = yield* ProjectionSnapshotQuery;
  const serverConfig = yield* ServerConfig;
  const path = yield* Path.Path;
  const workspaceRoot = agentWorkspaceRoot({
    baseDir: serverConfig.baseDir,
    instanceId: input.instanceId,
    join: path.join,
  });

  const existing = yield* query.getActiveProjectByWorkspaceRoot(workspaceRoot);
  if (Option.isSome(existing)) {
    return existing.value;
  }

  const engine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(workspaceRoot, { recursive: true });

  const projectId = ProjectId.make(yield* crypto.randomUUIDv4);
  const createdAt = DateTime.formatIso(yield* DateTime.now);

  const dispatched = yield* Effect.result(
    engine.dispatch({
      type: "project.create",
      commandId: CommandId.make(yield* crypto.randomUUIDv4),
      projectId,
      title: input.title.trim() || input.instanceId,
      workspaceRoot,
      createWorkspaceRootIfMissing: true,
      createdAt,
    }),
  );

  if (dispatched._tag === "Failure") {
    // The decider rejects a second project on the same workspace root, so a
    // racing caller that won shows up here as a dispatch failure rather than a
    // duplicate row. Re-read before surfacing the error: if the row now
    // exists, the race resolved correctly and this caller can use it.
    const raced = yield* query.getActiveProjectByWorkspaceRoot(workspaceRoot);
    if (Option.isSome(raced)) {
      return raced.value;
    }
    return yield* Effect.fail(dispatched.failure);
  }

  // Read back rather than synthesizing the row locally, so the caller always
  // sees exactly what the projection committed.
  const created = yield* query.getActiveProjectByWorkspaceRoot(workspaceRoot);
  if (Option.isSome(created)) {
    return created.value;
  }

  // The dispatch succeeded but the projection has not caught up. Returning a
  // locally-built row keeps the caller moving; the next call reads the real
  // one. Every field matches what the decider emitted.
  return {
    id: projectId,
    title: input.title.trim() || input.instanceId,
    workspaceRoot,
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  } satisfies OrchestrationProject;
});
