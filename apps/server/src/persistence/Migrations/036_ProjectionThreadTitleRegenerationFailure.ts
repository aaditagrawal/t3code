import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const names = new Set(columns.map((column) => column.name));

  // Siblings of the pending title_regeneration_* columns rather than fields on
  // them: the pending record has to stay strictly pending, because clients read
  // "regeneration in flight" as "titleRegeneration is not null".
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
