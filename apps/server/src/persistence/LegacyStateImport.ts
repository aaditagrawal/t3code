/**
 * Carry old fork state into the default private home only after validating its
 * migration lineage. The legacy database is opened read-only; SQLite creates a
 * consistent snapshot before any destination files are published.
 */
import { LEGACY_IMPORT_MARKER_FILENAME } from "@t3tools/shared/branding";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeRuntimeSqliteLayer } from "./Layers/RuntimeSqliteLayer.ts";
import {
  checkMigrationLineage,
  describeMigrationLineageVerdict,
  type KnownMigration,
  type RecordedMigration,
} from "./MigrationLineage.ts";
import { migrationManifest } from "./Migrations.ts";

export const STATE_DIR_NAME = "userdata";

export const STATE_DB_FILENAME = "state.sqlite";

export const STATE_DB_SIDECAR_SUFFIXES = ["-wal", "-shm"] as const;

export const FORK_ONLY_MIGRATION_MARKERS: ReadonlyArray<KnownMigration> = [
  [23, "NormalizeLegacyProviderKinds"],
  [24, "RepairProjectionThreadProposedPlanImplementationColumns"],
  [31, "BackfillForkProviderInstanceIds"],
];

export const EXCLUDED_HOME_ENTRIES: ReadonlySet<string> = new Set([
  "worktrees",
  "logs",
  "tools",
  "dev",
]);

export const EXCLUDED_STATE_ENTRIES: ReadonlySet<string> = new Set([
  "server-runtime.json",
  "logs",
  "tools",
  ...STATE_DB_SIDECAR_SUFFIXES.map((suffix) => `${STATE_DB_FILENAME}${suffix}`),
]);

const STAGING_DIR_SUFFIX = ".legacy-import-staging";

const MARKER_VERSION = 1;

export interface LegacyImportProbe {
  readonly baseDirIsDefaultHome: boolean;

  readonly stateDirIsDefault: boolean;

  readonly newHomeHasDatabase: boolean;

  readonly newHomeHasImportMarker: boolean;

  readonly legacyHasDatabase: boolean;

  readonly legacyIsSameAsNew: boolean;
}

export type LegacyImportSkipReason =
  | "custom-base-dir"
  | "non-default-state-dir"
  | "legacy-is-current-home"
  | "already-imported"
  | "new-home-in-use"
  | "no-legacy-database";

export type LegacyImportDecision =
  | { readonly _tag: "Proceed" }
  | { readonly _tag: "Skip"; readonly reason: LegacyImportSkipReason };

export function decideLegacyImport(probe: LegacyImportProbe): LegacyImportDecision {
  if (!probe.baseDirIsDefaultHome) {
    // The user pointed this build somewhere explicitly (T3CODE_HOME/--base-dir).
    // Never surprise them by populating it from an unrelated directory.
    return { _tag: "Skip", reason: "custom-base-dir" };
  }
  if (!probe.stateDirIsDefault) {
    return { _tag: "Skip", reason: "non-default-state-dir" };
  }
  if (probe.legacyIsSameAsNew) {
    return { _tag: "Skip", reason: "legacy-is-current-home" };
  }
  if (probe.newHomeHasImportMarker) {
    return { _tag: "Skip", reason: "already-imported" };
  }
  if (probe.newHomeHasDatabase) {
    return { _tag: "Skip", reason: "new-home-in-use" };
  }
  if (!probe.legacyHasDatabase) {
    return { _tag: "Skip", reason: "no-legacy-database" };
  }
  return { _tag: "Proceed" };
}

export type LegacyDatabaseVerdict =
  | { readonly _tag: "Import"; readonly marker: KnownMigration }
  | { readonly _tag: "NotFork" }
  | { readonly _tag: "IncompatibleLineage"; readonly detail: string };

