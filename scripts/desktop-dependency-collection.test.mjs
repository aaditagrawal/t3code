import * as NodeModule from "node:module";
import { describe, expect, it } from "vite-plus/test";

const desktopRequire = NodeModule.createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const builderRequire = NodeModule.createRequire(desktopRequire.resolve("electron-builder"));
const { resolveFirstMatchingCollection } = builderRequire(
  "app-builder-lib/out/util/appFileCopier.js",
);

const modules = [
  { name: "electron-updater", version: "6.8.9", dir: "/stage/node_modules/electron-updater" },
];

describe("desktop production dependency closure", () => {
  it("falls back when pnpm reports a duplicate reference without the dependency itself", async () => {
    const calls = [];
    const complete = {
      nodeModules: [
        ...modules,
        { name: "debug", version: "4.4.3", dir: "/stage/node_modules/debug" },
      ],
      logSummary: {},
    };
    const result = await resolveFirstMatchingCollection({
      pmApproaches: ["pnpm", "traversal"],
      searchDirectories: ["/stage"],
      dependencies: { "electron-updater": "^6.6.2" },
      run: async (pm) => {
        calls.push(pm);
        return pm === "pnpm"
          ? {
              nodeModules: modules,
              logSummary: { "unresolved duplicate dependency references": ["debug@4.4.3"] },
            }
          : complete;
      },
    });
    expect(calls).toEqual(["pnpm", "traversal"]);
    expect(result).toBe(complete);
  });

  it("fails packaging if every collector is missing required dependencies", async () => {
    await expect(
      resolveFirstMatchingCollection({
        pmApproaches: ["pnpm", "traversal"],
        searchDirectories: ["/stage"],
        dependencies: { "electron-updater": "^6.6.2" },
        run: async () => ({
          nodeModules: modules,
          logSummary: { "dependency not found on disk": ["debug"] },
        }),
      }),
    ).rejects.toThrow("incomplete production dependency tree");
  });

  it("allows absent optional dependencies for other platforms", async () => {
    const complete = {
      nodeModules: modules,
      logSummary: { "missing optional dependencies": ["windows-only-module"] },
    };
    expect(
      await resolveFirstMatchingCollection({
        pmApproaches: ["pnpm"],
        searchDirectories: ["/stage"],
        dependencies: { "electron-updater": "^6.6.2" },
        run: async () => complete,
      }),
    ).toBe(complete);
  });
});
