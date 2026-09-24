// @effect-diagnostics nodeBuiltinImport:off - Fixtures build real directory trees on disk.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { afterEach, describe, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  classifyLegacyDatabase,
  decideLegacyImport,
  describeLegacyImportRefusal,
  FORK_ONLY_MIGRATION_MARKERS,
  importLegacyStateIfNeeded,
  type LegacyImportProbe,
  LegacyImportMarkerJson,
  selectImportableEntries,
} from "./LegacyStateImport.ts";
import { makeSqlitePersistenceLive } from "./Layers/Sqlite.ts";
import { migrationManifest } from "./Migrations.ts";
import { LEGACY_IMPORT_MARKER_FILENAME } from "@t3tools/shared/branding";

// ---------------------------------------------------------------------------
// Pure decision logic
// ---------------------------------------------------------------------------

const proceedingProbe: LegacyImportProbe = {
  baseDirIsDefaultHome: true,
  stateDirIsDefault: true,
  newHomeHasDatabase: false,
  newHomeHasImportMarker: false,
  legacyHasDatabase: true,
  legacyIsSameAsNew: false,
};

describe("FORK_ONLY_MIGRATION_MARKERS", () => {
  it("only lists migrations that this build actually declares", () => {
    const manifest = new Set(migrationManifest.map(([id, name]) => `${id}_${name}`));
    for (const [id, name] of FORK_ONLY_MIGRATION_MARKERS) {
      expect(manifest.has(`${id}_${name}`), `${id}_${name} is missing from migrationManifest`).toBe(
        true,
      );
    }
  });
});

describe("decideLegacyImport", () => {
  it("proceeds for a default home with a legacy database and no state of its own", () => {
    expect(decideLegacyImport(proceedingProbe)).toEqual({ _tag: "Proceed" });
  });

  it("skips when the user pointed this build at an explicit base directory", () => {
    expect(decideLegacyImport({ ...proceedingProbe, baseDirIsDefaultHome: false })).toEqual({
      _tag: "Skip",
      reason: "custom-base-dir",
    });
  });

  it("skips in dev mode, where the state directory is not userdata", () => {
    expect(decideLegacyImport({ ...proceedingProbe, stateDirIsDefault: false })).toEqual({
      _tag: "Skip",
      reason: "non-default-state-dir",
    });
  });

  it("skips when the legacy home and the current home are the same directory", () => {
    expect(decideLegacyImport({ ...proceedingProbe, legacyIsSameAsNew: true })).toEqual({
      _tag: "Skip",
      reason: "legacy-is-current-home",
    });
  });

  it("skips when the marker records a completed import", () => {
    expect(decideLegacyImport({ ...proceedingProbe, newHomeHasImportMarker: true })).toEqual({
      _tag: "Skip",
      reason: "already-imported",
    });
  });

  it("skips when the new home already holds a database", () => {
    expect(decideLegacyImport({ ...proceedingProbe, newHomeHasDatabase: true })).toEqual({
      _tag: "Skip",
      reason: "new-home-in-use",
    });
  });

  it("skips a fresh install with no legacy directory", () => {
    expect(decideLegacyImport({ ...proceedingProbe, legacyHasDatabase: false })).toEqual({
      _tag: "Skip",
      reason: "no-legacy-database",
    });
  });
});

const forkRecorded = migrationManifest.map(([id, name]) => ({ id, name }));

