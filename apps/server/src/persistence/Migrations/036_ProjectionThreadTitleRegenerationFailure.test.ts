import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_ProjectionThreadTitleRegenerationFailure", (it) => {
  it.effect("adds the title regeneration failure columns", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 38 });
      yield* runMigrations({ toMigrationInclusive: 39 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const names = new Set(columns.map((column) => column.name));
      assert.ok(names.has("title_regeneration_failure_request_id"));
      assert.ok(names.has("title_regeneration_failure_at"));
      assert.ok(names.has("title_regeneration_failure_error"));
      // The pending columns stay separate so "in flight" keeps its meaning.
      assert.ok(names.has("title_regeneration_request_id"));
      assert.ok(names.has("title_regeneration_started_at"));
    }),
  );

  it.effect("is idempotent when the columns already exist", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 39 });
      yield* runMigrations({ toMigrationInclusive: 39 });

      const sql = yield* SqlClient.SqlClient;
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.strictEqual(
        columns.filter((column) => column.name === "title_regeneration_failure_error").length,
        1,
      );
    }),
  );
});
