import * as NodeSqlite from "node:sqlite";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { adoptionSourceFilenames } from "./stateDatabaseLineage.ts";

export class V2DatabaseImportError extends Schema.TaggedError<V2DatabaseImportError>()(
  "V2DatabaseImportError",
  { sourcePath: Schema.String, destinationPath: Schema.String, cause: Schema.Defect() },
) {
  override get message() {
    return `Could not copy the previous database at ${this.sourcePath} to ${this.destinationPath}. The previous database has not been migrated.`;
  }
}

/** Seed the live database once from the newest previous filename in the same directory. */
export const initializeV2Database = Effect.fn("initializeV2Database")(function* (
  destinationPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.dirname(destinationPath);
  const sourcePath = yield* Effect.gen(function* () {
    for (const filename of adoptionSourceFilenames(path.basename(destinationPath))) {
      const candidate = path.join(directory, filename);
      if (yield* fs.exists(candidate)) return candidate;
    }
    return undefined;
  });
  yield* Effect.gen(function* () {
    if (sourcePath === undefined) return;
    if (yield* fs.exists(destinationPath)) return;
    if (!(yield* fs.exists(sourcePath))) return;
    const temporaryDirectory = yield* fs.makeTempDirectoryScoped({
      directory,
      prefix: ".v2-import-",
    });
    const snapshotPath = path.join(temporaryDirectory, "snapshot.sqlite");
    yield* Effect.tryPromise(async () => {
      const database = new NodeSqlite.DatabaseSync(sourcePath, { readOnly: true });
      try {
        await NodeSqlite.backup(database, snapshotPath);
      } finally {
        database.close();
      }
    });
    // Publish only a complete snapshot, without replacing an existing V2 database.
    yield* fs
      .link(snapshotPath, destinationPath)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "AlreadyExists" ? Effect.void : Effect.fail(error),
        ),
      );
  }).pipe(
    Effect.scoped,
    Effect.mapError(
      (cause) =>
        new V2DatabaseImportError({
          sourcePath: sourcePath ?? destinationPath,
          destinationPath,
          cause,
        }),
    ),
  );
});
