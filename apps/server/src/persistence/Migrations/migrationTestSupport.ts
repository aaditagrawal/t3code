/**
 * Shared helpers for migration tests.
 *
 * The `it.layer` idiom used by most tests in this directory hands every case in
 * a block the same in-memory database. Once one case migrates to the head id,
 * the migrator skips every later `runMigrations` call — later cases then assert
 * against a database no migration body touched and pass vacuously. Migration
 * tests therefore need a database per case, which is what `onFreshDatabase`
 * provides.
 *
 * @module migrationTestSupport
 */
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../NodeSqliteClient.ts";

/** Run one test case against its own empty in-memory database. */
export const onFreshDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.provide(effect, NodeSqliteClient.layerMemory());

/**
 * Column names of a table as raw PRAGMA rows.
 *
 * Deliberately an array rather than a `Set`: a duplicate-column assertion
 * against a `Set` is true by construction and can never fail.
 */
export const columnNames = (table: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const columns = yield* sql<{ readonly name: string }>`
      SELECT name FROM pragma_table_info(${table})
    `;
    return columns.map((column) => column.name);
  });
