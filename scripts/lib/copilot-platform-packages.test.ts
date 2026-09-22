import { describe, expect, it } from "vite-plus/test";

import { resolveBundledCopilotPlatformPackages } from "./copilot-platform-packages.ts";

describe("bundled Copilot platforms", () => {
  it.each([
    ["mac", "arm64", "darwin-arm64"],
    ["mac", "x64", "darwin-x64"],
    ["linux", "arm64", "linux-arm64"],
    ["linux", "x64", "linux-x64"],
    ["win", "arm64", "win32-arm64"],
    ["win", "x64", "win32-x64"],
  ] as const)("stages the executable for %s %s", (platform, arch, expected) => {
    expect(resolveBundledCopilotPlatformPackages(platform, arch)).toEqual([
      `@github/copilot-${expected}`,
    ]);
  });

  it("includes both executables in universal macOS packages", () => {
    expect(resolveBundledCopilotPlatformPackages("mac", "universal")).toEqual([
      "@github/copilot-darwin-arm64",
      "@github/copilot-darwin-x64",
    ]);
  });
});
