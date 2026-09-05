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

it("keeps pnpm 11 subtrees that contain both real and deduplicated children", async () => {
  const { PnpmNodeModulesCollector } = builderRequire(
    "app-builder-lib/out/node-module-collector/pnpmNodeModulesCollector.js",
  );
  const root = {
    name: "app",
    dependencies: {
      parent: {
        version: "1.0.0",
        dedupedDependenciesCount: 1,
        dependencies: {
          shared: { version: "1.0.0", deduped: true, dedupedDependenciesCount: 1 },
          first: { version: "1.0.0" },
        },
      },
      shared: { version: "1.0.0" },
      wrapper: {
        version: "1.0.0",
        dependencies: {
          parent: {
            version: "1.0.0",
            dependencies: {
              debug: { version: "4.4.3", dependencies: { ms: { version: "2.1.3" } } },
            },
          },
        },
      },
    },
  };
  const collector = new PnpmNodeModulesCollector("/stage", {});
  collector._pnpmMajorVersion = 11;
  collector._allWorkspacePackages = [root];
  collector.locateFromDepOrRoot = async (name) => ({ packageDir: `/stage/node_modules/${name}` });
  await collector.collectAllDependencies(root, "app");
  expect([...collector.allDependencies.keys()]).toEqual([
    "parent@1.0.0",
    "first@1.0.0",
    "shared@1.0.0",
    "wrapper@1.0.0",
    "debug@4.4.3",
    "ms@2.1.3",
  ]);
});
