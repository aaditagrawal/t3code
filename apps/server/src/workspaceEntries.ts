import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { runProcess } from "./processRunner";

import {
  ProjectEntry,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";

const WORKSPACE_CACHE_TTL_MS = 15_000;
const WORKSPACE_CACHE_MAX_KEYS = 4;
const WORKSPACE_INDEX_MAX_ENTRIES = 25_000;
const WORKSPACE_SCAN_READDIR_CONCURRENCY = 32;
const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024;
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".convex",
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  ".cache",
]);

interface WorkspaceIndex {
  scannedAt: number;
  entries: SearchableWorkspaceEntry[];
  truncated: boolean;
}

interface SearchableWorkspaceEntry extends ProjectEntry {
  normalizedPath: string;
  normalizedName: string;
}

interface RankedWorkspaceEntry {
  entry: SearchableWorkspaceEntry;
  score: number;
}

const workspaceIndexCache = new Map<string, WorkspaceIndex>();
const inFlightWorkspaceIndexBuilds = new Map<string, Promise<WorkspaceIndex>>();

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

function parentPathOf(input: string): string | undefined {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return undefined;
  }
  return input.slice(0, separatorIndex);
}

function basenameOf(input: string): string {
  const separatorIndex = input.lastIndexOf("/");
  if (separatorIndex === -1) {
    return input;
  }
  return input.slice(separatorIndex + 1);
}

function toSearchableWorkspaceEntry(entry: ProjectEntry): SearchableWorkspaceEntry {
  const normalizedPath = entry.path.toLowerCase();
  return {
    ...entry,
    normalizedPath,
    normalizedName: basenameOf(normalizedPath),
  };
}

function normalizeQuery(input: string): string {
  return input
    .trim()
    .replace(/^[@./]+/, "")
    .toLowerCase();
}

/**
 * Score a fuzzy subsequence match of `query` against `value`.
 * Returns a numeric penalty (lower = better) or `null` if the query
 * characters do not appear as a subsequence in order.
 */
function scoreSubsequenceMatch(query: string, value: string): number | null {
  let queryIndex = 0;
  let firstMatchIndex = -1;
  let lastMatchIndex = -1;
  let gapPenalty = 0;
  let prevMatchIndex = -1;

  for (let i = 0; i < value.length && queryIndex < query.length; i++) {
    if (value[i] === query[queryIndex]) {
      if (firstMatchIndex === -1) {
        firstMatchIndex = i;
      }
      if (prevMatchIndex !== -1) {
        const gap = i - prevMatchIndex - 1;
        if (gap > 0) {
          gapPenalty += gap;
        }
      }
      prevMatchIndex = i;
      lastMatchIndex = i;
      queryIndex++;
    }
  }

  if (queryIndex < query.length) {
    return null;
  }

  const spanPenalty = lastMatchIndex - firstMatchIndex - query.length + 1;
  const lengthPenalty = Math.min(value.length, 64);
  return firstMatchIndex * 2 + gapPenalty * 3 + spanPenalty + lengthPenalty;
}

function scoreEntry(entry: ProjectEntry, query: string): number {
  if (!query) {
    return entry.kind === "directory" ? 0 : 1;
  }

  const normalizedPath = entry.path.toLowerCase();
  const normalizedName = basenameOf(normalizedPath);

  if (normalizedName === query) return 0;
  if (normalizedPath === query) return 1;
  if (normalizedName.startsWith(query)) return 2;
  if (normalizedPath.startsWith(query)) return 3;
  if (normalizedPath.includes(`/${query}`)) return 4;
  if (normalizedName.includes(query)) return 5;
  if (normalizedPath.includes(query)) return 6;

  const nameFuzzy = scoreSubsequenceMatch(query, normalizedName);
  if (nameFuzzy !== null) return 100 + nameFuzzy;

  const pathFuzzy = scoreSubsequenceMatch(query, normalizedPath);
  if (pathFuzzy !== null) return 200 + pathFuzzy;

  return Infinity;
}

function isPathInIgnoredDirectory(relativePath: string): boolean {
  const firstSegment = relativePath.split("/")[0];
  if (!firstSegment) return false;
  return IGNORED_DIRECTORY_NAMES.has(firstSegment);
}

