import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

export type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly readonly?: boolean;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient, SqlError>;
};

export const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  // Keep the runtime branch directly around the import so Node-only executable
  // builds can remove the Bun client before flattening modules into one file.
  const clientModule = yield* Effect.promise<Loader>(() =>
    process.versions.bun !== undefined
      ? import("@effect/sql-sqlite-bun/SqliteClient")
      : import("@t3tools/shared/nodeSqliteClient"),
  );
  return clientModule.layer(config);
}, Layer.unwrap);
