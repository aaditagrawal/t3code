import * as OS from "node:os";
import { Effect, FileSystem, Layer, Path } from "effect";

import {
  WorkspacePaths,
  WorkspacePathOutsideRootError,
  WorkspaceRootNotDirectoryError,
  WorkspaceRootNotExistsError,
  type WorkspacePathsShape,
} from "../Services/WorkspacePaths.ts";

function toPosixRelativePath(input: string): string {
  return input.replaceAll("\\", "/");
}

function expandHomePath(input: string, path: Path.Path): string {
  if (input === "~") {
    return OS.homedir();
  }
  if (input.startsWith("~/") || input.startsWith("~\\")) {
    return path.join(OS.homedir(), input.slice(2));
  }
  return input;
}

export const makeWorkspacePaths = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const normalizeWorkspaceRoot: WorkspacePathsShape["normalizeWorkspaceRoot"] = Effect.fn(
    "WorkspacePaths.normalizeWorkspaceRoot",
  )(function* (workspaceRoot) {
    const trimmedRoot = workspaceRoot.trim();
    if (trimmedRoot.length === 0) {
      return yield* new WorkspaceRootNotExistsError({
        workspaceRoot,
        normalizedWorkspaceRoot: workspaceRoot,
      });
    }
    const normalizedWorkspaceRoot = path.resolve(expandHomePath(trimmedRoot, path));
    const workspaceStat = yield* fileSystem
      .stat(normalizedWorkspaceRoot)
      .pipe(Effect.catch(() => Effect.succeed(null)));
    if (!workspaceStat) {
      return yield* new WorkspaceRootNotExistsError({
        workspaceRoot,
        normalizedWorkspaceRoot,
      });
    }
    if (workspaceStat.type !== "Directory") {
      return yield* new WorkspaceRootNotDirectoryError({
        workspaceRoot,
        normalizedWorkspaceRoot,
      });
    }
    return normalizedWorkspaceRoot;
  });

  const resolveRelativePathWithinRoot: WorkspacePathsShape["resolveRelativePathWithinRoot"] =
    Effect.fn("WorkspacePaths.resolveRelativePathWithinRoot")(function* (input) {
      const normalizedInputPath = input.relativePath.trim();
      if (path.isAbsolute(normalizedInputPath)) {
        return yield* new WorkspacePathOutsideRootError({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
        });
      }

      const absolutePath = path.resolve(input.workspaceRoot, normalizedInputPath);

      // Resolve symlinks: find the deepest existing ancestor and resolve its
      // real path so that symlinked intermediate directories cannot escape the
      // workspace root.
      const realRoot = yield* fileSystem
        .realPath(input.workspaceRoot)
        .pipe(Effect.catch(() => Effect.succeed(input.workspaceRoot)));

      let candidate = absolutePath;
      let realCandidate: string | null = null;
      while (candidate !== path.dirname(candidate)) {
        const resolved = yield* fileSystem
          .realPath(candidate)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (resolved !== null) {
          // Re-append the tail that didn't exist yet.
          const tail = toPosixRelativePath(path.relative(candidate, absolutePath));
          realCandidate = tail ? path.resolve(resolved, tail) : resolved;
          break;
        }
        candidate = path.dirname(candidate);
      }

      const effectivePath = realCandidate ?? absolutePath;
      const relativeToRoot = toPosixRelativePath(path.relative(realRoot, effectivePath));
      if (
        relativeToRoot.length === 0 ||
        relativeToRoot === "." ||
        relativeToRoot.startsWith("../") ||
        relativeToRoot === ".." ||
        path.isAbsolute(relativeToRoot)
      ) {
        return yield* new WorkspacePathOutsideRootError({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
        });
      }

      return {
        absolutePath,
        relativePath: relativeToRoot,
      };
    });

  return {
    normalizeWorkspaceRoot,
    resolveRelativePathWithinRoot,
  } satisfies WorkspacePathsShape;
});

export const WorkspacePathsLive = Layer.effect(WorkspacePaths, makeWorkspacePaths);
