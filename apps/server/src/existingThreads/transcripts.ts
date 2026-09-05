import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";

export interface TranscriptMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}
export interface Transcript {
  readonly sessionId: string;
  readonly cwd: string;
  readonly title: string;
  readonly messages: ReadonlyArray<TranscriptMessage>;
}
const RecordSchema = Schema.Record(Schema.String, Schema.Unknown);
const isRecord = Schema.is(RecordSchema);
export const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
export const string = (value: unknown): string => (typeof value === "string" ? value : "");
export const stableId = (...parts: ReadonlyArray<string>): string =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(parts)).digest("hex");

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item: unknown) => {
      const part = record(item);
      return ["text", "input_text", "output_text"].includes(string(part.type)) &&
        typeof part.text === "string"
        ? [part.text]
        : [];
    })
    .join("\n");
}
export function parseTranscript(text: string, provider: "codex" | "claudeAgent"): Transcript {
  const lines = text.split("\n");
  const entries: Array<Record<string, unknown>> = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      entries.push(record(JSON.parse(line)));
    } catch {
      // A writer may have an incomplete last record. Never conceal interior corruption.
      if (index !== lines.length - 1)
        throw new Error("The session transcript contains an invalid record.");
    }
  }
  if (provider === "codex") {
    const meta = record(entries.find((e) => e.type === "session_meta")?.payload);
    const messages: TranscriptMessage[] = [];
    for (const entry of entries) {
      const payload = record(entry.payload);
      if (entry.type !== "response_item" || payload.type !== "message") continue;
      if (payload.role !== "user" && payload.role !== "assistant") continue;
      const text = contentText(payload.content);
      if (text) messages.push({ role: payload.role, text, createdAt: string(entry.timestamp) });
    }
    return {
      sessionId: string(meta.id),
      cwd: string(meta.cwd),
      title: messages.find((m) => m.role === "user")?.text.slice(0, 160) ?? "Codex conversation",
      messages,
    };
  }
  // Claude transcripts are a parent-linked tree. Follow the last main-session leaf,
  // rather than concatenating abandoned branches or subagent messages.
  const main = entries.filter(
    (e) =>
      !e.isSidechain && (e.type === "user" || e.type === "assistant") && typeof e.uuid === "string",
  );
  const byId = new Map(
    entries.filter((e) => typeof e.uuid === "string").map((e) => [string(e.uuid), e]),
  );
  const chain: Array<Record<string, unknown>> = [];
  const visited = new Set<string>();
  let current = main.at(-1);
  while (current && !visited.has(string(current.uuid))) {
    visited.add(string(current.uuid));
    chain.push(current);
    current = byId.get(string(current.parentUuid));
  }
  chain.reverse();
  const messages: TranscriptMessage[] = chain.flatMap((entry) => {
    if (entry.isSidechain || (entry.type !== "user" && entry.type !== "assistant")) return [];
    const text = contentText(record(entry.message).content);
    return text ? [{ role: entry.type, text, createdAt: string(entry.timestamp) }] : [];
  });
  const last = main.at(-1) ?? {};
  return {
    sessionId: string(last.sessionId),
    cwd: string(last.cwd) || string(main[0]?.cwd),
    title: messages.find((m) => m.role === "user")?.text.slice(0, 160) ?? "Claude conversation",
    messages,
  };
}
