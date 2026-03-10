import { describe, expect, it } from "vitest";

import { resolveBundledCopilotCliPathFrom, withSanitizedCopilotDesktopEnv } from "./copilotCliPath.ts";

describe("resolveBundledCopilotCliPathFrom", () => {
  it("prefers the unpacked desktop resources path when available", () => {
    const existingPaths = new Set([
      "/Applications/T3 Code.app/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot-darwin-arm64/copilot",
    ]);

    const resolved = resolveBundledCopilotCliPathFrom({
      currentDir:
        "/Applications/T3 Code.app/Contents/Resources/app.asar/apps/server/dist/provider/Layers",
      resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
      platform: "darwin",
      arch: "arm64",
      exists: (candidate) => existingPaths.has(candidate),
    });

    expect(resolved).toBe(
      "/Applications/T3 Code.app/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot-darwin-arm64/copilot",
    );
  });

  it("falls back to app.asar.unpacked relative to the bundled server when resourcesPath is absent", () => {
    const existingPaths = new Set([
      "/Applications/T3 Code.app/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot-darwin-arm64/copilot",
    ]);

    const resolved = resolveBundledCopilotCliPathFrom({
      currentDir:
        "/Applications/T3 Code.app/Contents/Resources/app.asar/apps/server/dist/provider/Layers",
      platform: "darwin",
      arch: "arm64",
      exists: (candidate) => existingPaths.has(candidate),
    });

    expect(resolved).toBe(
      "/Applications/T3 Code.app/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot-darwin-arm64/copilot",
    );
  });

  it("returns undefined when only the npm loader is present", () => {
    const existingPaths = new Set([
      "/Applications/T3 Code.app/Contents/Resources/app.asar.unpacked/node_modules/@github/copilot/npm-loader.js",
    ]);

    const resolved = resolveBundledCopilotCliPathFrom({
      currentDir:
        "/Applications/T3 Code.app/Contents/Resources/app.asar/apps/server/dist/provider/Layers",
      platform: "darwin",
      arch: "arm64",
      exists: (candidate) => existingPaths.has(candidate),
    });

    expect(resolved).toBeUndefined();
  });
});

describe("withSanitizedCopilotDesktopEnv", () => {
  it("strips Electron-specific env vars during desktop Copilot operations and restores them after", async () => {
    const originalMode = process.env.T3CODE_MODE;
    const originalRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    const originalRendererPort = process.env.ELECTRON_RENDERER_PORT;
    const originalClaudeCode = process.env.CLAUDECODE;

    process.env.T3CODE_MODE = "desktop";
    process.env.ELECTRON_RUN_AS_NODE = "1";
    process.env.ELECTRON_RENDERER_PORT = "5173";
    process.env.CLAUDECODE = "1";

    try {
      await withSanitizedCopilotDesktopEnv(async () => {
        expect(process.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
        expect(process.env.ELECTRON_RENDERER_PORT).toBeUndefined();
        expect(process.env.CLAUDECODE).toBeUndefined();
      });

      expect(process.env.ELECTRON_RUN_AS_NODE).toBe("1");
      expect(process.env.ELECTRON_RENDERER_PORT).toBe("5173");
      expect(process.env.CLAUDECODE).toBe("1");
    } finally {
      if (originalMode === undefined) delete process.env.T3CODE_MODE;
      else process.env.T3CODE_MODE = originalMode;
      if (originalRunAsNode === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = originalRunAsNode;
      if (originalRendererPort === undefined) delete process.env.ELECTRON_RENDERER_PORT;
      else process.env.ELECTRON_RENDERER_PORT = originalRendererPort;
      if (originalClaudeCode === undefined) delete process.env.CLAUDECODE;
      else process.env.CLAUDECODE = originalClaudeCode;
    }
  });
});
