import * as NodeOS from "node:os";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Effect Path has no glob matching API.
import * as NodePath from "node:path";

import type { ServerProviderSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

const CONFIG_FILENAMES = ["config.yml", "config.yaml"] as const;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseYamlRecord(contents: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = parseYamlDocument(contents);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringList(value: unknown): ReadonlyArray<string> {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** Resolve omp's agent directory, which owns both config.yml and skills/. */
export const resolveOhMyPiHomePath = Effect.fn("OhMyPiSkills.resolveHomePath")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const userHome = environment.HOME || environment.USERPROFILE || NodeOS.homedir();
  const root = path.join(userHome, environment.PI_CONFIG_DIR || ".omp");
  const profile = (environment.OMP_PROFILE ?? environment.PI_PROFILE)?.trim();
  // omp selects a named profile before considering the default agent-dir override.
  if (profile && profile !== "default") return path.join(root, "profiles", profile, "agent");
  const configured = environment.PI_CODING_AGENT_DIR;
  return configured ? path.resolve(configured) : path.join(root, "agent");
});

const readOhMyPiConfig = Effect.fn("OhMyPiSkills.readConfig")(function* (
  agentDir: string,
): Effect.fn.Return<Record<string, unknown>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  for (const filename of CONFIG_FILENAMES) {
    const contents = yield* fileSystem
      .readFileString(path.join(agentDir, filename))
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents !== undefined) return parseYamlRecord(contents) ?? {};
  }
  return {};
});

export const discoverOhMyPiSkills = Effect.fn("discoverOhMyPiSkills")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const agentDir = yield* resolveOhMyPiHomePath(environment);
  const config = yield* readOhMyPiConfig(agentDir);
  const settings = isRecord(config.skills) ? config.skills : {};
  if (settings.enabled === false) return [];
  const ignored = stringList(settings.ignoredSkills);
  const included = stringList(settings.includeSkills);
  const disabled = new Set(
    stringList(config.disabledExtensions)
      .filter((id) => id.startsWith("skill:"))
      .map((id) => id.slice("skill:".length)),
  );
  const userHome = environment.HOME || environment.USERPROFILE || NodeOS.homedir();
  const customRoots = stringList(settings.customDirectories).map((directory) =>
    directory === "~"
      ? userHome
      : directory.startsWith("~/")
        ? path.join(userHome, directory.slice(2))
        : path.resolve(directory),
  );
  // Explicit custom directories override native skills, as they do in omp.
  const roots = [
    ...customRoots,
    ...(settings.enablePiUser === false ? [] : [path.join(agentDir, "skills")]),
  ];
  const skillsByName = new Map<string, ServerProviderSkill>();
  const visitedFiles = new Set<string>();
  for (const root of roots) {
    const entries = yield* fileSystem
      .readDirectory(root)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    // omp scans immediate skill directories, not arbitrary nested support trees.
    for (const entry of [...entries].sort()) {
      if (entry.startsWith(".")) continue;
      const skillPath = path.join(root, entry, "SKILL.md");
      const contents = yield* fileSystem
        .readFileString(skillPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (contents === undefined) continue;
      const match = FRONTMATTER_PATTERN.exec(contents.replace(/^\uFEFF/, ""));
      const frontmatter = match ? parseYamlRecord(match[1] ?? "") : undefined;
      if (!frontmatter || frontmatter.enabled === false) continue;
      const description =
        typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
      if (!description) continue;
      const name =
        typeof frontmatter.name === "string" && frontmatter.name.trim()
          ? frontmatter.name.trim()
          : entry;
      if (
        disabled.has(name) ||
        ignored.some((pattern) => NodePath.matchesGlob(name, pattern)) ||
        (included.length > 0 && !included.some((pattern) => NodePath.matchesGlob(name, pattern))) ||
        skillsByName.has(name)
      )
        continue;
      const canonical = yield* fileSystem
        .realPath(skillPath)
        .pipe(Effect.orElseSucceed(() => skillPath));
      if (visitedFiles.has(canonical)) continue;
      visitedFiles.add(canonical);
      skillsByName.set(name, { name, description, path: skillPath, enabled: true, scope: "user" });
    }
  }
  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