function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split("\0");
  if (parts.length === 0) return [];

  // If output was truncated, the final token can be partial.
  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop();
  }

  return parts.filter((value) => value.length > 0);
}

function directoryAncestorsOf(relativePath: string): string[] {
  const segments = relativePath.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= 1) return [];
  const directories: string[] = [];
  for (let index = 1; index < segments.length; index += 1) {
    directories.push(segments.slice(0, index).join("/"));
  }
  return directories;
}

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  if (items.length === 0) {
    return [];
  }

  const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length));
  const results = Array.from({ length: items.length }) as TOutput[];
  let nextIndex = 0;

  const workers = Array.from({ length: boundedConcurrency }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex] as TInput, currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function isInsideGitWorkTree(cwd: string): Promise<boolean> {
  const insideWorkTree = await runProcess("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    allowNonZeroExit: true,
    timeoutMs: 5_000,
    maxBufferBytes: 4_096,
  }).catch(() => null);
  return Boolean(
    insideWorkTree && insideWorkTree.code === 0 && insideWorkTree.stdout.trim() === "true",
  );
}

async function filterGitIgnoredPaths(cwd: string, relativePaths: string[]): Promise<string[]> {
  if (relativePaths.length === 0) {
    return relativePaths;
  }

  const ignoredPaths = new Set<string>();
  let chunk: string[] = [];
  let chunkBytes = 0;

  const flushChunk = async (): Promise<boolean> => {
    if (chunk.length === 0) {
      return true;
    }

    const checkIgnore = await runProcess("git", ["check-ignore", "--no-index", "-z", "--stdin"], {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 20_000,
      maxBufferBytes: 16 * 1024 * 1024,
      outputMode: "truncate",
      stdin: `${chunk.join("\0")}\0`,
    }).catch(() => null);
    chunk = [];
    chunkBytes = 0;

    if (!checkIgnore) {
      return false;
    }

    // git-check-ignore exits with 1 when no paths match.
    if (checkIgnore.code !== 0 && checkIgnore.code !== 1) {
      return false;
    }

    const matchedIgnoredPaths = splitNullSeparatedPaths(
      checkIgnore.stdout,
      Boolean(checkIgnore.stdoutTruncated),
    );
    for (const ignoredPath of matchedIgnoredPaths) {
      ignoredPaths.add(ignoredPath);
    }
    return true;
  };

  for (const relativePath of relativePaths) {
    const relativePathBytes = Buffer.byteLength(relativePath) + 1;
    if (
      chunk.length > 0 &&
      chunkBytes + relativePathBytes > GIT_CHECK_IGNORE_MAX_STDIN_BYTES &&
      !(await flushChunk())
    ) {
      return relativePaths;
    }

    chunk.push(relativePath);
    chunkBytes += relativePathBytes;

    if (chunkBytes >= GIT_CHECK_IGNORE_MAX_STDIN_BYTES && !(await flushChunk())) {
      return relativePaths;
    }
  }

  if (!(await flushChunk())) {
    return relativePaths;
  }

  if (ignoredPaths.size === 0) {
    return relativePaths;
  }

  return relativePaths.filter((relativePath) => !ignoredPaths.has(relativePath));
}

