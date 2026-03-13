import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { assertSuccess } from "@effect/vitest/utils";
import { FileSystem, Path, Effect } from "effect";

import {
  isCommandAvailable,
  launchDetached,
  resolveAvailableEditors,
  resolveEditorLaunch,
} from "./open";

it.layer(NodeServices.layer)("resolveEditorLaunch", (it) => {
  it.effect("returns commands for command-based editors", () =>
    // Use "linux" to avoid macOS .app fallback logic, which depends on
    // whether the .app bundle happens to be installed on the test host.
    Effect.gen(function* () {
      const antigravityLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "antigravity" },
        "darwin",
      );
      assert.deepEqual(antigravityLaunch, {
        command: "agy",
        args: ["/tmp/workspace"],
      });

      const cursorLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "cursor" },
        "linux",
      );
      assert.deepEqual(cursorLaunch, {
        command: "cursor",
        args: ["/tmp/workspace"],
      });

      const vscodeLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "vscode" },
        "linux",
      );
      assert.deepEqual(vscodeLaunch, {
        command: "code",
        args: ["/tmp/workspace"],
      });

      const zedLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "zed" },
        "linux",
      );
      assert.deepEqual(zedLaunch, {
        command: "zed",
        args: ["/tmp/workspace"],
      });

      const windsurfLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "windsurf" },
        "linux",
      );
      assert.deepEqual(windsurfLaunch, {
        command: "windsurf",
        args: ["/tmp/workspace"],
      });

      const sublimeLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "sublime" },
        "linux",
      );
      assert.deepEqual(sublimeLaunch, {
        command: "subl",
        args: ["/tmp/workspace"],
      });

      const webstormLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "webstorm" },
        "linux",
      );
      assert.deepEqual(webstormLaunch, {
        command: "webstorm",
        args: ["/tmp/workspace"],
      });

      const intellijLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "intellij" },
        "linux",
      );
      assert.deepEqual(intellijLaunch, {
        command: "idea",
        args: ["/tmp/workspace"],
      });

      const fleetLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "fleet" },
        "linux",
      );
      assert.deepEqual(fleetLaunch, {
        command: "fleet",
        args: ["/tmp/workspace"],
      });

      const positronLaunch = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "positron" },
        "linux",
      );
      assert.deepEqual(positronLaunch, {
        command: "positron",
        args: ["/tmp/workspace"],
      });
    }),
  );

  it.effect("uses open -na on macOS for terminal editors like Ghostty", () =>
    Effect.gen(function* () {
      const ghosttyMac = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "ghostty" },
        "darwin",
      );
      assert.deepEqual(ghosttyMac, {
        command: "open",
        args: ["-na", "Ghostty", "--args", "--working-directory=/tmp/workspace"],
      });

      const ghosttyLinux = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "ghostty" },
        "linux",
      );
      assert.deepEqual(ghosttyLinux, {
        command: "ghostty",
        args: ["--working-directory=/tmp/workspace"],
      });
    }),
  );

  it.effect("uses the containing directory when terminal editors receive a file path", () =>
    Effect.gen(function* () {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-open-ghostty-"));
      const filePath = path.join(tempDir, "nested", "AGENTS.md");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "# test\n", "utf8");

      const ghosttyFileTarget = yield* resolveEditorLaunch(
        { cwd: `${filePath}:48`, editor: "ghostty" },
        "linux",
      );

      assert.deepEqual(ghosttyFileTarget, {
        command: "ghostty",
        args: [`--working-directory=${path.dirname(filePath)}`],
      });
    }),
  );

  it.effect("uses --goto when editor supports line/column suffixes", () =>
    // Use "linux" to avoid macOS .app fallback logic for deterministic results.
    Effect.gen(function* () {
      const lineOnly = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace/AGENTS.md:48", editor: "cursor" },
        "linux",
      );
      assert.deepEqual(lineOnly, {
        command: "cursor",
        args: ["--goto", "/tmp/workspace/AGENTS.md:48"],
      });

      const lineAndColumn = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace/src/open.ts:71:5", editor: "cursor" },
        "linux",
      );
      assert.deepEqual(lineAndColumn, {
        command: "cursor",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const vscodeLineAndColumn = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace/src/open.ts:71:5", editor: "vscode" },
        "linux",
      );
      assert.deepEqual(vscodeLineAndColumn, {
        command: "code",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const zedLineAndColumn = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace/src/open.ts:71:5", editor: "zed" },
        "linux",
      );
      assert.deepEqual(zedLineAndColumn, {
        command: "zed",
        args: ["/tmp/workspace/src/open.ts:71:5"],
      });

      const windsurfLineAndColumn = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace/src/open.ts:71:5", editor: "windsurf" },
        "linux",
      );
      assert.deepEqual(windsurfLineAndColumn, {
        command: "windsurf",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });

      const positronLineAndColumn = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace/src/open.ts:71:5", editor: "positron" },
        "linux",
      );
      assert.deepEqual(positronLineAndColumn, {
        command: "positron",
        args: ["--goto", "/tmp/workspace/src/open.ts:71:5"],
      });
    }),
  );

  it.effect("maps file-manager editor to OS open commands", () =>
    Effect.gen(function* () {
      const launch1 = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "file-manager" },
        "darwin",
      );
      assert.deepEqual(launch1, {
        command: "open",
        args: ["/tmp/workspace"],
      });

      const launch2 = yield* resolveEditorLaunch(
        { cwd: "C:\\workspace", editor: "file-manager" },
        "win32",
      );
      assert.deepEqual(launch2, {
        command: "explorer",
        args: ["C:\\workspace"],
      });

      const launch3 = yield* resolveEditorLaunch(
        { cwd: "/tmp/workspace", editor: "file-manager" },
        "linux",
      );
      assert.deepEqual(launch3, {
        command: "xdg-open",
        args: ["/tmp/workspace"],
      });
    }),
  );
});

