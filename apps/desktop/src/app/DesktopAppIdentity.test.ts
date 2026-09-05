import { APP_BASE_NAME, DESKTOP_USER_DATA_DIR_NAME } from "@t3tools/shared/branding";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopAssets from "./DesktopAssets.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

const defaultEnvironmentInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "1.2.3",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: true,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

type TestEnvironmentInput = Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> & {
  readonly env?: Record<string, string | undefined>;
};

interface ElectronAppCalls {
  readonly setAboutPanelOptions: Array<Electron.AboutPanelOptionsOptions>;
  readonly setDockIcon: string[];
  readonly setName: string[];
}

const makeElectronAppLayer = (calls: ElectronAppCalls) =>
  Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("T3 Code"),
    systemLocale: Effect.succeed("en-US"),
    whenReady: Effect.void,
    quit: Effect.void,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: (name) =>
      Effect.sync(() => {
        calls.setName.push(name);
      }),
    setAboutPanelOptions: (options) =>
      Effect.sync(() => {
        calls.setAboutPanelOptions.push(options);
      }),
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    isDefaultProtocolClient: () => Effect.succeed(false),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: (iconPath) =>
      Effect.sync(() => {
        calls.setDockIcon.push(iconPath);
      }),
    appendCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    on: () => Effect.void,
  } satisfies ElectronApp.ElectronApp["Service"]);

const makeAssetsLayer = (png: Option.Option<string>) =>
  Layer.succeed(DesktopAssets.DesktopAssets, {
    iconPaths: Effect.succeed({
      ico: Option.none(),
      icns: Option.none(),
      png,
    }),
    resolveResourcePath: () => Effect.succeed(Option.none()),
  } satisfies DesktopAssets.DesktopAssets["Service"]);

const makeEnvironmentLayer = (overrides: TestEnvironmentInput = {}) => {
  const { env, ...environmentOverrides } = overrides;
  return DesktopEnvironment.layer({
    ...defaultEnvironmentInput,
    ...environmentOverrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NodePath.layerPosix,
        DesktopConfig.layerTest({
          ...env,
        }),
      ),
    ),
  );
};

interface RecordedFileSystemCalls {
  readonly makeDirectory: string[];
  readonly copy: Array<{ readonly from: string; readonly to: string }>;
}

const APP_DATA_DIRECTORY = "/Users/alice/Library/Application Support";
const USER_DATA_PATH = `${APP_DATA_DIRECTORY}/${DESKTOP_USER_DATA_DIR_NAME}`;
const SHARED_LEGACY_PATH = `${APP_DATA_DIRECTORY}/t3code`;
const PRODUCT_NAME_LEGACY_PATH = `${APP_DATA_DIRECTORY}/T3 Code (Alpha)`;

const withIdentity = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    | R
    | DesktopAppIdentity.DesktopAppIdentity
    | DesktopEnvironment.DesktopEnvironment
    | FileSystem.FileSystem
  >,
  input: {
    readonly calls?: ElectronAppCalls;
    readonly environment?: TestEnvironmentInput;
    /** Absolute paths the fake filesystem should report as existing. */
    readonly existingPaths?: readonly string[];
    readonly legacyEntries?: readonly string[];
    readonly copyError?: PlatformError.PlatformError;
    readonly existsError?: PlatformError.PlatformError;
    readonly fileSystemCalls?: RecordedFileSystemCalls;
    readonly packageJson?: string;
    readonly pngIconPath?: Option.Option<string>;
  } = {},
) => {
  const calls: ElectronAppCalls = input.calls ?? {
    setAboutPanelOptions: [],
    setDockIcon: [],
    setName: [],
  };
  const fileSystemCalls: RecordedFileSystemCalls = input.fileSystemCalls ?? {
    makeDirectory: [],
    copy: [],
  };
  const existingPaths = new Set(input.existingPaths ?? []);

  return effect.pipe(
    Effect.provide(
      DesktopAppIdentity.layer.pipe(
        Layer.provideMerge(
          FileSystem.layerNoop({
            exists: (path) =>
              input.existsError
                ? Effect.fail(input.existsError)
                : Effect.succeed(existingPaths.has(path)),
            readDirectory: () => Effect.succeed([...(input.legacyEntries ?? [])]),
            makeDirectory: (path) =>
              Effect.sync(() => {
                fileSystemCalls.makeDirectory.push(path);
              }),
            copy: (from, to) =>
              input.copyError
                ? Effect.fail(input.copyError)
                : Effect.sync(() => {
                    fileSystemCalls.copy.push({ from, to });
                  }),
            readFileString: () =>
              Effect.succeed(input.packageJson ?? '{"t3codeCommitHash":"abcdef1234567890"}'),
          }),
        ),
        Layer.provideMerge(makeAssetsLayer(input.pngIconPath ?? Option.none())),
        Layer.provideMerge(makeElectronAppLayer(calls)),
        Layer.provideMerge(makeEnvironmentLayer(input.environment)),
      ),
    ),
  );
};

