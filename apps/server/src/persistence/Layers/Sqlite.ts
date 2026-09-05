import * as NodeOS from "node:os";
import { HOME_DIR_NAME, LEGACY_HOME_DIR_NAME } from "@t3tools/shared/branding";
import { importLegacyStateIfNeeded } from "../LegacyStateImport.ts";
import { makeRuntimeSqliteLayer } from "./RuntimeSqliteLayer.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // CLI and server write from separate processes; wait rather than fail with SQLITE_BUSY.
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* runMigrations();
  }),
);

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    setup,
    makeRuntimeSqliteLayer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "t3-server",
      },
    }),
  );
}, Layer.unwrap);

export const SqlitePersistenceMemory = Layer.provideMerge(
  setup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.gen(function* () {
    const { baseDir, dbPath, stateDir } = yield* ServerConfig;
    const path = yield* Path.Path;
    const home = NodeOS.homedir();
    yield* importLegacyStateIfNeeded({
      baseDir,
      stateDir,
      defaultBaseDir: path.join(home, HOME_DIR_NAME),
      legacyBaseDir: path.join(home, LEGACY_HOME_DIR_NAME),
    });
    return makeSqlitePersistenceLive(dbPath);
  }),
);