describe("classifyLegacyDatabase", () => {
  it("imports a database written by this fork's lineage", () => {
    const verdict = classifyLegacyDatabase(forkRecorded);
    expect(verdict._tag).toBe("Import");
  });

  it("imports a fork database that lags behind this build", () => {
    const verdict = classifyLegacyDatabase(forkRecorded.filter((row) => row.id <= 31));
    expect(verdict).toMatchObject({ _tag: "Import" });
  });

  it("refuses an upstream database with no fork-only migration", () => {
    // Upstream records AuthAuthorizationScopes at 31 and has never heard of
    // NormalizeLegacyProviderKinds.
    const upstream = [
      { id: 1, name: "OrchestrationEvents" },
      { id: 23, name: "ProjectionThreadShellSummary" },
      { id: 31, name: "AuthAuthorizationScopes" },
    ];
    expect(classifyLegacyDatabase(upstream)).toEqual({ _tag: "NotFork" });
  });

  it("refuses an empty database", () => {
    expect(classifyLegacyDatabase([])).toEqual({ _tag: "NotFork" });
  });

  it("refuses fork data whose lineage was damaged by a second build", () => {
    const corrupted = [...forkRecorded, { id: 99, name: "SomethingFromAnotherBuild" }];
    const verdict = classifyLegacyDatabase(corrupted);
    assert.equal(verdict._tag, "IncompatibleLineage");
    if (verdict._tag === "IncompatibleLineage") {
      expect(verdict.detail).toContain("99");
    }
  });
});

describe("selectImportableEntries", () => {
  it("splits entries by the exclusion set and drops staging directories", () => {
    const result = selectImportableEntries(
      ["settings.json", "secrets", "logs", ".t3code-fork.legacy-import-staging"],
      new Set(["logs"]),
    );
    expect(result.copy).toEqual(["settings.json", "secrets"]);
    expect(result.excluded).toEqual(["logs", ".t3code-fork.legacy-import-staging"]);
  });
});

describe("describeLegacyImportRefusal", () => {
  it("names the legacy path and the deliberate escape hatch", () => {
    const message = describeLegacyImportRefusal("/home/u/.t3", "incompatible-lineage", "detail");
    expect(message).toContain("/home/u/.t3");
    expect(message).toContain("T3CODE_HOME");
    expect(message).toContain("untouched");
  });

  it("explains an integrity failure differently", () => {
    const message = describeLegacyImportRefusal("/home/u/.t3", "corrupt-database", "malformed");
    expect(message).toContain("integrity");
    expect(message).toContain("malformed");
  });
});

// ---------------------------------------------------------------------------
// Filesystem fixtures
// ---------------------------------------------------------------------------

const withServices = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
  Effect.provide(effect, NodeServices.layer);

const decodeMarker = Schema.decodeUnknownSync(LegacyImportMarkerJson);

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});
const makeTempRoot = () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-legacy-import-"));
  tempRoots.push(root);
  return root;
};

const write = (filePath: string, contents: string) => {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  NodeFS.writeFileSync(filePath, contents);
};

/** Builds the non-database part of a legacy home directory. */
const seedLegacyTree = (legacyBaseDir: string) => {
  const stateDir = NodePath.join(legacyBaseDir, "userdata");
  write(NodePath.join(stateDir, "settings.json"), `{"theme":"dark"}`);
  write(NodePath.join(stateDir, "keybindings.json"), `{}`);
  write(NodePath.join(stateDir, "client-settings.json"), `{}`);
  write(NodePath.join(stateDir, "anonymous-id"), "anon-1");
  write(NodePath.join(stateDir, "environment-id"), "env-1");
  write(NodePath.join(stateDir, "secrets", "codex.json"), `{"token":"secret"}`);
  write(NodePath.join(stateDir, "attachments", "a.png"), "png");
  write(NodePath.join(stateDir, "server-runtime.json"), `{"port":3773}`);
  write(NodePath.join(stateDir, "logs", "server.log"), "noise");
  write(NodePath.join(legacyBaseDir, "caches", "provider-status.json"), `{}`);
  write(NodePath.join(legacyBaseDir, "tools", "ripgrep"), "binary");
  write(NodePath.join(legacyBaseDir, "worktrees", "repo", "branch", ".git"), "gitdir: /elsewhere");
};

/** Writes a database that only has an `effect_sql_migrations` table. */
const writeMigrationsOnlyDatabase = (
  dbPath: string,
  rows: ReadonlyArray<readonly [number, string]>,
) => {
  NodeFS.mkdirSync(NodePath.dirname(dbPath), { recursive: true });
  const db = new NodeSqlite.DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE effect_sql_migrations (migration_id integer primary key not null, name text not null, created_at datetime not null default current_timestamp)",
  );
  const insert = db.prepare("INSERT INTO effect_sql_migrations (migration_id, name) VALUES (?, ?)");
  for (const [id, name] of rows) {
    insert.run(id, name);
  }
  db.close();
};

