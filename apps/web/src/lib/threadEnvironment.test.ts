// @ts-nocheck
// Skipped: depends on @t3tools/shared/threadEnvironment and @t3tools/shared/threadWorkspace
// which are not yet ported to this fork.
import { describe, it } from "vitest";

describe.skip("threadEnvironment", () => {
  it.skip("keeps a worktree fork into local on the same worktree", () => {});
  it.skip("keeps a local fork into local on the root checkout", () => {});
  it.skip("plans a new worktree fork without reusing the source path", () => {});
});
