import type {
  MemoryAddInput,
  MemoryEntry,
  MemoryEntryId,
  MemoryForgetInput,
  MemoryIndexInput,
  MemoryIndexResult,
  MemoryListInput,
  MemoryListResult,
  MemorySearchInput,
  MemorySearchOutput,
  MemorySearchResult,
} from "@t3tools/contracts";
import { Effect, Layer, ServiceMap } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface ProjectMemoryServiceShape {
  readonly add: (input: MemoryAddInput) => Effect.Effect<MemoryEntry>;
  readonly search: (input: MemorySearchInput) => Effect.Effect<MemorySearchOutput>;
  readonly forget: (input: MemoryForgetInput) => Effect.Effect<void>;
  readonly list: (input: MemoryListInput) => Effect.Effect<MemoryListResult>;
  readonly index: (input: MemoryIndexInput) => Effect.Effect<MemoryIndexResult>;
}

export class ProjectMemoryService extends ServiceMap.Service<
  ProjectMemoryService,
  ProjectMemoryServiceShape
>()("t3/memory/Services/ProjectMemoryService") {}

const makeProjectMemoryService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const add: ProjectMemoryServiceShape["add"] = (input) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID() as MemoryEntryId;
      const now = new Date().toISOString();
      const tagsJson = JSON.stringify(input.tags);
      yield* sql`INSERT INTO memory_entries (id, project_id, thread_id, kind, title, content, tags, relevance_score, access_count, created_at, updated_at, expires_at)
        VALUES (${id}, ${input.projectId}, ${input.threadId ?? null}, ${input.kind}, ${input.title}, ${input.content}, ${tagsJson}, 0.5, 0, ${now}, ${now}, ${input.expiresAt ?? null})`;
      return {
        id,
        projectId: input.projectId,
        threadId: (input.threadId ?? null) as MemoryEntry["threadId"],
        kind: input.kind,
        title: input.title,
        content: input.content,
        tags: input.tags,
        relevanceScore: 0.5,
        accessCount: 0,
        createdAt: now,
        updatedAt: now,
        expiresAt: (input.expiresAt ?? null) as MemoryEntry["expiresAt"],
      } as MemoryEntry;
    }).pipe(Effect.orDie);

  const search: ProjectMemoryServiceShape["search"] = (input) =>
    Effect.gen(function* () {
      const start = Date.now();
      // Use FTS5 for full-text search
      const rows = yield* sql.unsafe<{
        id: string;
        project_id: string;
        thread_id: string | null;
        kind: string;
        title: string;
        content: string;
        tags: string;
        relevance_score: number;
        access_count: number;
        created_at: string;
        updated_at: string;
        expires_at: string | null;
        rank: number;
      }>(
        `SELECT m.*, fts.rank
         FROM memory_fts fts
         JOIN memory_entries m ON m.rowid = fts.rowid
         WHERE memory_fts MATCH ?
           AND m.project_id = ?
           ${input.kind ? `AND m.kind = '${input.kind}'` : ""}
           AND (m.expires_at IS NULL OR m.expires_at > datetime('now'))
         ORDER BY fts.rank
         LIMIT ?`,
        [input.query, input.projectId, input.limit],
      );

      // Increment access count
      if (rows.length > 0) {
        const ids = rows.map((r) => `'${r.id}'`).join(",");
        yield* sql.unsafe(
          `UPDATE memory_entries SET access_count = access_count + 1 WHERE id IN (${ids})`,
        );
      }

      const results: MemorySearchResult[] = rows.map((r) => ({
        entry: {
          id: r.id as MemoryEntryId,
          projectId: r.project_id as MemoryEntry["projectId"],
          threadId: (r.thread_id ?? null) as MemoryEntry["threadId"],
          kind: r.kind as MemoryEntry["kind"],
          title: r.title as MemoryEntry["title"],
          content: r.content as MemoryEntry["content"],
          tags: JSON.parse(r.tags) as string[],
          relevanceScore: r.relevance_score,
          accessCount: r.access_count,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          expiresAt: (r.expires_at ?? null) as MemoryEntry["expiresAt"],
        } as MemoryEntry,
        matchScore: -r.rank, // FTS5 rank is negative; flip for display
        matchSnippet: null,
      }));

      return { results, queryTime: Date.now() - start };
    }).pipe(Effect.orDie);

  const forget: ProjectMemoryServiceShape["forget"] = (input) =>
    sql`DELETE FROM memory_entries WHERE id = ${input.entryId}`.pipe(Effect.asVoid, Effect.orDie);

  const list: ProjectMemoryServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const kindFilter = input.kind ? sql`AND kind = ${input.kind}` : sql``;
      const rows = yield* sql<{
        id: string;
        project_id: string;
        thread_id: string | null;
        kind: string;
        title: string;
        content: string;
        tags: string;
        relevance_score: number;
        access_count: number;
        created_at: string;
        updated_at: string;
        expires_at: string | null;
      }>`SELECT * FROM memory_entries
         WHERE project_id = ${input.projectId} ${kindFilter}
           AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY updated_at DESC
         LIMIT ${input.limit} OFFSET ${input.offset}`;
      const countRow = yield* sql<{
        total: number;
      }>`SELECT COUNT(*) as total FROM memory_entries WHERE project_id = ${input.projectId} ${kindFilter}`;
      return {
        entries: rows.map((r) => ({
          id: r.id as MemoryEntryId,
          projectId: r.project_id as MemoryEntry["projectId"],
          threadId: (r.thread_id ?? null) as MemoryEntry["threadId"],
          kind: r.kind as MemoryEntry["kind"],
          title: r.title as MemoryEntry["title"],
          content: r.content as MemoryEntry["content"],
          tags: JSON.parse(r.tags) as string[],
          relevanceScore: r.relevance_score,
          accessCount: r.access_count,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          expiresAt: (r.expires_at ?? null) as MemoryEntry["expiresAt"],
        })) as MemoryEntry[],
        total: countRow[0]?.total ?? 0,
      };
    }).pipe(Effect.orDie);

  const index: ProjectMemoryServiceShape["index"] = (input) =>
    Effect.gen(function* () {
      const start = Date.now();
      if (input.forceReindex) {
        // Rebuild FTS index
        yield* sql.unsafe("INSERT INTO memory_fts(memory_fts) VALUES('rebuild')");
      }
      const rows = yield* sql<{
        count: number;
      }>`SELECT COUNT(*) as count FROM memory_entries WHERE project_id = ${input.projectId}`;
      return { entriesIndexed: rows[0]?.count ?? 0, duration: Date.now() - start };
    }).pipe(Effect.orDie);

  return { add, search, forget, list, index };
});

export const ProjectMemoryServiceLive = Layer.effect(
  ProjectMemoryService,
  makeProjectMemoryService,
);