/**
 * Builds a genuine fork database at `dbPath` by running this build's migrations,
 * then adds a probe row so we can prove the data survived the import.
 */
const seedForkDatabase = (dbPath: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE legacy_probe (value text not null)`;
    yield* sql`INSERT INTO legacy_probe (value) VALUES ('carried-over')`;
  }).pipe(Effect.provide(makeSqlitePersistenceLive(dbPath)));

const readTable = (dbPath: string, query: string): Array<Record<string, unknown>> => {
  const db = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(query).all() as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
};

interface Fixture {
  readonly root: string;
  readonly baseDir: string;
  readonly legacyBaseDir: string;
  readonly stateDir: string;
  readonly newDbPath: string;
  readonly legacyDbPath: string;
  readonly markerPath: string;
}

const makeFixture = (): Fixture => {
  const root = makeTempRoot();
  const baseDir = NodePath.join(root, ".t3code-fork");
  const legacyBaseDir = NodePath.join(root, ".t3");
  return {
    root,
    baseDir,
    legacyBaseDir,
    stateDir: NodePath.join(baseDir, "userdata"),
    newDbPath: NodePath.join(baseDir, "userdata", "state.sqlite"),
    legacyDbPath: NodePath.join(legacyBaseDir, "userdata", "state.sqlite"),
    markerPath: NodePath.join(baseDir, LEGACY_IMPORT_MARKER_FILENAME),
  };
};

const runImport = (fixture: Fixture, overrides: { readonly stateDir?: string } = {}) =>
  importLegacyStateIfNeeded({
    baseDir: fixture.baseDir,
    defaultBaseDir: fixture.baseDir,
    legacyBaseDir: fixture.legacyBaseDir,
    stateDir: overrides.stateDir ?? fixture.stateDir,
  });

// ---------------------------------------------------------------------------
// End-to-end import behaviour
// ---------------------------------------------------------------------------

describe("importLegacyStateIfNeeded", () => {
  it.effect("does nothing on a fresh install with no legacy directory", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        const outcome = yield* runImport(fixture);
        assert.deepEqual(outcome, { _tag: "Skipped", reason: "no-legacy-database" });
        assert.equal(NodeFS.existsSync(fixture.baseDir), false);
      }),
    ),
  );

  it.effect("imports a fork-marked legacy home and leaves the legacy tree intact", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        seedLegacyTree(fixture.legacyBaseDir);
        yield* seedForkDatabase(fixture.legacyDbPath);

        const outcome = yield* runImport(fixture);
        assert.equal(
          outcome._tag,
          "Imported",
          outcome._tag === "Failed" ? outcome.detail : outcome._tag,
        );

        // Data survived, including the schema this build's migrations created.
        assert.deepEqual(readTable(fixture.newDbPath, "SELECT value FROM legacy_probe"), [
          { value: "carried-over" },
        ]);

        // Included files.
        for (const relative of [
          "userdata/settings.json",
          "userdata/keybindings.json",
          "userdata/client-settings.json",
          "userdata/anonymous-id",
          "userdata/environment-id",
          "userdata/secrets/codex.json",
          "userdata/attachments/a.png",
          "caches/provider-status.json",
        ]) {
          assert.equal(
            NodeFS.existsSync(NodePath.join(fixture.baseDir, relative)),
            true,
            `expected ${relative} to be imported`,
          );
        }

        // Deliberate exclusions.
        for (const relative of ["userdata/server-runtime.json", "userdata/logs", "tools"]) {
          assert.equal(
            NodeFS.existsSync(NodePath.join(fixture.baseDir, relative)),
            false,
            `expected ${relative} to be excluded`,
          );
        }

        // The imported database is self-contained: no WAL sidecars left over.
        assert.equal(NodeFS.existsSync(`${fixture.newDbPath}-wal`), false);
        assert.equal(NodeFS.existsSync(`${fixture.newDbPath}-shm`), false);

        // Worktrees are linked, never copied or moved.
        const worktrees = NodePath.join(fixture.baseDir, "worktrees");
        assert.equal(NodeFS.lstatSync(worktrees).isSymbolicLink(), true);
        assert.equal(
          NodeFS.realpathSync(worktrees),
          NodeFS.realpathSync(NodePath.join(fixture.legacyBaseDir, "worktrees")),
        );
        assert.equal(
          NodeFS.readFileSync(NodePath.join(worktrees, "repo", "branch", ".git"), "utf8"),
          "gitdir: /elsewhere",
        );

        // The legacy home is untouched.
        for (const relative of [
          "userdata/state.sqlite",
          "userdata/settings.json",
          "userdata/secrets/codex.json",
          "userdata/server-runtime.json",
          "caches/provider-status.json",
          "tools/ripgrep",
          "worktrees/repo/branch/.git",
        ]) {
          assert.equal(
            NodeFS.existsSync(NodePath.join(fixture.legacyBaseDir, relative)),
            true,
            `expected legacy ${relative} to survive`,
          );
        }

        // Marker records the provenance.
        const marker = decodeMarker(NodeFS.readFileSync(fixture.markerPath, "utf8"));
        expect(marker).toMatchObject({
          version: 1,
          source: fixture.legacyBaseDir,
          destination: fixture.baseDir,
          worktrees: "symlinked",
        });
        expect(marker.entries).toContain("userdata/state.sqlite");
        expect(marker.excludedEntries).toContain("tools");
        expect(marker.excludedEntries).toContain("userdata/server-runtime.json");
        expect(marker.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // No staging directory survives a successful run.
        assert.equal(
          NodeFS.readdirSync(fixture.root).some((entry) => entry.includes("staging")),
          false,
        );
      }),
    ),
  );

  it.effect("carries over transactions that are still sitting in the WAL", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);

        // Hold a connection open so SQLite cannot checkpoint on close: the row
        // below lives in `state.sqlite-wal`, not in `state.sqlite`.
        const holder = new NodeSqlite.DatabaseSync(fixture.legacyDbPath);
        holder.exec("PRAGMA journal_mode = WAL");
        holder.exec("INSERT INTO legacy_probe (value) VALUES ('only-in-wal')");
        assert.equal(NodeFS.existsSync(`${fixture.legacyDbPath}-wal`), true);

        const outcome = yield* runImport(fixture);
        holder.close();

        assert.equal(
          outcome._tag,
          "Imported",
          outcome._tag === "Failed" ? outcome.detail : outcome._tag,
        );
        const values = readTable(
          fixture.newDbPath,
          "SELECT value FROM legacy_probe ORDER BY value",
        );
        assert.deepEqual(values, [{ value: "carried-over" }, { value: "only-in-wal" }]);
      }),
    ),
  );

  it.effect("runs exactly once", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);

        assert.equal((yield* runImport(fixture))._tag, "Imported");

        // Even with the database removed, the marker stops a second import.
        NodeFS.rmSync(fixture.newDbPath);
        assert.deepEqual(yield* runImport(fixture), {
          _tag: "Skipped",
          reason: "already-imported",
        });
      }),
    ),
  );

  it.effect("never touches a legacy home that belongs to another build", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        seedLegacyTree(fixture.legacyBaseDir);
        writeMigrationsOnlyDatabase(fixture.legacyDbPath, [
          [1, "OrchestrationEvents"],
          [23, "ProjectionThreadShellSummary"],
          [31, "AuthAuthorizationScopes"],
        ]);
        const legacyBefore = NodeFS.statSync(fixture.legacyDbPath).mtimeMs;

        const outcome = yield* runImport(fixture);
        assert.equal(outcome._tag, "Refused");
        if (outcome._tag === "Refused") {
          assert.equal(outcome.reason, "not-fork");
        }

        assert.equal(NodeFS.existsSync(fixture.newDbPath), false);
        assert.equal(
          NodeFS.existsSync(NodePath.join(fixture.baseDir, "userdata", "settings.json")),
          false,
        );
        assert.equal(NodeFS.existsSync(fixture.markerPath), false);
        assert.equal(NodeFS.statSync(fixture.legacyDbPath).mtimeMs, legacyBefore);
        assert.equal(NodeFS.existsSync(`${fixture.legacyDbPath}-wal`), false);
      }),
    ),
  );

  it.effect("refuses to inherit a database damaged by running two builds", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);

        // Simulate an upstream build appending a migration id this fork cannot
        // account for, on top of fork-written history.
        const db = new NodeSqlite.DatabaseSync(fixture.legacyDbPath);
        db.exec(
          "INSERT INTO effect_sql_migrations (migration_id, name) VALUES (9001, 'SomethingFromAnotherBuild')",
        );
        db.close();

        const outcome = yield* runImport(fixture);
        assert.equal(outcome._tag, "Refused");
        if (outcome._tag === "Refused") {
          assert.equal(outcome.reason, "incompatible-lineage");
          expect(outcome.detail).toContain("T3CODE_HOME");
        }

        assert.equal(NodeFS.existsSync(fixture.newDbPath), false);
        assert.equal(NodeFS.existsSync(fixture.markerPath), false);
        assert.equal(NodeFS.existsSync(fixture.legacyDbPath), true);
      }),
    ),
  );

  it.effect("skips an explicitly configured base directory and dev state directories", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);

        const custom = yield* importLegacyStateIfNeeded({
          baseDir: fixture.baseDir,
          defaultBaseDir: NodePath.join(fixture.root, "somewhere-else"),
          legacyBaseDir: fixture.legacyBaseDir,
          stateDir: fixture.stateDir,
        });
        assert.deepEqual(custom, { _tag: "Skipped", reason: "custom-base-dir" });

        const dev = yield* runImport(fixture, {
          stateDir: NodePath.join(fixture.baseDir, "dev"),
        });
        assert.deepEqual(dev, { _tag: "Skipped", reason: "non-default-state-dir" });

        assert.equal(NodeFS.existsSync(fixture.newDbPath), false);
      }),
    ),
  );

  it.effect("does not overwrite files the new home already has", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        seedLegacyTree(fixture.legacyBaseDir);
        yield* seedForkDatabase(fixture.legacyDbPath);

        // A partially initialised new home: settings already written, and an
        // empty worktrees placeholder created by startup.
        write(NodePath.join(fixture.stateDir, "settings.json"), `{"theme":"light"}`);
        NodeFS.mkdirSync(NodePath.join(fixture.baseDir, "worktrees"), { recursive: true });
        NodeFS.mkdirSync(NodePath.join(fixture.baseDir, "caches"), { recursive: true });
        NodeFS.mkdirSync(NodePath.join(fixture.stateDir, "attachments"), { recursive: true });

        const outcome = yield* runImport(fixture);
        assert.equal(
          outcome._tag,
          "Imported",
          outcome._tag === "Failed" ? outcome.detail : outcome._tag,
        );

        assert.equal(
          NodeFS.readFileSync(NodePath.join(fixture.stateDir, "settings.json"), "utf8"),
          `{"theme":"light"}`,
        );
        assert.equal(NodeFS.existsSync(fixture.newDbPath), true);
        assert.equal(
          NodeFS.existsSync(NodePath.join(fixture.stateDir, "attachments", "a.png")),
          true,
        );
        assert.equal(
          NodeFS.existsSync(NodePath.join(fixture.baseDir, "caches", "provider-status.json")),
          true,
        );
        assert.equal(
          NodeFS.lstatSync(NodePath.join(fixture.baseDir, "worktrees")).isSymbolicLink(),
          true,
        );
      }),
    ),
  );

  it.effect("ignores a staging directory left by an interrupted run", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);

        const staging = NodePath.join(fixture.root, ".t3code-fork.legacy-import-staging");
        write(NodePath.join(staging, "userdata", "state.sqlite"), "half-written garbage");
        write(NodePath.join(staging, "settings.json"), "half-written garbage");

        const outcome = yield* runImport(fixture);
        assert.equal(
          outcome._tag,
          "Imported",
          outcome._tag === "Failed" ? outcome.detail : outcome._tag,
        );
        assert.equal(NodeFS.existsSync(staging), true);
        assert.deepEqual(readTable(fixture.newDbPath, "SELECT value FROM legacy_probe"), [
          { value: "carried-over" },
        ]);
      }),
    ),
  );

  it.effect("imports before the lineage guard and migrations run against the new home", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);

        const outcome = yield* runImport(fixture);
        assert.equal(
          outcome._tag,
          "Imported",
          outcome._tag === "Failed" ? outcome.detail : outcome._tag,
        );

        // Exactly what `layerConfig` does next: build the persistence layer,
        // which runs the lineage guard and then the migrator. The imported
        // database must pass both.
        const migrations = yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{
            readonly name: string;
          }>`SELECT name FROM effect_sql_migrations ORDER BY migration_id`;
        }).pipe(Effect.provide(makeSqlitePersistenceLive(fixture.newDbPath)));

        assert.deepEqual(
          migrations.map((row) => row.name),
          migrationManifest.map(([, name]) => name),
        );
        assert.deepEqual(readTable(fixture.newDbPath, "SELECT value FROM legacy_probe"), [
          { value: "carried-over" },
        ]);
      }),
    ),
  );
  it.effect("rejects linked settings without publishing a database and cleans staging", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);
        const external = NodePath.join(fixture.root, "external.json");
        write(external, '{"theme":"dark"}');
        NodeFS.symlinkSync(
          external,
          NodePath.join(fixture.legacyBaseDir, "userdata", "settings.json"),
        );
        const outcome = yield* runImport(fixture);
        assert.equal(outcome._tag, "Failed");
        assert.equal(NodeFS.existsSync(fixture.newDbPath), false);
        assert.equal(NodeFS.readFileSync(external, "utf8"), '{"theme":"dark"}');
        assert.equal(
          NodeFS.readdirSync(fixture.root).some((entry) => entry.includes("staging")),
          false,
        );
      }),
    ),
  );

  it.effect("does not delete an existing worktrees symlink", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        seedLegacyTree(fixture.legacyBaseDir);
        yield* seedForkDatabase(fixture.legacyDbPath);
        const external = NodePath.join(fixture.root, "external-worktrees");
        NodeFS.mkdirSync(external);
        NodeFS.mkdirSync(fixture.baseDir);
        const destination = NodePath.join(fixture.baseDir, "worktrees");
        NodeFS.symlinkSync(external, destination);
        const outcome = yield* runImport(fixture);
        assert.equal(
          outcome._tag,
          "Imported",
          outcome._tag === "Failed" ? outcome.detail : outcome._tag,
        );
        assert.equal(NodeFS.readlinkSync(destination), external);
        assert.equal(NodeFS.existsSync(external), true);
      }),
    ),
  );

  it.effect("skips a destination that aliases the legacy home", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        yield* seedForkDatabase(fixture.legacyDbPath);
        NodeFS.symlinkSync(fixture.legacyBaseDir, fixture.baseDir);
        assert.deepEqual(yield* runImport(fixture), {
          _tag: "Skipped",
          reason: "legacy-is-current-home",
        });
        assert.equal(NodeFS.existsSync(fixture.markerPath), false);
      }),
    ),
  );

  it.effect("rejects a corrupt database and removes its staging directory", () =>
    withServices(
      Effect.gen(function* () {
        const fixture = makeFixture();
        write(fixture.legacyDbPath, "not a database");
        assert.equal((yield* runImport(fixture))._tag, "Failed");
        assert.equal(NodeFS.existsSync(fixture.newDbPath), false);
        assert.equal(NodeFS.readFileSync(fixture.legacyDbPath, "utf8"), "not a database");
        assert.equal(
          NodeFS.readdirSync(fixture.root).some((entry) => entry.includes("staging")),
          false,
        );
      }),
    ),
  );
});