async function buildWorkspaceIndexFromGit(cwd: string): Promise<WorkspaceIndex | null> {
  if (!(await isInsideGitWorkTree(cwd))) {
    return null;
  }

  const listedFiles = await runProcess(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd,
      allowNonZeroExit: true,
      timeoutMs: 20_000,
      maxBufferBytes: 16 * 1024 * 1024,
      outputMode: "truncate",
    },
  ).catch(() => null);
  if (!listedFiles || listedFiles.code !== 0) {
    return null;
  }

  const listedPaths = splitNullSeparatedPaths(
    listedFiles.stdout,
    Boolean(listedFiles.stdoutTruncated),
  )
    .map((entry) => toPosixPath(entry))
    .filter((entry) => entry.length > 0 && !isPathInIgnoredDirectory(entry));
  const filePaths = await filterGitIgnoredPaths(cwd, listedPaths);

  const directorySet = new Set<string>();
  for (const filePath of filePaths) {
    for (const directoryPath of directoryAncestorsOf(filePath)) {
      if (!isPathInIgnoredDirectory(directoryPath)) {
        directorySet.add(directoryPath);
      }
    }
  }

  const directoryEntries = [...directorySet]
    .toSorted((left, right) => left.localeCompare(right))
    .map(
      (directoryPath): ProjectEntry => ({
        path: directoryPath,
        kind: "directory",
        parentPath: parentPathOf(directoryPath),
      }),
    )
    .map(toSearchableWorkspaceEntry);
  const fileEntries = [...new Set(filePaths)]
    .toSorted((left, right) => left.localeCompare(right))
    .map(
      (filePath): ProjectEntry => ({
        path: filePath,
        kind: "file",
        parentPath: parentPathOf(filePath),
      }),
    )
    .map(toSearchableWorkspaceEntry);

  const entries = [...directoryEntries, ...fileEntries];
  return {
    scannedAt: Date.now(),
    entries: entries.slice(0, WORKSPACE_INDEX_MAX_ENTRIES),
    truncated: Boolean(listedFiles.stdoutTruncated) || entries.length > WORKSPACE_INDEX_MAX_ENTRIES,
  };
}

async function buildWorkspaceIndex(cwd: string): Promise<WorkspaceIndex> {
  const gitIndexed = await buildWorkspaceIndexFromGit(cwd);
  if (gitIndexed) {
    return gitIndexed;
  }
  const shouldFilterWithGitIgnore = await isInsideGitWorkTree(cwd);

  let pendingDirectories: string[] = [""];
  const entries: SearchableWorkspaceEntry[] = [];
  let truncated = false;

  while (pendingDirectories.length > 0 && !truncated) {
    const currentDirectories = pendingDirectories;
    pendingDirectories = [];
    const directoryEntries = await mapWithConcurrency(
      currentDirectories,
      WORKSPACE_SCAN_READDIR_CONCURRENCY,
      async (relativeDir) => {
        const absoluteDir = relativeDir ? path.join(cwd, relativeDir) : cwd;
        try {
          const dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
          return { relativeDir, dirents };
        } catch (error) {
          if (!relativeDir) {
            throw new Error(
              `Unable to scan workspace entries at '${cwd}': ${error instanceof Error ? error.message : "unknown error"}`,
              { cause: error },
            );
          }
          return { relativeDir, dirents: null };
        }
      },
    );

    const candidateEntriesByDirectory = directoryEntries.map((directoryEntry) => {
      const { relativeDir, dirents } = directoryEntry;
      if (!dirents) return [] as Array<{ dirent: Dirent; relativePath: string }>;

      dirents.sort((left, right) => left.name.localeCompare(right.name));
      const candidates: Array<{ dirent: Dirent; relativePath: string }> = [];
      for (const dirent of dirents) {
        if (!dirent.name || dirent.name === "." || dirent.name === "..") {
          continue;
        }
        if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
          continue;
        }
        if (!dirent.isDirectory() && !dirent.isFile()) {
          continue;
        }

        const relativePath = toPosixPath(
          relativeDir ? path.join(relativeDir, dirent.name) : dirent.name,
        );
        if (isPathInIgnoredDirectory(relativePath)) {
          continue;
        }
        candidates.push({ dirent, relativePath });
      }
      return candidates;
    });

    const candidatePaths = candidateEntriesByDirectory.flatMap((candidateEntries) =>
      candidateEntries.map((entry) => entry.relativePath),
    );
    const allowedPathSet = shouldFilterWithGitIgnore
      ? new Set(await filterGitIgnoredPaths(cwd, candidatePaths))
      : null;

    for (const candidateEntries of candidateEntriesByDirectory) {
      for (const candidate of candidateEntries) {
        if (allowedPathSet && !allowedPathSet.has(candidate.relativePath)) {
          continue;
        }

        const entry = toSearchableWorkspaceEntry({
          path: candidate.relativePath,
          kind: candidate.dirent.isDirectory() ? "directory" : "file",
          parentPath: parentPathOf(candidate.relativePath),
        });
        entries.push(entry);

        if (candidate.dirent.isDirectory()) {
          pendingDirectories.push(candidate.relativePath);
        }

        if (entries.length >= WORKSPACE_INDEX_MAX_ENTRIES) {
          truncated = true;
          break;
        }
      }

      if (truncated) {
        break;
      }
    }
  }

  return {
    scannedAt: Date.now(),
    entries,
    truncated,
  };
}

