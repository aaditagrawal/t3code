import * as NodeOS from "node:os";

import type { ServerProviderSkill } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";

import { expandHomePath } from "../../pathExpansion.ts";

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".github",
  ".hub",
  ".archive",
  ".venv",
  "venv",
  "node_modules",
  "site-packages",
  "__pycache__",
  ".tox",
  ".nox",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);
const SUPPORT_DIRECTORIES = new Set(["references", "templates", "assets", "scripts"]);
const KNOWN_ENVIRONMENTS = new Set(["docker", "s6"]);
const ORG_DIRECTORY = "_org";
const ACTIVE_ORG_FILE = ".active_org";
const CONFIG_FILENAMES = ["config.yml", "config.yaml"] as const;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const DEFAULT_CONFIG_DIR_NAME = ".omp";

interface SkillFrontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly platforms: ReadonlyArray<string>;
  readonly environments: ReadonlyArray<string>;
}

interface OhMyPiConfig {
  readonly disabledSkills: ReadonlySet<string>;
  readonly externalSkillDirectories: ReadonlyArray<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStringList(value: unknown): ReadonlyArray<string> {
  if (Array.isArray(value)) {
    return value.flatMap((entry) =>
      typeof entry === "string" && entry.trim() ? [entry.trim()] : [],
    );
  }
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = parseYamlDocument(trimmed);
      if (Array.isArray(parsed)) return parseStringList(parsed);
    } catch {
      return [trimmed];
    }
  }
  return [trimmed];
}

function parseSkillFrontmatter(contents: string): SkillFrontmatter | undefined {
  const normalized = contents.startsWith("\uFEFF") ? contents.slice(1) : contents;
  const match = FRONTMATTER_PATTERN.exec(normalized);
  if (!match) return { platforms: [], environments: [] };

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const description = typeof parsed.description === "string" ? parsed.description.trim() : "";
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    platforms: parseStringList(parsed.platforms),
    environments: parseStringList(parsed.environments),
  };
}

function parseYamlRecord(contents: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = parseYamlDocument(contents);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function matchesPlatform(platforms: ReadonlyArray<string>, hostPlatform: NodeJS.Platform): boolean {
  if (platforms.length === 0) return true;
  const aliases: Readonly<Record<string, NodeJS.Platform>> = {
    macos: "darwin",
    linux: "linux",
    windows: "win32",
  };
  return platforms.some(
    (platform) => (aliases[platform.toLowerCase()] ?? platform) === hostPlatform,
  );
}

const detectContainer = Effect.fn("OhMyPiSkills.detectContainer")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem> {
  if (environment.KUBERNETES_SERVICE_HOST?.trim()) return true;
  const fileSystem = yield* FileSystem.FileSystem;
  for (const marker of ["/.dockerenv", "/run/.containerenv"]) {
    if (yield* fileSystem.exists(marker).pipe(Effect.orElseSucceed(() => false))) return true;
  }
  for (const file of ["/proc/1/cgroup", "/proc/self/mountinfo"]) {
    const contents = yield* fileSystem.readFileString(file).pipe(Effect.orElseSucceed(() => ""));
    if (
      ["docker", "podman", "/lxc/", "kubepods", "containerd", "crio"].some((marker) =>
        contents.includes(marker),
      )
    ) {
      return true;
    }
  }
  return false;
});

const matchesEnvironment = Effect.fn("OhMyPiSkills.matchesEnvironment")(function* (
  environments: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<boolean, never, FileSystem.FileSystem> {
  if (environments.length === 0) return true;
  const fileSystem = yield* FileSystem.FileSystem;
  for (const value of environments) {
    const normalized = value.toLowerCase();
    if (!KNOWN_ENVIRONMENTS.has(normalized)) return true;
    if (normalized === "docker" && (yield* detectContainer(environment))) return true;
    if (
      normalized === "s6" &&
      ((yield* fileSystem.exists("/run/s6").pipe(Effect.orElseSucceed(() => false))) ||
        (yield* fileSystem
          .exists("/package/admin/s6-overlay")
          .pipe(Effect.orElseSucceed(() => false))))
    ) {
      return true;
    }
  }
  return false;
});

/**
 * Resolve the Oh My Pi home used for skill discovery.
 *
 * `PI_CODING_AGENT_DIR` is the existing omp agent-dir override and is treated
 * like Hermes's `HERMES_HOME`. Otherwise the home is `~/.omp`, or
 * `~/<PI_CONFIG_DIR>` when that name override is set. Named `OMP_PROFILE` /
 * `PI_PROFILE` values select `profiles/<name>` under that home.
 */
export const resolveOhMyPiHomePath = Effect.fn("OhMyPiSkills.resolveHomePath")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const configured = environment.PI_CODING_AGENT_DIR?.trim();
  if (configured) return path.resolve(configured);
  const configDirName = environment.PI_CONFIG_DIR?.trim() || DEFAULT_CONFIG_DIR_NAME;
  const root = path.join(NodeOS.homedir(), configDirName);
  const profile = (environment.OMP_PROFILE ?? environment.PI_PROFILE)?.trim();
  if (profile && profile !== "default") return path.join(root, "profiles", profile);
  return root;
});

