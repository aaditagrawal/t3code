import * as NodeOS from "node:os";

import type { ClaudeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

/**
 * Effective Claude config directory for `CLAUDE_CONFIG_DIR` and
 * continuation/cache keys.
 *
 * Persisted `homePath` values historically meant a HOME override (Claude used
 * `$HOME/.claude`). Paths whose basename is already `.claude` are treated as
 * the config dir itself. An empty `homePath` maps to the default `~/.claude`.
 */
export const resolveClaudeConfigDir = Effect.fn("resolveClaudeConfigDir")(function* (
  config: Pick<ClaudeSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  if (homePath.length === 0) {
    return path.resolve(path.join(NodeOS.homedir(), ".claude"));
  }
  const resolvedHomePath = path.resolve(expandHomePath(homePath));
  if (path.basename(resolvedHomePath) === ".claude") {
    return resolvedHomePath;
  }
  // Legacy HOME override layout: config lived under `$HOME/.claude`.
  return path.join(resolvedHomePath, ".claude");
});

export const resolveClaudeHomePath = Effect.fn("resolveClaudeHomePath")(function* (
  config: Pick<ClaudeSettings, "homePath">,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const homePath = config.homePath.trim();
  return path.resolve(homePath.length > 0 ? expandHomePath(homePath) : NodeOS.homedir());
});

export const makeClaudeEnvironment = Effect.fn("makeClaudeEnvironment")(function* (
  config: Pick<ClaudeSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const homePath = config.homePath.trim();
  if (homePath.length === 0) return resolvedBaseEnv;
  const configDir = yield* resolveClaudeConfigDir(config);
  return {
    ...resolvedBaseEnv,
    // Isolate this instance's config via CLAUDE_CONFIG_DIR rather than HOME.
    // Overriding HOME also relocates the macOS login keychain lookup
    // ($HOME/Library/Keychains), so the spawned CLI can't find its stored
    // OAuth credentials and reports "Not logged in". CLAUDE_CONFIG_DIR points
    // Claude Code at its config dir directly while leaving HOME (and the
    // keychain) intact.
    //
    // Persisted homePath values historically meant a HOME override, so Claude
    // used `$HOME/.claude`. When the configured path is not already a `.claude`
    // config dir, append `.claude` to preserve that layout.
    CLAUDE_CONFIG_DIR: configDir,
  };
});

export const makeClaudeContinuationGroupKey = Effect.fn("makeClaudeContinuationGroupKey")(
  function* (config: Pick<ClaudeSettings, "homePath">): Effect.fn.Return<string, never, Path.Path> {
    const configDir = yield* resolveClaudeConfigDir(config);
    return `claude:home:${configDir}`;
  },
);

export const makeClaudeCapabilitiesCacheKey = Effect.fn("makeClaudeCapabilitiesCacheKey")(
  function* (
    config: Pick<ClaudeSettings, "binaryPath" | "homePath">,
  ): Effect.fn.Return<string, never, Path.Path> {
    const configDir = yield* resolveClaudeConfigDir(config);
    return `${config.binaryPath}\0${configDir}`;
  },
);
