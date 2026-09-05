// @effect-diagnostics nodeBuiltinImport:off - Pure Copilot CLI path resolver inspects packaged Node resources.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";

const require = NodeModule.createRequire(import.meta.url);
const CURRENT_DIR = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const GITHUB_SCOPE_DIR = "@github";
const COPILOT_PATHLESS_COMMAND_PATTERN = /^copilot(?:\.(?:exe|cmd|bat))?$/i;
const COPILOT_DESKTOP_ENV_BLOCKLIST = [
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_RENDERER_PORT",
  "CLAUDECODE",
] as const;
let copilotDesktopEnvChain: Promise<unknown> = Promise.resolve();

function dedupePaths(paths: ReadonlyArray<string | undefined>): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const candidate of paths) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    resolved.push(candidate);
  }

  return resolved;
}

function resolveSdkEntrypoint(): string | undefined {
  try {
    return require.resolve("@github/copilot-sdk");
  } catch {
    return undefined;
  }
}

function resolveProcessResourcesPath(): string | undefined {
  const processWithResourcesPath = process as NodeJS.Process & {
    readonly resourcesPath?: string;
  };
  return processWithResourcesPath.resourcesPath;
}

export function normalizeCopilotCliPathOverride(
  value: string | null | undefined,
): string | undefined {
  if (value == null) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    COPILOT_PATHLESS_COMMAND_PATTERN.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}

function isDesktopRuntime(): boolean {
  return process.env.T3CODE_MODE === "desktop";
}

export async function withSanitizedCopilotDesktopEnv<T>(operation: () => Promise<T>): Promise<T> {
  if (!isDesktopRuntime()) {
    return operation();
  }

  const run = async () => {
    const previousValues = new Map<string, string | undefined>();
    for (const key of COPILOT_DESKTOP_ENV_BLOCKLIST) {
      previousValues.set(key, process.env[key]);
      delete process.env[key];
    }

    try {
      return await operation();
    } finally {
      for (const [key, value] of previousValues) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  };

  const result = copilotDesktopEnvChain.then(run, run);
  copilotDesktopEnvChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function resolveGithubScopeDirFromSdkEntrypoint(
  sdkEntrypoint: string | undefined,
): string | undefined {
  if (!sdkEntrypoint) return undefined;
  return NodePath.join(NodePath.dirname(NodePath.dirname(sdkEntrypoint)), "..");
}

function resolveNodeModulesRoots(input: {
  currentDir: string;
  resourcesPath?: string;
  sdkEntrypoint?: string;
}): string[] {
  const githubScopeDir = resolveGithubScopeDirFromSdkEntrypoint(input.sdkEntrypoint);
  return dedupePaths([
    input.resourcesPath
      ? NodePath.join(input.resourcesPath, "app.asar.unpacked/node_modules")
      : undefined,
    input.resourcesPath ? NodePath.join(input.resourcesPath, "node_modules") : undefined,
    NodePath.join(input.currentDir, "../../../../../app.asar.unpacked/node_modules"),
    NodePath.join(input.currentDir, "../../../../../../app.asar.unpacked/node_modules"),
    NodePath.join(input.currentDir, "../../../node_modules"),
    NodePath.join(input.currentDir, "../../../../../node_modules"),
    githubScopeDir ? NodePath.join(githubScopeDir, "..") : undefined,
  ]);
}

function getCopilotPlatformBinaryName(platform: string): string {
  return platform === "win32" ? "copilot.exe" : "copilot";
}

export function getBundledCopilotPlatformPackages(
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure resolver keeps platform injectable for tests and non-Effect callers.
  platform: string = process.platform,
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure resolver keeps architecture injectable for tests and non-Effect callers.
  arch: string = process.arch,
): ReadonlyArray<string> {
  if (platform === "darwin" && arch === "arm64") {
    return ["copilot-darwin-arm64"];
  }
  if (platform === "darwin" && arch === "x64") {
    return ["copilot-darwin-x64"];
  }
  if (platform === "linux" && arch === "arm64") {
    return ["copilot-linux-arm64"];
  }
  if (platform === "linux" && arch === "x64") {
    return ["copilot-linux-x64"];
  }
  if (platform === "win32" && arch === "arm64") {
    return ["copilot-win32-arm64"];
  }
  if (platform === "win32" && arch === "x64") {
    return ["copilot-win32-x64"];
  }

  return [];
}

export function resolveBundledCopilotCliPathFrom(input: {
  currentDir: string;
  resourcesPath?: string;
  sdkEntrypoint?: string;
  platform?: string;
  arch?: string;
  exists?: (path: string) => boolean;
}): string | undefined {
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure resolver keeps platform injectable for tests and non-Effect callers.
  const platform = input.platform ?? process.platform;
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Pure resolver keeps architecture injectable for tests and non-Effect callers.
  const arch = input.arch ?? process.arch;
  const exists = input.exists ?? NodeFS.existsSync;
  const sdkEntrypoint = input.sdkEntrypoint;
  const nodeModulesRoots = resolveNodeModulesRoots({
    currentDir: input.currentDir,
    ...(input.resourcesPath ? { resourcesPath: input.resourcesPath } : {}),
    ...(sdkEntrypoint ? { sdkEntrypoint } : {}),
  });
  const binaryName = getCopilotPlatformBinaryName(platform);
  const platformPackages = getBundledCopilotPlatformPackages(platform, arch);

  const binaryCandidates = nodeModulesRoots.flatMap((root) =>
    platformPackages.map((packageName) =>
      NodePath.join(root, GITHUB_SCOPE_DIR, packageName, binaryName),
    ),
  );
  for (const candidate of dedupePaths(binaryCandidates)) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  const githubScopeDir = resolveGithubScopeDirFromSdkEntrypoint(sdkEntrypoint);
  if (!githubScopeDir) {
    return undefined;
  }

  const sdkSiblingBinaryCandidates = platformPackages.map((packageName) =>
    NodePath.join(githubScopeDir, packageName, binaryName),
  );
  for (const candidate of dedupePaths(sdkSiblingBinaryCandidates)) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function resolveBundledCopilotCliPath(): string | undefined {
  const sdkEntrypoint = resolveSdkEntrypoint();
  const resourcesPath = resolveProcessResourcesPath();
  return resolveBundledCopilotCliPathFrom({
    currentDir: CURRENT_DIR,
    ...(resourcesPath ? { resourcesPath } : {}),
    ...(sdkEntrypoint ? { sdkEntrypoint } : {}),
  });
}

/** SDK cliPath is a filesystem path, not a command to search on PATH. */
export function resolveCopilotSdkCliPath(value?: string): string | undefined {
  return normalizeCopilotCliPathOverride(value) ?? resolveBundledCopilotCliPath();
}
