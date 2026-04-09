import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("021_RepairProjectionThreadProposedPlanImplementationColumns", (it) => {
  it.effect(
    "repairs missing proposed plan implementation columns when migration history is ahead",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 13 });

        yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (14, 'ProjectionThreadProposedPlanImplementation'),
          (15, 'ProjectionTurnsSourceProposedPlan'),
          (16, 'CanonicalizeModelSelections'),
          (17, 'ProjectionThreadsArchivedAt'),
          (18, 'ProjectionThreadsArchivedAtIndex'),
          (19, 'ProjectionSnapshotLookupIndexes'),
          (20, 'NormalizeLegacyProviderKinds')
      `;

        const columnsBeforeRepair = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_proposed_plans)
      `;
        assert.ok(!columnsBeforeRepair.some((column) => column.name === "implemented_at"));
        assert.ok(
          !columnsBeforeRepair.some((column) => column.name === "implementation_thread_id"),
        );

        yield* runMigrations();

        const columnsAfterRepair = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_proposed_plans)
      `;
        assert.ok(columnsAfterRepair.some((column) => column.name === "implemented_at"));
        assert.ok(columnsAfterRepair.some((column) => column.name === "implementation_thread_id"));
      }),
  );
});