it.layer(NodeServices.layer)("launchDetached", (it) => {
  it.effect("resolves when command can be spawned", () =>
    Effect.gen(function* () {
      const result = yield* launchDetached({
        command: process.execPath,
        args: ["-e", "process.exit(0)"],
      }).pipe(Effect.result);
      assertSuccess(result, undefined);
    }),
  );

  it.effect("rejects when command does not exist", () =>
    Effect.gen(function* () {
      const result = yield* launchDetached({
        command: `t3code-no-such-command-${Date.now()}`,
        args: [],
      }).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
    }),
  );
});

it.layer(NodeServices.layer)("isCommandAvailable", (it) => {
  it.effect("resolves win32 commands with PATHEXT", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(dir, "code.CMD"), "@echo off\r\n");
      const env = {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("code", { platform: "win32", env }), true);
    }),
  );

  it("returns false when a command is not on PATH", () => {
    const env = {
      PATH: "",
      PATHEXT: ".COM;.EXE;.BAT;.CMD",
    } satisfies NodeJS.ProcessEnv;
    assert.equal(isCommandAvailable("definitely-not-installed", { platform: "win32", env }), false);
  });

  it.effect("does not treat bare files without executable extension as available on win32", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(dir, "npm"), "echo nope\r\n");
      const env = {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("npm", { platform: "win32", env }), false);
    }),
  );

  it.effect("appends PATHEXT for commands with non-executable extensions on win32", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(dir, "my.tool.CMD"), "@echo off\r\n");
      const env = {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("my.tool", { platform: "win32", env }), true);
    }),
  );

  it.effect("uses platform-specific PATH delimiter for platform overrides", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const firstDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      const secondDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-open-test-" });
      yield* fs.writeFileString(path.join(firstDir, "code.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(secondDir, "code.CMD"), "MZ");
      const env = {
        PATH: `${firstDir};${secondDir}`,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      } satisfies NodeJS.ProcessEnv;
      assert.equal(isCommandAvailable("code", { platform: "win32", env }), true);
    }),
  );
});

it.layer(NodeServices.layer)("resolveAvailableEditors", (it) => {
  it.effect("returns installed editors for command launches", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-editors-" });

      yield* fs.writeFileString(path.join(dir, "cursor.CMD"), "@echo off\r\n");
      yield* fs.writeFileString(path.join(dir, "explorer.CMD"), "MZ");
      const editors = resolveAvailableEditors("win32", {
        PATH: dir,
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
      });
      assert.deepEqual(editors, ["cursor", "file-manager"]);
    }),
  );
});
