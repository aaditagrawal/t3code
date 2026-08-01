/**
 * Repairs databases that applied migration 39 while it still carried its
 * pre-review shape.
 *
 * Migration 39 originally added a single `title_regeneration_error` column, and
 * was then rewritten in place to add the three `title_regeneration_failure_*`
 * columns instead. The migrator records applied migrations by numeric id and
 * skips anything at or below the latest recorded id without comparing names, so
 * a database that ran the earlier shape treats the rewritten 39 as done and
 * never grows the failure columns — every thread and shell snapshot query then
 * fails on the missing columns.
 *
 * Both shapes of 39 reached `main` in the same merge, so no released build ever
 * carried the earlier one — the affected databases are those on machines that
 * ran the PR branch mid-review. Narrow, but the failure is a hard one: every
 * thread and shell snapshot query selects the missing columns.
 *
 * Adding them again under a fresh id fixes those databases and no-ops on any
 * database that got them from 39. The orphaned `title_regeneration_error`
 * column is left in place: it is nullable and unreferenced, and dropping it
 * would rewrite the table for no benefit.
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("title_regeneration_failure_request_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_regeneration_failure_request_id TEXT
    `;
  }

  if (!names.has("title_regeneration_failure_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_regeneration_failure_at TEXT
    `;
  }

  if (!names.has("title_regeneration_failure_error")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_regeneration_failure_error TEXT
    `;
  }
});