describe("DesktopAppIdentity", () => {
  it("skips regenerable Chromium caches when migrating legacy user data", () => {
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("Local Storage"), true);
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("config.json"), true);
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("SingletonLock"), false);
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("SingletonSocket"), false);
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("SingletonCookie"), false);
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("Cache"), false);
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("GPUCache"), false);
    assert.equal(DesktopAppIdentity.shouldMigrateLegacyUserDataEntry("Code Cache"), false);
  });

  it.effect(
    "uses the namespaced userData path once it exists, without touching legacy state",
    () => {
      const fileSystemCalls: RecordedFileSystemCalls = { makeDirectory: [], copy: [] };

      return withIdentity(
        Effect.gen(function* () {
          const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
          const userDataPath = yield* identity.resolveUserDataPath;

          assert.equal(userDataPath, USER_DATA_PATH);
          assert.deepEqual(fileSystemCalls.copy, []);
          assert.deepEqual(fileSystemCalls.makeDirectory, []);
        }),
        {
          existingPaths: [USER_DATA_PATH, SHARED_LEGACY_PATH, PRODUCT_NAME_LEGACY_PATH],
          fileSystemCalls,
        },
      );
    },
  );

  it.effect("copies the shared legacy userData directory into the namespaced one once", () => {
    const fileSystemCalls: RecordedFileSystemCalls = { makeDirectory: [], copy: [] };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        // The legacy directory may still belong to a concurrently installed
        // upstream build, so it is copied rather than reused or moved.
        assert.equal(userDataPath, USER_DATA_PATH);
        assert.deepEqual(fileSystemCalls.makeDirectory, [USER_DATA_PATH]);
        assert.deepEqual(fileSystemCalls.copy, [
          {
            from: `${SHARED_LEGACY_PATH}/Local Storage`,
            to: `${USER_DATA_PATH}/Local Storage`,
          },
          {
            from: `${SHARED_LEGACY_PATH}/config.json`,
            to: `${USER_DATA_PATH}/config.json`,
          },
        ]);
      }),
      {
        existingPaths: [SHARED_LEGACY_PATH, PRODUCT_NAME_LEGACY_PATH],
        legacyEntries: ["Local Storage", "Cache", "config.json", "GPUCache"],
        fileSystemCalls,
      },
    );
  });

  it.effect("falls back to the older productName userData directory", () => {
    const fileSystemCalls: RecordedFileSystemCalls = { makeDirectory: [], copy: [] };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(userDataPath, USER_DATA_PATH);
        assert.deepEqual(fileSystemCalls.copy, [
          {
            from: `${PRODUCT_NAME_LEGACY_PATH}/config.json`,
            to: `${USER_DATA_PATH}/config.json`,
          },
        ]);
      }),
      {
        existingPaths: [PRODUCT_NAME_LEGACY_PATH],
        legacyEntries: ["config.json", "Crashpad"],
        fileSystemCalls,
      },
    );
  });

  it.effect("starts fresh when no legacy userData directory exists", () => {
    const fileSystemCalls: RecordedFileSystemCalls = { makeDirectory: [], copy: [] };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(userDataPath, USER_DATA_PATH);
        assert.deepEqual(fileSystemCalls.copy, []);
      }),
      { existingPaths: [], fileSystemCalls },
    );
  });

  it.effect("keeps starting up when the legacy userData migration fails", () =>
    withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const userDataPath = yield* identity.resolveUserDataPath;

        assert.equal(userDataPath, USER_DATA_PATH);
      }),
      {
        existingPaths: [SHARED_LEGACY_PATH],
        legacyEntries: ["config.json"],
        copyError: PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "copy",
          description: "permission denied",
          pathOrDescriptor: SHARED_LEGACY_PATH,
        }),
      },
    ),
  );

  it.effect("preserves failures while inspecting userData paths", () => {
    const cause = PlatformError.systemError({
      _tag: "PermissionDenied",
      module: "FileSystem",
      method: "exists",
      description: "permission denied",
      pathOrDescriptor: USER_DATA_PATH,
    });

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        const error = yield* identity.resolveUserDataPath.pipe(Effect.flip);

        assert.instanceOf(error, DesktopAppIdentity.DesktopUserDataPathResolutionError);
        assert.equal(error.legacyPath, USER_DATA_PATH);
        assert.strictEqual(error.cause, cause);
      }),
      { existsError: cause },
    );
  });

  it.effect("configures app identity from the environment commit override", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        assert.deepEqual(calls.setName, [`${APP_BASE_NAME} (Alpha)`]);
        assert.equal(calls.setAboutPanelOptions[0]?.applicationName, `${APP_BASE_NAME} (Alpha)`);
        assert.equal(calls.setAboutPanelOptions[0]?.applicationVersion, "1.2.3");
        assert.equal(calls.setAboutPanelOptions[0]?.version, "0123456789ab");
        // Packaged: the bundle's own icon stands, so a custom one the user
        // attached survives.
        assert.deepEqual(calls.setDockIcon, []);
      }),
      {
        calls,
        environment: {
          env: {
            T3CODE_COMMIT_HASH: "0123456789abcdef",
          },
        },
        pngIconPath: Option.some("/icon.png"),
      },
    );
  });

  it.effect("sets the dock icon only when running unpackaged", () => {
    const calls: ElectronAppCalls = {
      setAboutPanelOptions: [],
      setDockIcon: [],
      setName: [],
    };

    return withIdentity(
      Effect.gen(function* () {
        const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
        yield* identity.configure;

        // Electron shows a generic icon for an unpackaged run, which is the
        // reason this call exists at all.
        assert.deepEqual(calls.setDockIcon, ["/icon.png"]);
      }),
      {
        calls,
        environment: { isPackaged: false },
        pngIconPath: Option.some("/icon.png"),
      },
    );
  });
});
