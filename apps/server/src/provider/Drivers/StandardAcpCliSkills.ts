/**
 * StandardAcpCliSkills — filesystem discovery of ACP CLI provider skills for
 * the `$` / `/` picker.
 *
 * ACP CLI providers (Hermes Agent, Pi, Fx, ...) load skills from their home
 * directory's `skills/` folder — one directory per skill with a `SKILL.md`
 * carrying YAML frontmatter, the same on-disk layout Claude Code and Codex
 * use. The ACP protocol itself does not advertise skills, so the provider
 * snapshot scans the skills directory directly, mirroring how `ClaudeSkills`
 * and the Codex app-server report their skills.
 *
 * Skills may be nested in category folders (such as `devops/` or `research/`),
 * so every `SKILL.md` found under the skills root is treated as a skill.
 * Discovery is best-effort: unreadable roots and malformed skill entries are
 * skipped so a broken skill never degrades the provider snapshot.
 *
 * @module provider/Drivers/StandardAcpCliSkills
 */
import type { ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

import { expandHomePath } from "../../pathExpansion.ts";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

type SkillFrontmatter =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed" }
  | { readonly kind: "parsed"; readonly name?: string; readonly description?: string };

function parseSkillFrontmatter(contents: string): SkillFrontmatter {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    return { kind: "missing" };
  }

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return { kind: "malformed" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "malformed" };
  }

  const record = parsed as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  return {
    kind: "parsed",
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * Configuration for ACP CLI skills discovery.
 *
 * `homePath` is optional. When unset, the provider home is resolved from the
 * `HERMES_HOME`/`<PROVIDER>_HOME`-style environment variable (see
 * `resolveAcpCliHomePath`), then falls back to `~/.hermes` — matching where
 * the spawned CLI looks for its own config.
 */
export interface StandardAcpCliSkillsConfig {
  readonly homePath?: string | undefined;
}

/**
 * Resolve the ACP CLI provider home directory, honoring:
 *   1. an explicit `homePath` config override,
 *   2. the matching `*_HOME` environment variable (e.g. `HERMES_HOME`),
 *   3. `~/.hermes` as the default.
 *
 * This mirrors the resolution the spawned CLI itself uses so discovery scans
 * the same skills directory the runtime would load.
 */
export const resolveAcpCliHomePath = Effect.fn("resolveAcpCliHomePath")(function* (
  config: StandardAcpCliSkillsConfig,
  environment: NodeJS.ProcessEnv = process.env,
  envVarName = "HERMES_HOME",
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const configured = config.homePath?.trim();
  const inherited = environment[envVarName]?.trim();
  const home = configured || inherited || "~/.hermes";
  return path.resolve(expandHomePath(home));
});

/**
 * Enumerate ACP CLI provider skills from `<home>/skills`, recursing into
 * category folders. Best-effort: unreadable roots and malformed entries are
 * skipped, and later entries win on name collisions.
 *
 * Discovery is opt-in: it only scans when the provider declares a home —
 * either an explicit `homePath` or a `homeEnvVarName` env var. Providers
 * without a declared home (no known `skills/` layout) yield an empty list
 * instead of guessing a directory, so they never scan the wrong location.
 */
export const discoverAcpCliSkills = Effect.fn("discoverAcpCliSkills")(function* (
  config: StandardAcpCliSkillsConfig,
  environment: NodeJS.ProcessEnv = process.env,
  envVarName?: string,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  // Opt-in: no explicit home and no declared env var means we don't know where
  // this provider keeps skills, so don't guess.
  if (!config.homePath?.trim() && !envVarName?.trim()) {
    return [];
  }
  const home = yield* resolveAcpCliHomePath(config, environment, envVarName);
  const skillsRoot = path.join(home, "skills");

  const skillsByName = new Map<string, ServerProviderSkill>();

  const scanDirectory = (
    directory: string,
    scope: "user" | "project",
  ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function* () {
      const entries = yield* fileSystem
        .readDirectory(directory)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

      for (const entry of [...entries].sort()) {
        const entryPath = path.join(directory, entry);
        const skillPath = path.join(entryPath, "SKILL.md");
        const contents = yield* fileSystem
          .readFileString(skillPath)
          .pipe(Effect.orElseSucceed(() => undefined));

        if (contents !== undefined) {
          const frontmatter = parseSkillFrontmatter(contents);
          if (frontmatter.kind !== "malformed") {
            const name =
              (frontmatter.kind === "parsed" ? frontmatter.name : undefined) ?? entry.trim();
            if (name) {
              skillsByName.set(name, {
                name,
                path: skillPath,
                enabled: true,
                scope,
                ...(frontmatter.kind === "parsed" && frontmatter.description
                  ? { description: frontmatter.description }
                  : {}),
              });
            }
          }
        }

        // A directory may be both a skill (has its own SKILL.md) and a
        // category folder (has nested skills). Always recurse so nested
        // skills under a skill directory are found too. Reading a plain file
        // as a directory yields an empty entry list, so this is harmless.
        yield* scanDirectory(entryPath, scope);
      }
    });

  yield* scanDirectory(skillsRoot, "user");

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
