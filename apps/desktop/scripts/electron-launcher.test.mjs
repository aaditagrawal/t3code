import { APP_BASE_NAME, DESKTOP_APP_ID } from "@t3tools/shared/branding";
import { assert, describe, it } from "vite-plus/test";

import {
  APP_BUNDLE_ID,
  APP_DISPLAY_NAME,
  makeDevelopmentLauncherScript,
  resolveElectronBinaryPath,
  resolveMacLauncherIconPaths,
  resolveMacLauncherPaths,
} from "./electron-launcher.mjs";

describe("electron development launcher", () => {
  it("uses captured values only as fallbacks for a live runner environment", () => {
    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: "/repo/node_modules/electron/Electron",
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {
        VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
        T3CODE_PORT: "16566",
        T3CODE_HOME: "/tmp/t3",
      },
    });

    assert.include(
      script,
      "if [ -z \"${VITE_DEV_SERVER_URL:-}\" ]; then export VITE_DEV_SERVER_URL='http://127.0.0.1:8526'; fi",
    );
    assert.notInclude(script, "\nexport VITE_DEV_SERVER_URL=");
    assert.include(
      script,
      "exec '/repo/node_modules/electron/Electron' --t3code-dev-root='/repo/apps/desktop' '/repo/apps/desktop/dist-electron/main.cjs' \"$@\"",
    );
  });

  it("repairs Electron before loading the package entrypoint", () => {
    const calls = [];
    const electronPath = resolveElectronBinaryPath({
      ensureRuntime: () => {
        calls.push("ensure");
      },
      createRequire: () => (specifier) => {
        calls.push(`require:${specifier}`);
        return "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
      },
      moduleUrl: import.meta.url,
    });

    assert.equal(
      electronPath,
      "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
    assert.deepEqual(calls, ["ensure", "require:electron"]);
  });

  // The launcher bundle identity must stay namespaced against upstream, or a
  // dev build re-registers upstream's bundle id and URL schemes with macOS.
  it("derives its bundle identity from the shared branding module", () => {
    assert.equal(APP_DISPLAY_NAME, `${APP_BASE_NAME} (Alpha)`);
    assert.equal(APP_BUNDLE_ID, DESKTOP_APP_ID);
  });

  it("keeps the native Electron executable name inside the branded macOS bundle", () => {
    const devDisplayName = `${APP_BASE_NAME} (Dev)`;
    const bundlePath = `/repo/apps/desktop/.electron-runtime/${devDisplayName}.app`;
    const paths = resolveMacLauncherPaths(bundlePath, devDisplayName);

    assert.equal(paths.launcherExecutableName, `${devDisplayName} Launcher`);
    assert.equal(
      paths.launcherBinaryPath,
      `${bundlePath}/Contents/MacOS/${devDisplayName} Launcher`,
    );
    assert.equal(paths.runtimeElectronBinaryPath, `${bundlePath}/Contents/MacOS/Electron`);

    const script = makeDevelopmentLauncherScript({
      electronBinaryPath: paths.runtimeElectronBinaryPath,
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {},
    });
    assert.include(script, `exec '${bundlePath}/Contents/MacOS/Electron'`);
    assert.notInclude(script, "node_modules/electron");
  });

  it("derives launcher icons from canonical development and production assets", () => {
    const development = resolveMacLauncherIconPaths("/runtime", true);
    const production = resolveMacLauncherIconPaths("/runtime", false);

    assert.match(development.sourceIconPath, /assets\/dev\/blueprint-macos-1024\.png$/);
    assert.equal(development.generatedIconPath, "/runtime/icon-dev.icns");
    assert.match(production.sourceIconPath, /assets\/prod\/black-macos-1024\.png$/);
    assert.equal(production.generatedIconPath, "/runtime/icon-prod.icns");
  });
});
