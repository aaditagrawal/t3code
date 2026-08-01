import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { describe } from "vite-plus/test";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

/** See 037's note: a shared database makes every case after the first vacuous. */
const onFreshDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.provide(effect, NodeSqliteClient.layerMemory());

/** Raw PRAGMA rows, not a Set — a Set cannot express a duplicate column. */
const columnNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  return columns.map((column) => column.name);
});

describe("036_ProjectionThreadTitleRegenerationFailure", () => {
  it.effect("adds the title regeneration failure columns", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: 38 });

        const before = yield* columnNames;
        assert.ok(!before.includes("title_regeneration_failure_error"));

        yield* runMigrations({ toMigrationInclusive: 39 });

        const after = yield* columnNames;
        assert.ok(after.includes("title_regeneration_failure_request_id"));
        assert.ok(after.includes("title_regeneration_failure_at"));
        assert.ok(after.includes("title_regeneration_failure_error"));
        // The pending columns stay separate so "in flight" keeps its meaning.
        assert.ok(after.includes("title_regeneration_request_id"));
        assert.ok(after.includes("title_regeneration_started_at"));
      }),
    ),
  );

  it.effect("adds each column exactly once", () =>
    onFreshDatabase(
      Effect.gen(function* () {
        yield* runMigrations({ toMigrationInclusive: 39 });

        const columns = yield* columnNames;
        for (const column of [
          "title_regeneration_failure_request_id",
          "title_regeneration_failure_at",
          "title_regeneration_failure_error",
        ]) {
          assert.strictEqual(
            columns.filter((name) => name === column).length,
            1,
            `${column} should exist exactly once`,
          );
        }
      }),
    ),
  );
});
