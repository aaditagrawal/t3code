import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const columnNames = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  return new Set(columns.map((column) => column.name));
});

layer("037_RepairProjectionThreadTitleRegenerationFailure", (it) => {
  it.effect("adds the failure columns to a database that ran the pre-review 39", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Reproduce the shape migration 39 had before it was rewritten: one
      // `title_regeneration_error` column, recorded under the old name. The
      // migrator skips by id without comparing names, so the rewritten 39 is
      // treated as already applied and never runs.
      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN title_regeneration_error TEXT
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (39, 'ProjectionThreadTitleRegenerationError')
      `;

      const beforeRepair = yield* columnNames;
      assert.ok(!beforeRepair.has("title_regeneration_failure_error"));

      const executed = yield* runMigrations({ toMigrationInclusive: 40 });
      assert.deepStrictEqual(
        executed.map(([id]) => id),
        [40],
      );

      const names = yield* columnNames;
      assert.ok(names.has("title_regeneration_failure_request_id"));
      assert.ok(names.has("title_regeneration_failure_at"));
      assert.ok(names.has("title_regeneration_failure_error"));
    }),
  );

  it.effect("no-ops on a database that got the columns from 39", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 39 });
      const afterThirtyNine = yield* columnNames;
      assert.ok(afterThirtyNine.has("title_regeneration_failure_error"));

      yield* runMigrations({ toMigrationInclusive: 40 });

      const names = yield* columnNames;
      assert.strictEqual(
        [...names].filter((name) => name === "title_regeneration_failure_error").length,
        1,
      );
      assert.ok(names.has("title_regeneration_failure_request_id"));
      assert.ok(names.has("title_regeneration_failure_at"));
    }),
  );

  it.effect("is idempotent when run twice", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* runMigrations({ toMigrationInclusive: 40 });

      const names = yield* columnNames;
      assert.ok(names.has("title_regeneration_failure_request_id"));
      assert.ok(names.has("title_regeneration_failure_at"));
      assert.ok(names.has("title_regeneration_failure_error"));
    }),
  );
});
