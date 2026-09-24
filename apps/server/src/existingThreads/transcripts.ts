import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import { ProviderInstanceId } from "@t3tools/contracts";
import {
  parseAgentSessionTranscript,
  type AgentSessionThread,
} from "../project/AgentSessionScanner.ts";

export interface TranscriptMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}
export interface Transcript {
  readonly providerThread: AgentSessionThread;
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
  let selected = entries;
  let sessionId = "";
  let cwd = "";
  if (provider === "codex") {
    const meta = record(entries.find((e) => e.type === "session_meta")?.payload);
    sessionId = string(meta.id) || string(meta.session_id);
    cwd = string(meta.cwd);
  } else {
    const main = entries.filter(
      (e) =>
        !e.isSidechain &&
        (e.type === "user" || e.type === "assistant") &&
        typeof e.uuid === "string",
    );
    const last = main.at(-1) ?? {};
    sessionId = string(last.sessionId);
    cwd = string(last.cwd) || string(main[0]?.cwd);
    const byId = new Map(
      entries.filter((e) => typeof e.uuid === "string").map((e) => [string(e.uuid), e]),
    );
    const chain: Array<Record<string, unknown>> = [];
    const visited = new Set<string>();
    let current = main.at(-1);
    while (current) {
      if (visited.has(string(current.uuid)))
        throw new Error("The session transcript contains a cycle.");
      visited.add(string(current.uuid));
      chain.push(current);
      current = byId.get(string(current.parentUuid));
    }
    selected = chain.reverse();
  }
  const providerThread = parseAgentSessionTranscript({
    contents: selected.map((e) => JSON.stringify(e)).join("\n"),
    source: provider,
    providerInstanceId: ProviderInstanceId.make(provider),
    fallbackSessionId: sessionId,
    lastActiveAtMs: 0,
  });
  // Header discovery can precede the first visible message.
  const thread = providerThread ?? {
    source: provider,
    providerInstanceId: ProviderInstanceId.make(provider),
    providerSessionId: sessionId,
    title: "Conversation",
    model: null,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    messages: [],
  };
  return { providerThread: thread, sessionId, cwd, title: thread.title, messages: thread.messages };
}