export function classifyLegacyDatabase(
  recorded: ReadonlyArray<RecordedMigration>,
  known: ReadonlyArray<KnownMigration> = migrationManifest,
  markers: ReadonlyArray<KnownMigration> = FORK_ONLY_MIGRATION_MARKERS,
): LegacyDatabaseVerdict {
  const recordedByName = new Map(recorded.map((row) => [`${row.id}_${row.name}`, row]));
  const marker = markers.find(([id, name]) => recordedByName.has(`${id}_${name}`));
  if (marker === undefined) {
    return { _tag: "NotFork" };
  }

  const verdict = checkMigrationLineage(recorded, known);
  if (verdict._tag !== "Compatible") {
    return { _tag: "IncompatibleLineage", detail: describeMigrationLineageVerdict(verdict) };
  }

  return { _tag: "Import", marker };
}

export function selectImportableEntries(
  entries: ReadonlyArray<string>,
  excluded: ReadonlySet<string>,
): { readonly copy: ReadonlyArray<string>; readonly excluded: ReadonlyArray<string> } {
  const copy: Array<string> = [];
  const dropped: Array<string> = [];
  for (const entry of entries) {
    if (excluded.has(entry) || entry.endsWith(STAGING_DIR_SUFFIX)) {
      dropped.push(entry);
    } else {
      copy.push(entry);
    }
  }
  return { copy, excluded: dropped };
}

export function describeLegacyImportRefusal(
  legacyHome: string,
  reason: "incompatible-lineage" | "corrupt-database",
  detail: string,
): string {
  const shared = `Your previous data is untouched at ${legacyHome}. Nothing was imported; this build is starting with an empty state directory. To work with the old data deliberately, start a build with T3CODE_HOME=${legacyHome} (and a distinct T3CODE_PORT).`;
  return reason === "incompatible-lineage"
    ? `Refusing to import legacy state: the database at ${legacyHome} has a migration history incompatible with this build. ${detail} ${shared}`
    : `Refusing to import legacy state: the database at ${legacyHome} failed an integrity check (${detail}). ${shared}`;
}

export type LegacyImportOutcome =
  | { readonly _tag: "Skipped"; readonly reason: LegacyImportSkipReason }
  | {
      readonly _tag: "Imported";
      readonly source: string;
      readonly destination: string;
      readonly entries: ReadonlyArray<string>;
      readonly worktrees: "symlinked" | "left-behind" | "absent";
    }
  | {
      readonly _tag: "Refused";
      readonly reason: "not-fork" | "incompatible-lineage" | "corrupt-database";
      readonly detail: string;
    }
  | { readonly _tag: "Failed"; readonly detail: string };

export interface LegacyStateImportOptions {
  readonly baseDir: string;

  readonly defaultBaseDir: string;

  readonly legacyBaseDir: string;

  readonly stateDir: string;
}

export const LegacyWorktreesDisposition = Schema.Literals(["symlinked", "left-behind", "absent"]);
export type LegacyWorktreesDisposition = typeof LegacyWorktreesDisposition.Type;

export const LegacyImportMarker = Schema.Struct({
  version: Schema.Number,
  importedAt: Schema.String,
  source: Schema.String,
  destination: Schema.String,
  forkMarkerMigration: Schema.String,
  entries: Schema.Array(Schema.String),
  excludedEntries: Schema.Array(Schema.String),
  worktrees: LegacyWorktreesDisposition,
});
export type LegacyImportMarker = typeof LegacyImportMarker.Type;

export const LegacyImportMarkerJson = fromJsonStringPretty(LegacyImportMarker);

const encodeMarker = Schema.encodeEffect(LegacyImportMarkerJson);

