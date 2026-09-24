// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Tests exercise read-only native transcript and SQLite fixtures.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { ProviderInstanceId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { discoverThreads, readDiscoveredThread, type SourceInput } from "./sources.ts";
import { parseTranscript } from "./transcripts.ts";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => NodeFSP.rm(root, { recursive: true, force: true })),
  );
});
const sessionId = "01900000-0000-7000-8000-000000000001";
const stamp = "2026-09-05T12:00:00.000Z";
function codex(cwd: string) {
  return (
    [
      { type: "session_meta", payload: { id: sessionId, cwd } },
      { type: "event_msg", payload: { type: "user_message", message: "Continue my project" } },
      {
        type: "response_item",
        timestamp: stamp,
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Continue my project" }],
        },
      },
      {
        type: "response_item",
        timestamp: stamp,
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Existing answer" }],
        },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n"
  );
}
async function fixture() {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-existing-test-"));
  roots.push(root);
  const input: SourceInput = {
    provider: "codex",
    instanceId: ProviderInstanceId.make("codex"),
    providerHome: NodePath.join(root, "codex"),
    officialHome: NodePath.join(root, "official"),
  };
  const sessions = NodePath.join(input.providerHome, "sessions");
  await NodeFSP.mkdir(sessions, { recursive: true });
  const file = NodePath.join(sessions, "rollout-example.jsonl");
  await NodeFSP.writeFile(file, codex(root));
  return { root, input, file };
}
describe("existing session discovery", () => {
  it("reads canonical messages once, including a partially written final record", () => {
    const parsed = parseTranscript(codex("/project") + '{"type":', "codex");
    expect(parsed.messages.map((m) => m.text)).toEqual(["Continue my project", "Existing answer"]);
    expect(() => parseTranscript(codex("/project") + "invalid\n{}", "codex")).toThrow(
      "invalid record",
    );
  });
  it("follows Claude's current branch without importing abandoned turns or sidechains", () => {
    const entry = (
      uuid: string,
      parentUuid: string | null,
      type: string,
      text: string,
      isSidechain = false,
    ) => ({
      uuid,
      parentUuid,
      type,
      isSidechain,
      sessionId,
      cwd: "/project",
      timestamp: stamp,
      message: { content: [{ type: "text", text }] },
    });
    const parsed = parseTranscript(
      [
        entry("a", null, "user", "Question"),
        entry("b", "a", "assistant", "Abandoned"),
        entry("c", "a", "assistant", "Current"),
        entry("d", "c", "assistant", "Subagent", true),
      ]
        .map((x) => JSON.stringify(x))
        .join("\n"),
      "claudeAgent",
    );
    expect(parsed.messages.map((m) => m.text)).toEqual(["Question", "Current"]);
  });
  it("discovers CLI sessions with account-specific IDs and re-reads history on import", async () => {
    const { input } = await fixture();
    const result = await discoverThreads(input);
    expect(result.threads).toHaveLength(1);
    const found = result.threads[0]!;
    expect(found.summary.source).toBe("provider-cli");
    expect(found.summary.unavailableReason).toBeNull();
    expect((await readDiscoveredThread(found)).messages).toHaveLength(2);
    const alias = await discoverThreads({
      ...input,
      instanceId: ProviderInstanceId.make("codex-alias"),
    });
    expect(alias.threads[0]!.summary.id).toBe(found.summary.id);
  });
  it("uses official titles but blocks live official sessions without changing the source database", async () => {
    const { input } = await fixture();
    const dir = NodePath.join(input.officialHome, "userdata");
    await NodeFSP.mkdir(dir, { recursive: true });
    const filename = NodePath.join(dir, "state.sqlite");
    const db = new NodeSqlite.DatabaseSync(filename);
    db.exec(
      "CREATE TABLE projection_threads(thread_id TEXT, title TEXT, deleted_at TEXT, updated_at TEXT); CREATE TABLE provider_session_runtime(thread_id TEXT, provider_name TEXT, resume_cursor_json TEXT, status TEXT);",
    );
    db.prepare("INSERT INTO projection_threads VALUES (?, ?, NULL, ?)").run(
      "t3-id",
      "Official title",
      stamp,
    );
    db.prepare("INSERT INTO provider_session_runtime VALUES (?, ?, ?, ?)").run(
      "t3-id",
      "codex",
      JSON.stringify({ threadId: sessionId }),
      "ready",
    );
    db.close();
    await NodeFSP.writeFile(
      NodePath.join(dir, "server-runtime.json"),
      JSON.stringify({ pid: process.pid }),
    );
    const before = await NodeFSP.readFile(filename);
    const result = await discoverThreads(input);
    expect(result.threads[0]!.summary).toMatchObject({
      title: "Official title",
      source: "official-t3",
    });
    expect(result.threads[0]!.summary.unavailableReason).toContain("Stop this session");
    expect(await NodeFSP.readFile(filename)).toEqual(before);
  });
  it("reads the current official database ahead of the older snapshot", async () => {
    const { input } = await fixture();
    const dir = NodePath.join(input.officialHome, "userdata");
    await NodeFSP.mkdir(dir, { recursive: true });
    const older = NodePath.join(dir, "state.sqlite");
    const current = NodePath.join(dir, "statev2.sqlite");
    for (const [filename, title] of [
      [older, "Stale title"],
      [current, "Current title"],
    ] as const) {
      const db = new NodeSqlite.DatabaseSync(filename);
      db.exec(
        "CREATE TABLE projection_threads(thread_id TEXT, title TEXT, deleted_at TEXT, updated_at TEXT); CREATE TABLE provider_session_runtime(thread_id TEXT, provider_name TEXT, resume_cursor_json TEXT, status TEXT);",
      );
      db.prepare("INSERT INTO projection_threads VALUES (?, ?, NULL, ?)").run(
        "t3-id",
        title,
        stamp,
      );
      db.prepare("INSERT INTO provider_session_runtime VALUES (?, ?, ?, ?)").run(
        "t3-id",
        "codex",
        JSON.stringify({ threadId: sessionId }),
        "ready",
      );
      if (filename === current) {
        db.exec(
          "CREATE TABLE orchestration_v2_projection_threads(thread_id TEXT, title TEXT, deleted_at TEXT, updated_at TEXT); CREATE TABLE orchestration_v2_projection_provider_threads(thread_id TEXT, driver TEXT, status TEXT, provider_session_id TEXT, payload_json TEXT, updated_at TEXT);",
        );
        db.prepare("INSERT INTO orchestration_v2_projection_threads VALUES (?, ?, NULL, ?)").run(
          "v2-id",
          "Current title",
          stamp,
        );
        db.prepare(
          "INSERT INTO orchestration_v2_projection_provider_threads VALUES (?, ?, ?, ?, ?, ?)",
        ).run("v2-id", "codex", "active", sessionId, "{}", stamp);
      }
      db.close();
    }
    const result = await discoverThreads(input);
    expect(result.threads[0]!.summary).toMatchObject({
      title: "Current title",
      source: "official-t3",
    });
    expect(result.threads[0]!.summary.unavailableReason).toBeNull();
  });
  it("treats an unreadable official database as a reason to block import", async () => {
    const { input } = await fixture();
    const dir = NodePath.join(input.officialHome, "userdata");
    await NodeFSP.mkdir(NodePath.join(dir, "state.sqlite"), { recursive: true });
    const result = await discoverThreads(input);
    expect(result.threads[0]!.summary.unavailableReason).toContain("could not be read");
  });
  it("keeps a live official session blocked when its process cannot be signaled", async () => {
    const { input } = await fixture();
    const dir = NodePath.join(input.officialHome, "userdata");
    await NodeFSP.mkdir(dir, { recursive: true });
    const filename = NodePath.join(dir, "state.sqlite");
    const db = new NodeSqlite.DatabaseSync(filename);
    db.exec(
      "CREATE TABLE projection_threads(thread_id TEXT, title TEXT, deleted_at TEXT, updated_at TEXT); CREATE TABLE provider_session_runtime(thread_id TEXT, provider_name TEXT, resume_cursor_json TEXT, status TEXT);",
    );
    db.prepare("INSERT INTO projection_threads VALUES (?, ?, NULL, ?)").run(
      "t3-id",
      "Official title",
      stamp,
    );
    db.prepare("INSERT INTO provider_session_runtime VALUES (?, ?, ?, ?)").run(
      "t3-id",
      "codex",
      JSON.stringify({ threadId: sessionId }),
      "ready",
    );
    db.close();
    await NodeFSP.writeFile(
      NodePath.join(dir, "server-runtime.json"),
      JSON.stringify({ pid: process.pid }),
    );
    const originalKill = process.kill;
    process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) {
        const error = new Error("operation not permitted") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return originalKill.call(process, pid, signal);
    }) as typeof process.kill;
    try {
      const result = await discoverThreads(input);
      expect(result.threads[0]!.summary.unavailableReason).toContain("Stop this session");
    } finally {
      process.kill = originalKill;
    }
  });
  it("refuses a transcript swapped to an external symlink after discovery", async () => {
    const { root, input, file } = await fixture();
    const found = (await discoverThreads(input)).threads[0]!;
    const outside = NodePath.join(root, "outside.jsonl");
    await NodeFSP.writeFile(outside, codex(root));
    await NodeFSP.unlink(file);
    await NodeFSP.symlink(outside, file);
    await expect(readDiscoveredThread(found)).rejects.toThrow("outside its provider directory");
  });
  it("reports missing project folders without changing a provider session", async () => {
    const { root, input, file } = await fixture();
    await NodeFSP.writeFile(file, codex(NodePath.join(root, "missing")));
    expect((await discoverThreads(input)).threads[0]!.summary.unavailableReason).toContain(
      "missing",
    );
  });
});