function expandEnvironmentVariables(value: string, environment: NodeJS.ProcessEnv): string {
  return value.replace(
    /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (match, braced: string | undefined, plain: string | undefined) => {
      const name = braced ?? plain;
      return name ? (environment[name] ?? match) : match;
    },
  );
}

const readOhMyPiConfig = Effect.fn("OhMyPiSkills.readConfig")(function* (
  home: string,
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<OhMyPiConfig, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let contents = "";
  for (const filename of CONFIG_FILENAMES) {
    contents = yield* fileSystem
      .readFileString(path.join(home, filename))
      .pipe(Effect.orElseSucceed(() => ""));
    if (contents) break;
  }
  if (!contents) return { disabledSkills: new Set(), externalSkillDirectories: [] };

  const parsed = parseYamlRecord(contents);
  if (!parsed || !isRecord(parsed.skills)) {
    return { disabledSkills: new Set(), externalSkillDirectories: [] };
  }

  const disabledSkills = new Set(parseStringList(parsed.skills.disabled));
  const externalSkillDirectories = parseStringList(parsed.skills.external_dirs).map((directory) => {
    const expanded = expandHomePath(expandEnvironmentVariables(directory, environment));
    return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(home, expanded);
  });
  return { disabledSkills, externalSkillDirectories };
});

export const discoverOhMyPiSkills = Effect.fn("discoverOhMyPiSkills")(function* (
  environment: NodeJS.ProcessEnv,
): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hostPlatform = yield* HostProcessPlatform;
  const home = yield* resolveOhMyPiHomePath(environment);
  const config = yield* readOhMyPiConfig(home, environment);
  const roots = [
    path.join(home, "agent", "skills"),
    path.join(home, "skills"),
    ...config.externalSkillDirectories,
  ];
  const skillsByName = new Map<string, ServerProviderSkill>();
  const visitedDirectories = new Set<string>();

  const scanDirectory = (
    directory: string,
    root: string,
    activeOrg: string | undefined,
  ): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function* () {
      const canonical = yield* fileSystem
        .realPath(directory)
        .pipe(Effect.orElseSucceed(() => directory));
      if (visitedDirectories.has(canonical)) return;
      visitedDirectories.add(canonical);

      const skillPath = path.join(directory, "SKILL.md");
      const contents = yield* fileSystem
        .readFileString(skillPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      const frontmatter = contents === undefined ? undefined : parseSkillFrontmatter(contents);
      if (
        contents !== undefined &&
        frontmatter !== undefined &&
        matchesPlatform(frontmatter.platforms, hostPlatform) &&
        (yield* matchesEnvironment(frontmatter.environments, environment))
      ) {
        const name = frontmatter.name ?? path.basename(directory).trim();
        if (name && !config.disabledSkills.has(name) && !skillsByName.has(name)) {
          skillsByName.set(name, {
            name,
            path: skillPath,
            enabled: true,
            scope: "user",
            ...(frontmatter.description ? { description: frontmatter.description } : {}),
          });
        }
      }

      const entries = yield* fileSystem
        .readDirectory(directory)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      const orgRoot = path.join(root, ORG_DIRECTORY);
      for (const entry of [...entries].sort()) {
        if (EXCLUDED_DIRECTORIES.has(entry)) continue;
        if (directory === root && entry === ORG_DIRECTORY && !activeOrg) continue;
        if (directory === orgRoot && entry !== activeOrg) continue;
        if (contents !== undefined && SUPPORT_DIRECTORIES.has(entry)) continue;
        yield* scanDirectory(path.join(directory, entry), root, activeOrg);
      }
    });

  for (const root of roots) {
    const activeOrg = yield* fileSystem
      .readFileString(path.join(root, ORG_DIRECTORY, ACTIVE_ORG_FILE))
      .pipe(
        Effect.map((value) => value.trim() || undefined),
        Effect.orElseSucceed(() => undefined),
      );
    yield* scanDirectory(root, root, activeOrg);
  }

  return [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name));
});
