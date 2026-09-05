// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Read-only Node filesystem boundary, also exercised without an Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type {
  AgentSessionImportSource,
  ExistingThread,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { parseTranscript, record, stableId, string, type Transcript } from "./transcripts.ts";

const MAX_FILES = 5_000;
const LIST_LIMIT = 200;
const HEADER_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const SESSION_ID = /^[a-zA-Z0-9_-]{8,128}$/;
export interface SourceInput {
  readonly provider: "codex" | "claudeAgent";
  readonly instanceId: ProviderInstanceId;
  readonly providerHome: string;
  readonly officialHome: string;
}
export interface DiscoveredThread {
  readonly summary: ExistingThread;
  readonly path: string;
  readonly providerHome: string;
}
async function exists(path: string) {
  try {
    await NodeFSP.access(path);
    return true;
  } catch {
    return false;
  }
}
async function sessionFiles(root: string, provider: SourceInput["provider"]) {
  const files: Array<{ path: string; mtime: number }> = [];
  let visited = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5 || visited >= MAX_FILES) return;
    let entries;
    try {
      entries = await NodeFSP.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (record(error).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (++visited > MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const path = NodePath.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "subagents") await walk(path, depth + 1);
      else if (
        entry.isFile() &&
        entry.name.endsWith(".jsonl") &&
        (provider !== "codex" || entry.name.startsWith("rollout-"))
      ) {
        const stat = await NodeFSP.stat(path);
        files.push({ path, mtime: stat.mtimeMs });
      }
    }
  };
  await walk(root, 0);
  files.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path));
  return {
    files: files.slice(0, LIST_LIMIT),
    limited: files.length > LIST_LIMIT || visited >= MAX_FILES,
  };
}
async function readHeader(path: string) {
  const handle = await NodeFSP.open(path, "r");
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}
interface OfficialThread {
  readonly title: string;
  readonly busy: boolean;
}
async function officialThreads(
  home: string,
  provider: SourceInput["provider"],
): Promise<Map<string, OfficialThread>> {
  const result = new Map<string, OfficialThread>();
  const database = NodePath.join(home, "userdata", "state.sqlite");
  if (!(await exists(database))) return result;
  let serverAlive = false;
  try {
    const runtime = record(
      JSON.parse(
        await NodeFSP.readFile(NodePath.join(home, "userdata", "server-runtime.json"), "utf8"),
      ),
    );
    if (typeof runtime.pid === "number" && runtime.pid > 0) {
      process.kill(runtime.pid, 0);
      serverAlive = true;
    }
  } catch {
    /* A stopped server leaves historical session status behind. */
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;");
    const rows = db
      .prepare(`SELECT t.title, r.resume_cursor_json, r.status
      FROM projection_threads t JOIN provider_session_runtime r ON r.thread_id = t.thread_id
      WHERE t.deleted_at IS NULL AND r.provider_name = ? ORDER BY t.updated_at DESC LIMIT 5000`)
      .all(provider);
    for (const row of rows) {
      let cursor;
      try {
        cursor = record(JSON.parse(string(row.resume_cursor_json)));
      } catch {
        continue;
      }
      const id =
        provider === "codex"
          ? string(cursor.threadId)
          : string(cursor.resume) || string(cursor.sessionId);
      if (!SESSION_ID.test(id)) continue;
      const previous = result.get(id);
      result.set(id, {
        title: string(row.title),
        busy:
          previous?.busy === true ||
          (serverAlive && !["stopped", "error"].includes(string(row.status))),
      });
    }
  } finally {
    db.close();
  }
  return result;
}
export async function discoverThreads(
  input: SourceInput,
): Promise<{ threads: DiscoveredThread[]; notices: string[] }> {
  const notices: string[] = [];
  let official = new Map<string, OfficialThread>();
  try {
    official = await officialThreads(input.officialHome, input.provider);
  } catch {
    notices.push(
      "Official T3 history could not be read. Provider CLI sessions are still available.",
    );
  }
  const home = await NodeFSP.realpath(input.providerHome).catch(() => input.providerHome);
  const candidateRoot = NodePath.join(home, input.provider === "codex" ? "sessions" : "projects");
  const root = await NodeFSP.realpath(candidateRoot).catch(() => candidateRoot);
  const { files, limited } = await sessionFiles(root, input.provider);
  if (limited)
    notices.push(
      "Showing up to 200 recent sessions from a bounded scan. Older sessions may not be listed.",
    );
  const seen = new Set<string>();
  const threads: DiscoveredThread[] = [];
  let unreadable = 0;
  for (const file of files) {
    try {
      const transcript = parseTranscript(await readHeader(file.path), input.provider);
      if (!SESSION_ID.test(transcript.sessionId) || seen.has(transcript.sessionId)) continue;
      seen.add(transcript.sessionId);
      const t3 = official.get(transcript.sessionId);
      const reason =
        !transcript.cwd || !NodePath.isAbsolute(transcript.cwd)
          ? "The original project folder is not recorded."
          : t3?.busy
            ? "Stop this session in official T3 before continuing here."
            : !(await exists(transcript.cwd))
              ? "The original project folder is missing."
              : null;
      threads.push({
        path: file.path,
        providerHome: root,
        summary: {
          id: stableId(input.provider, root, transcript.sessionId),
          sessionId: transcript.sessionId,
          instanceId: input.instanceId,
          provider: input.provider,
          source: t3 ? "official-t3" : "provider-cli",
          title: t3?.title || transcript.title,
          cwd: transcript.cwd,
          updatedAt: new Date(file.mtime).toISOString(),
          unavailableReason: reason,
          importedThreadId: null,
        },
      });
    } catch {
      unreadable++;
    }
  }
  if (unreadable) notices.push(`${unreadable} sessions could not be read.`);
  return { threads, notices };
}
export async function readDiscoveredThread(
  thread: DiscoveredThread,
): Promise<Transcript & { source: AgentSessionImportSource }> {
  const realPath = await NodeFSP.realpath(thread.path);
  const relative = NodePath.relative(thread.providerHome, realPath);
  if (relative.startsWith("..") || NodePath.isAbsolute(relative))
    throw new Error(
      "The session file moved outside its provider directory. Refresh and try again.",
    );
  const handle = await NodeFSP.open(realPath, "r");
  try {
    const stat = await handle.stat();
    if (stat.size > MAX_TRANSCRIPT_BYTES)
      throw new Error("This session exceeds the 32 MB import limit.");
    const transcript = parseTranscript(await handle.readFile("utf8"), thread.summary.provider);
    if (transcript.sessionId !== thread.summary.sessionId || transcript.cwd !== thread.summary.cwd)
      throw new Error("The session changed. Refresh and try again.");
    if (transcript.messages.length === 0)
      throw new Error("This session has no importable text history.");
    return {
      ...transcript,
      source: {
        provider: thread.summary.provider,
        providerInstanceId: thread.summary.instanceId,
        providerSessionId: transcript.sessionId,
        filePath: realPath,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        device: stat.dev,
        inode: stat.ino,
        birthtimeMs: stat.birthtimeMs,
      },
    };
  } finally {
    await handle.close();
  }
}