async function getWorkspaceIndex(cwd: string): Promise<WorkspaceIndex> {
  const cached = workspaceIndexCache.get(cwd);
  if (cached && Date.now() - cached.scannedAt < WORKSPACE_CACHE_TTL_MS) {
    return cached;
  }

  const inFlight = inFlightWorkspaceIndexBuilds.get(cwd);
  if (inFlight) {
    return inFlight;
  }

  const nextPromise = buildWorkspaceIndex(cwd)
    .then((next) => {
      if (inFlightWorkspaceIndexBuilds.get(cwd) !== nextPromise) {
        return next;
      }
      workspaceIndexCache.set(cwd, next);
      while (workspaceIndexCache.size > WORKSPACE_CACHE_MAX_KEYS) {
        const oldestKey = workspaceIndexCache.keys().next().value;
        if (!oldestKey) break;
        workspaceIndexCache.delete(oldestKey);
      }
      return next;
    })
    .finally(() => {
      if (inFlightWorkspaceIndexBuilds.get(cwd) === nextPromise) {
        inFlightWorkspaceIndexBuilds.delete(cwd);
      }
    });
  inFlightWorkspaceIndexBuilds.set(cwd, nextPromise);
  return nextPromise;
}

export function clearWorkspaceIndexCache(cwd: string): void {
  workspaceIndexCache.delete(cwd);
  inFlightWorkspaceIndexBuilds.delete(cwd);
}

function compareRankedEntries(
  left: { entry: ProjectEntry; score: number },
  right: { entry: ProjectEntry; score: number },
): number {
  return left.score - right.score || left.entry.path.localeCompare(right.entry.path);
}

function findInsertionIndex(
  ranked: Array<{ entry: ProjectEntry; score: number }>,
  candidate: { entry: ProjectEntry; score: number },
): number {
  let lo = 0;
  let hi = ranked.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (compareRankedEntries(ranked[mid]!, candidate) <= 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function insertRankedEntry(
  ranked: Array<{ entry: ProjectEntry; score: number }>,
  entry: ProjectEntry,
  score: number,
  limit: number,
): void {
  if (limit <= 0) {
    return;
  }
  const candidate = { entry, score };
  if (ranked.length >= limit && compareRankedEntries(candidate, ranked[ranked.length - 1]!) >= 0) {
    return;
  }
  const index = findInsertionIndex(ranked, candidate);
  ranked.splice(index, 0, candidate);
  if (ranked.length > limit) {
    ranked.pop();
  }
}

export async function searchWorkspaceEntries(
  input: ProjectSearchEntriesInput,
): Promise<ProjectSearchEntriesResult> {
  const index = await getWorkspaceIndex(input.cwd);
  const normalizedQuery = normalizeQuery(input.query);

  if (!normalizedQuery) {
    const ranked = index.entries.toSorted((left, right) => {
      const scoreDelta = scoreEntry(left, normalizedQuery) - scoreEntry(right, normalizedQuery);
      if (scoreDelta !== 0) return scoreDelta;
      return left.path.localeCompare(right.path);
    });
    return {
      entries: ranked.slice(0, input.limit),
      truncated: index.truncated || ranked.length > input.limit,
    };
  }

  const ranked: Array<{ entry: ProjectEntry; score: number }> = [];
  let matchedEntryCount = 0;

  for (const entry of index.entries) {
    const score = scoreEntry(entry, normalizedQuery);
    if (!Number.isFinite(score)) continue;
    matchedEntryCount++;
    insertRankedEntry(ranked, entry, score, input.limit);
  }

  return {
    entries: ranked.map((item) => item.entry),
    truncated: index.truncated || matchedEntryCount > input.limit,
  };
}
