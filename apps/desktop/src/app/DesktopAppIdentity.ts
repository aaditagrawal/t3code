import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const COMMIT_HASH_DISPLAY_LENGTH = 12;

const AppPackageMetadata = Schema.Struct({
  t3codeCommitHash: Schema.optional(Schema.String),
});
const decodeAppPackageMetadata = Schema.decodeEffect(Schema.fromJsonString(AppPackageMetadata));

export class DesktopUserDataPathResolutionError extends Schema.TaggedErrorClass<DesktopUserDataPathResolutionError>()(
  "DesktopUserDataPathResolutionError",
  {
    legacyPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to inspect legacy desktop user-data path at "${this.legacyPath}".`;
  }
}

export class DesktopAppIdentity extends Context.Service<
  DesktopAppIdentity,
  {
    readonly resolveUserDataPath: Effect.Effect<string, DesktopUserDataPathResolutionError>;
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopAppIdentity") {}

const normalizeCommitHash = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return COMMIT_HASH_PATTERN.test(trimmed)
    ? Option.some(trimmed.slice(0, COMMIT_HASH_DISPLAY_LENGTH).toLowerCase())
    : Option.none();
};

const { logInfo, logWarning } = makeComponentLogger("desktop-app-identity");

/**
 * Chromium/Electron subdirectories of `userData` that are pure derived caches.
 *
 * They are the bulk of a userData directory's bytes and are regenerated on the
 * next launch, so the one-time legacy migration skips them: copying them would
 * add seconds of blocking I/O before the single-instance lock is taken, for no
 * user-visible benefit.
 */
const REGENERABLE_USER_DATA_ENTRIES: ReadonlySet<string> = new Set([
  "Cache",
  "Code Cache",
  "CachedData",
  "CachedProfilesData",
  "Crashpad",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "blob_storage",
  "component_crx_cache",
  "logs",
]);

export function shouldMigrateLegacyUserDataEntry(entryName: string): boolean {
  return !REGENERABLE_USER_DATA_ENTRIES.has(entryName);
}

const migrateLegacyUserData = Effect.fn("desktop.appIdentity.migrateLegacyUserData")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly legacyPath: string;
    readonly userDataPath: string;
    readonly joinPath: (first: string, ...segments: string[]) => string;
  }) {
    const { fileSystem, legacyPath, userDataPath, joinPath } = input;
    const entries = yield* fileSystem.readDirectory(legacyPath);
    const migrated = entries.filter(shouldMigrateLegacyUserDataEntry);

    yield* fileSystem.makeDirectory(userDataPath, { recursive: true });
    for (const entry of migrated) {
      yield* fileSystem.copy(joinPath(legacyPath, entry), joinPath(userDataPath, entry), {
        overwrite: false,
        preserveTimestamps: true,
      });
    }

    yield* logInfo("Migrated legacy desktop user-data directory", {
      legacyPath,
      userDataPath,
      entryCount: migrated.length,
      skippedCount: entries.length - migrated.length,
    });
  },
);

/**
 * Resolve the `userData` directory, carrying legacy state across once.
 *
 * Before this fork was namespaced, both this build and upstream resolved the
 * same `userData` directory. Electron keys the single-instance lock on that
 * directory, so sharing it made the two desktop apps mutually exclusive — the
 * second launch just focused the first app's window. This build now owns
 * {@link DesktopEnvironment.DesktopEnvironment.userDataDirName} exclusively.
 *
 * To avoid existing installs silently starting from an empty profile, the
 * first launch after the rename copies the newest surviving legacy directory
 * (see `LEGACY_USER_DATA_DIR_NAMES`) into the new one. It is a copy, not a
 * move or an in-place reuse: the legacy directory may still be in active use
 * by an upstream install, and reusing it in place would reintroduce exactly
 * the lock collision this rename exists to fix.
 *
 * Migration is best-effort. A failed copy is logged and startup continues with
 * an empty new directory rather than blocking the app from opening; only a
 * failure to *probe* the filesystem is surfaced as an error.
 */
export const resolveUserDataPath = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const userDataPath = environment.path.join(
    environment.appDataDirectory,
    environment.userDataDirName,
  );

  const existsOrFail = (path: string) =>
    fileSystem.exists(path).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopUserDataPathResolutionError({
            legacyPath: path,
            cause,
          }),
      ),
    );

  if (yield* existsOrFail(userDataPath)) {
    return userDataPath;
  }

  for (const legacyDirName of environment.legacyUserDataDirNames) {
    const legacyPath = environment.path.join(environment.appDataDirectory, legacyDirName);
    if (!(yield* existsOrFail(legacyPath))) {
      continue;
    }

    yield* migrateLegacyUserData({
      fileSystem,
      legacyPath,
      userDataPath,
      joinPath: environment.path.join,
    }).pipe(
      Effect.catchCause((cause) =>
        logWarning("Failed to migrate legacy desktop user-data directory", {
          legacyPath,
          userDataPath,
          error: String(cause),
        }),
      ),
    );
    return userDataPath;
  }

  return userDataPath;
}).pipe(Effect.withSpan("desktop.appIdentity.resolveUserDataPath"));

export const make = Effect.gen(function* () {
  const assets = yield* DesktopAssets.DesktopAssets;
  const electronApp = yield* ElectronApp.ElectronApp;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const commitHashCache = yield* Ref.make<Option.Option<Option.Option<string>>>(Option.none());

  const resolveEmbeddedCommitHash = Effect.gen(function* () {
    const packageJsonPath = environment.path.join(environment.appRoot, "package.json");
    const raw = yield* fileSystem.readFileString(packageJsonPath).pipe(Effect.option);
    return yield* Option.match(raw, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (value) =>
        decodeAppPackageMetadata(value).pipe(
          Effect.map((parsed) =>
            Option.fromNullishOr(parsed.t3codeCommitHash).pipe(Option.flatMap(normalizeCommitHash)),
          ),
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
    });
  });

  const resolveAboutCommitHash = Effect.gen(function* () {
    const cached = yield* Ref.get(commitHashCache);
    if (Option.isSome(cached)) {
      return cached.value;
    }

    const override = Option.flatMap(environment.commitHashOverride, normalizeCommitHash);
    if (Option.isSome(override)) {
      yield* Ref.set(commitHashCache, Option.some(override));
      return override;
    }

    if (!environment.isPackaged) {
      const empty = Option.none<string>();
      yield* Ref.set(commitHashCache, Option.some(empty));
      return empty;
    }

    const commitHash = yield* resolveEmbeddedCommitHash;
    yield* Ref.set(commitHashCache, Option.some(commitHash));
    return commitHash;
  });

  const userDataPath = resolveUserDataPath.pipe(
    Effect.provide(
      yield* Effect.context<DesktopEnvironment.DesktopEnvironment | FileSystem.FileSystem>(),
    ),
  );

  const configure = Effect.gen(function* () {
    const commitHash = yield* resolveAboutCommitHash;
    yield* electronApp.setName(environment.displayName);
    yield* electronApp.setAboutPanelOptions({
      applicationName: environment.displayName,
      applicationVersion: environment.appVersion,
      version: Option.getOrElse(commitHash, () => "unknown"),
    });

    if (environment.platform === "win32") {
      yield* electronApp.setAppUserModelId(environment.appUserModelId);
    }

    if (environment.platform === "linux") {
      yield* electronApp.setDesktopName(environment.linuxDesktopEntryName);
    }

    // Unpackaged runs only. A packaged bundle already carries its icon in
    // Info.plist, so setting the dock tile again changes nothing except to
    // overwrite a custom icon the user attached to the app themselves.
    if (environment.platform === "darwin" && !environment.isPackaged) {
      const iconPaths = yield* assets.iconPaths;
      yield* Option.match(iconPaths.png, {
        onNone: () => Effect.void,
        onSome: electronApp.setDockIcon,
      });
    }
  }).pipe(Effect.withSpan("desktop.appIdentity.configure"));

  return DesktopAppIdentity.of({
    resolveUserDataPath: userDataPath,
    configure,
  });
});

export const layer = Layer.effect(DesktopAppIdentity, make);