export class LegacyStateImportError extends Schema.TaggedErrorClass<LegacyStateImportError>()(
  "LegacyStateImportError",
  {
    legacyBaseDir: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to import legacy T3 Code state from ${this.legacyBaseDir}: ${this.detail}`;
  }
}

const exists = Effect.fn("LegacyStateImport.exists")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.exists(path);
});

const readDirectory = Effect.fn("LegacyStateImport.readDirectory")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readDirectory(path);
});

const inspectStagedDatabase = Effect.fn("LegacyStateImport.inspectStagedDatabase")(function* (
  stagedDbPath: string,
) {
  const program = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    // Folds `-wal` into the main file and deletes the sidecars, so the imported
    // database is a single self-contained file. Startup restores WAL mode.
    yield* sql`PRAGMA journal_mode = DELETE;`;

    const integrityRows = yield* sql<Record<string, unknown>>`PRAGMA quick_check;`;
    const integrity = integrityRows
      .flatMap((row) => Object.values(row))
      .map((value) => String(value));
    const healthy = integrity.length > 0 && integrity.every((value) => value === "ok");

    const rows = yield* sql<{
      readonly migration_id: number;
      readonly name: string;
    }>`SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id`.pipe(
      Effect.orElseSucceed(
        () => [] as ReadonlyArray<{ readonly migration_id: number; readonly name: string }>,
      ),
    );

    return {
      healthy,
      integrity: integrity.join("; ") || "no result",
      recorded: rows.map((row) => ({ id: Number(row.migration_id), name: row.name })),
    };
  });

  return yield* Effect.provide(program, makeRuntimeSqliteLayer({ filename: stagedDbPath }));
});

const moveIfAbsent = Effect.fn("LegacyStateImport.moveIfAbsent")(function* (
  stagedPath: string,
  destinationPath: string,
): Effect.fn.Return<
  boolean,
  import("effect/PlatformError").PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const destinationLink = yield* fs
    .readLink(destinationPath)
    .pipe(Effect.orElseSucceed(() => undefined));
  if (destinationLink !== undefined) return false;
  if (yield* exists(destinationPath)) {
    const sourceInfo = yield* fs.stat(stagedPath);
    const destinationInfo = yield* fs.stat(destinationPath);
    if (sourceInfo.type === "Directory" && destinationInfo.type === "Directory") {
      let moved = false;
      for (const entry of yield* fs.readDirectory(stagedPath)) {
        moved =
          (yield* moveIfAbsent(path.join(stagedPath, entry), path.join(destinationPath, entry))) ||
          moved;
      }
      return moved;
    }
    yield* Effect.logDebug("Keeping existing entry; not overwriting from legacy import").pipe(
      Effect.annotateLogs({ destinationPath }),
    );
    return false;
  }
  yield* fs.rename(stagedPath, destinationPath);
  return true;
});

const linkWorktrees = Effect.fn("LegacyStateImport.linkWorktrees")(function* (
  legacyBaseDir: string,
  baseDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const legacyWorktrees = path.join(legacyBaseDir, "worktrees");
  if (!(yield* exists(legacyWorktrees))) {
    return "absent";
  }

  const newWorktrees = path.join(baseDir, "worktrees");
  if (yield* exists(newWorktrees)) {
    // Startup may already have created an empty placeholder; replace it. A
    // non-empty directory belongs to this build and is left alone.
    const realWorktrees = yield* fs
      .realPath(newWorktrees)
      .pipe(Effect.orElseSucceed(() => undefined));
    const canonicalParent = yield* fs.realPath(baseDir);
    if (realWorktrees !== path.join(canonicalParent, "worktrees")) return "left-behind";
    const entries = yield* fs
      .readDirectory(newWorktrees)
      .pipe(Effect.orElseSucceed(() => ["unreadable"]));
    if (entries.length > 0) {
      return "left-behind";
    }
    const removed = yield* fs.remove(newWorktrees, { recursive: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (!removed) {
      return "left-behind";
    }
  }

  return yield* fs.symlink(legacyWorktrees, newWorktrees).pipe(
    Effect.as("symlinked" as const),
    Effect.catchCause((cause) =>
      Effect.logWarning(
        "Could not link legacy worktrees into the new home; existing worktrees stay at their old path",
      ).pipe(
        Effect.annotateLogs({ legacyWorktrees, newWorktrees, cause: String(cause) }),
        Effect.as("left-behind" as const),
      ),
    ),
  );
});

// Symlinks in settings/attachments could retain shared mutable state after import.
// Reject them before publication; worktrees are handled explicitly below.
const assertNoSymlinks = Effect.fn("LegacyStateImport.assertNoSymlinks")(function* (
  source: string,
): Effect.fn.Return<
  void,
  import("effect/PlatformError").PlatformError | LegacyStateImportError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const link = yield* fs.readLink(source).pipe(Effect.orElseSucceed(() => undefined));
  if (link !== undefined) {
    return yield* new LegacyStateImportError({
      legacyBaseDir: source,
      detail: "Cannot automatically import symbolic links in legacy state.",
    });
  }
  const info = yield* fs.stat(source);
  if (info.type === "Directory") {
    for (const child of yield* fs.readDirectory(source)) {
      yield* assertNoSymlinks(path.join(source, child));
    }
  }
});

const runImport = Effect.fn("LegacyStateImport.run")(function* (options: LegacyStateImportOptions) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const { baseDir, defaultBaseDir, legacyBaseDir, stateDir } = options;
  const newStateDir = path.join(baseDir, STATE_DIR_NAME);
  const newDbPath = path.join(newStateDir, STATE_DB_FILENAME);
  const markerPath = path.join(baseDir, LEGACY_IMPORT_MARKER_FILENAME);
  const legacyStateDir = path.join(legacyBaseDir, STATE_DIR_NAME);
  const legacyDbPath = path.join(legacyStateDir, STATE_DB_FILENAME);

  const canonicalBase = yield* fs
    .realPath(baseDir)
    .pipe(Effect.orElseSucceed(() => path.resolve(baseDir)));
  const canonicalLegacy = yield* fs
    .realPath(legacyBaseDir)
    .pipe(Effect.orElseSucceed(() => path.resolve(legacyBaseDir)));
  const decision = decideLegacyImport({
    baseDirIsDefaultHome: path.resolve(baseDir) === path.resolve(defaultBaseDir),
    stateDirIsDefault: path.resolve(stateDir) === path.resolve(newStateDir),
    legacyIsSameAsNew: canonicalBase === canonicalLegacy,
    newHomeHasDatabase: yield* exists(newDbPath),
    newHomeHasImportMarker: yield* exists(markerPath),
    legacyHasDatabase: yield* exists(legacyDbPath),
  });

  if (decision._tag === "Skip") {
    yield* Effect.logDebug("Legacy state import not applicable").pipe(
      Effect.annotateLogs({ reason: decision.reason, legacyBaseDir, baseDir }),
    );
    return { _tag: "Skipped", reason: decision.reason } satisfies LegacyImportOutcome;
  }

  const stagingDir = yield* fs.makeTempDirectoryScoped({
    directory: path.dirname(baseDir),
    prefix: ".t3code-fork.legacy-import-staging-",
  });
  const stagedStateDir = path.join(stagingDir, STATE_DIR_NAME);
  const stagedDbPath = path.join(stagedStateDir, STATE_DB_FILENAME);
  yield* fs.makeDirectory(stagedStateDir, { recursive: true });

  // SQLite takes a consistent read snapshot, including committed WAL frames.
  // Copying the three files independently can silently lose transactions when
  // a checkpoint or WAL reset occurs between copies, even if quick_check passes.
  yield* Effect.provide(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA busy_timeout = 5000`;
      yield* sql`VACUUM INTO ${stagedDbPath}`;
    }),
    makeRuntimeSqliteLayer({ filename: legacyDbPath, readonly: true }),
  );

  const inspection = yield* inspectStagedDatabase(stagedDbPath);

  if (!inspection.healthy) {
    const detail = describeLegacyImportRefusal(
      legacyBaseDir,
      "corrupt-database",
      inspection.integrity,
    );
    yield* Effect.logError(detail);
    return { _tag: "Refused", reason: "corrupt-database", detail } satisfies LegacyImportOutcome;
  }

  const verdict = classifyLegacyDatabase(inspection.recorded);

  if (verdict._tag === "NotFork") {
    const detail = `Found a legacy state directory at ${legacyBaseDir}, but its database was not written by this build. Leaving it untouched.`;
    yield* Effect.log(detail);
    return { _tag: "Refused", reason: "not-fork", detail } satisfies LegacyImportOutcome;
  }

  if (verdict._tag === "IncompatibleLineage") {
    const detail = describeLegacyImportRefusal(
      legacyBaseDir,
      "incompatible-lineage",
      verdict.detail,
    );
    yield* Effect.logError(detail);
    return {
      _tag: "Refused",
      reason: "incompatible-lineage",
      detail,
    } satisfies LegacyImportOutcome;
  }

  // Stage everything else.
  const homeSelection = selectImportableEntries(
    yield* readDirectory(legacyBaseDir),
    new Set([...EXCLUDED_HOME_ENTRIES, STATE_DIR_NAME]),
  );
  for (const entry of homeSelection.copy) {
    yield* assertNoSymlinks(path.join(legacyBaseDir, entry));
    yield* fs.copy(path.join(legacyBaseDir, entry), path.join(stagingDir, entry));
  }

  const stateSelection = selectImportableEntries(
    yield* readDirectory(legacyStateDir),
    new Set([...EXCLUDED_STATE_ENTRIES, STATE_DB_FILENAME]),
  );
  for (const entry of stateSelection.copy) {
    yield* assertNoSymlinks(path.join(legacyStateDir, entry));
    yield* fs.copy(path.join(legacyStateDir, entry), path.join(stagedStateDir, entry));
  }

  // Publish. `state.sqlite` moves last so the detection predicate only flips
  // once the rest of the state is already in place.
  yield* fs.makeDirectory(newStateDir, { recursive: true });

  const moved: Array<string> = [];
  for (const entry of homeSelection.copy) {
    if (yield* moveIfAbsent(path.join(stagingDir, entry), path.join(baseDir, entry))) {
      moved.push(entry);
    }
  }
  for (const entry of stateSelection.copy) {
    if (yield* moveIfAbsent(path.join(stagedStateDir, entry), path.join(newStateDir, entry))) {
      moved.push(`${STATE_DIR_NAME}/${entry}`);
    }
  }

  const worktrees = yield* linkWorktrees(legacyBaseDir, baseDir);

  // Hard-link publication fails if another startup already created the database.
  yield* fs.link(stagedDbPath, newDbPath);
  moved.push(`${STATE_DIR_NAME}/${STATE_DB_FILENAME}`);

  const marker: LegacyImportMarker = {
    version: MARKER_VERSION,
    importedAt: DateTime.formatIso(yield* DateTime.now),
    source: legacyBaseDir,
    destination: baseDir,
    forkMarkerMigration: `${verdict.marker[0]}_${verdict.marker[1]}`,
    entries: moved,
    excludedEntries: [
      ...homeSelection.excluded,
      ...stateSelection.excluded.map((entry) => `${STATE_DIR_NAME}/${entry}`),
    ],
    worktrees,
  };
  yield* fs.writeFileString(markerPath, `${yield* encodeMarker(marker)}\n`);

  yield* Effect.log("Imported existing T3 Code state from the legacy home directory").pipe(
    Effect.annotateLogs({
      source: legacyBaseDir,
      destination: baseDir,
      entries: moved,
      excluded: marker.excludedEntries,
      worktrees,
      forkMarkerMigration: marker.forkMarkerMigration,
    }),
  );

  return {
    _tag: "Imported",
    source: legacyBaseDir,
    destination: baseDir,
    entries: moved,
    worktrees,
  } satisfies LegacyImportOutcome;
});

export const importLegacyStateIfNeeded = Effect.fn("importLegacyStateIfNeeded")(function* (
  options: LegacyStateImportOptions,
): Effect.fn.Return<LegacyImportOutcome, never, FileSystem.FileSystem | Path.Path> {
  return yield* runImport(options).pipe(
    Effect.scoped,
    // One typed failure out of the module; platform/SQL errors never leak.
    Effect.mapError(
      (cause) =>
        new LegacyStateImportError({
          legacyBaseDir: options.legacyBaseDir,
          detail: String(cause),
        }),
    ),
    Effect.catchCause((cause) =>
      Effect.logError("Legacy state import failed; starting with the current state directory").pipe(
        Effect.annotateLogs({ cause: String(cause), legacyBaseDir: options.legacyBaseDir }),
        Effect.as({ _tag: "Failed", detail: String(cause) } satisfies LegacyImportOutcome),
      ),
    ),
  );
});
