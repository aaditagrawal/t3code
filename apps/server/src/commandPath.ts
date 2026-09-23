// @effect-diagnostics nodeBuiltinImport:off - Pure command path resolver intentionally mirrors host PATH lookup.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

interface CommandPathOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}

export type CommandAvailabilityOptions = CommandPathOptions;

const DEFAULT_WINDOWS_PATH_EXTENSIONS = [".COM", ".EXE", ".BAT", ".CMD"] as const;

function stripWrappingQuotes(value: string): string {
  return value.replace(/^"+|"+$/g, "");
}

function resolvePathEnvironmentVariable(env: NodeJS.ProcessEnv): string {
  return env.PATH ?? env.Path ?? env.path ?? "";
}

function resolveWindowsPathExtensions(env: NodeJS.ProcessEnv): ReadonlyArray<string> {
  const rawValue = env.PATHEXT;
  const fallback = [...DEFAULT_WINDOWS_PATH_EXTENSIONS];
  if (!rawValue) return fallback;

  const parsed = rawValue
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith(".") ? entry.toUpperCase() : `.${entry.toUpperCase()}`));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

function resolvePathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

function resolveCommandCandidates(
  command: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): ReadonlyArray<string> {
  if (platform !== "win32") return [command];
  const extension = NodePath.extname(command);
  const normalizedExtension = extension.toUpperCase();

  if (extension.length > 0) {
    if (windowsPathExtensions.includes(normalizedExtension)) {
      const commandWithoutExtension = command.slice(0, -extension.length);
      return Array.from(
        new Set([
          command,
          `${commandWithoutExtension}${normalizedExtension}`,
          `${commandWithoutExtension}${normalizedExtension.toLowerCase()}`,
        ]),
      );
    }
    if (command.includes("/") || command.includes("\\")) {
      return [command];
    }
    const candidates = [command];
    for (const windowsPathExtension of windowsPathExtensions) {
      candidates.push(`${command}${windowsPathExtension}`);
      candidates.push(`${command}${windowsPathExtension.toLowerCase()}`);
    }
    return Array.from(new Set(candidates));
  }

  const candidates: string[] = [];
  for (const windowsPathExtension of windowsPathExtensions) {
    candidates.push(`${command}${windowsPathExtension}`);
    candidates.push(`${command}${windowsPathExtension.toLowerCase()}`);
  }
  return Array.from(new Set(candidates));
}

function isExecutableFile(
  filePath: string,
  platform: NodeJS.Platform,
  windowsPathExtensions: ReadonlyArray<string>,
): boolean {
  try {
    const stat = NodeFS.statSync(filePath);
    if (!stat.isFile()) return false;
    if (platform === "win32") {
      const extension = NodePath.extname(filePath);
      if (extension.length === 0) return false;
      return new Set([...DEFAULT_WINDOWS_PATH_EXTENSIONS, ...windowsPathExtensions]).has(
        extension.toUpperCase(),
      );
    }
    NodeFS.accessSync(filePath, NodeFS.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCommandPath(
  command: string,
  options: CommandPathOptions = {},
): string | undefined {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure utility keeps an optional injectable platform for tests and non-Effect call sites.
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const windowsPathExtensions = platform === "win32" ? resolveWindowsPathExtensions(env) : [];
  const commandCandidates = resolveCommandCandidates(command, platform, windowsPathExtensions);

  if (command.includes("/") || command.includes("\\")) {
    return commandCandidates.find((candidate) =>
      isExecutableFile(candidate, platform, windowsPathExtensions),
    );
  }

  const pathValue = resolvePathEnvironmentVariable(env);
  if (pathValue.length === 0) return undefined;

  const pathEntries = pathValue
    .split(resolvePathDelimiter(platform))
    .map((entry) => stripWrappingQuotes(entry.trim()))
    .filter((entry) => entry.length > 0);

  for (const pathEntry of pathEntries) {
    for (const candidate of commandCandidates) {
      const resolvedPath = NodePath.join(pathEntry, candidate);
      if (isExecutableFile(resolvedPath, platform, windowsPathExtensions)) {
        return resolvedPath;
      }
    }
  }

  return undefined;
}
