import * as NodeModule from "node:module";

import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
import { loadRepoEnv } from "../../scripts/lib/public-config.ts";
import packageJson from "./package.json" with { type: "json" };

const bundledPackagePrefixes = [
  "@pierre/diffs",
  "@t3tools/",
  "effect-acp",
  "effect-codex-app-server",
  "@github/copilot",
  "vscode-jsonrpc",
  "@anthropic-ai/claude-agent-sdk",
  "@opencode-ai/",
];

const require = NodeModule.createRequire(import.meta.url);

// @github/copilot-sdk ships an ESM build that imports "vscode-jsonrpc/node"
// without the `.js` extension. Under Node's nodenext resolver this throws
// "Cannot find module". Resolve the actual file on disk and alias the
// extensionless specifier to it so the copilot-sdk can be loaded during tests.
let vscodeJsonrpcNodePath: string | undefined;
try {
  vscodeJsonrpcNodePath = require.resolve("vscode-jsonrpc/node.js");
} catch {
  vscodeJsonrpcNodePath = undefined;
}

export function shouldBundleCliDependency(id: string): boolean {
  return bundledPackagePrefixes.some((prefix) => id.startsWith(prefix));
}

const repoEnv = loadRepoEnv();
const cliBuildChannel = packageJson.version.includes("-nightly.") ? "nightly" : "latest";

export default mergeConfig(
  baseConfig,
  defineConfig({
    ...(vscodeJsonrpcNodePath
      ? {
          resolve: {
            alias: [
              {
                find: /^vscode-jsonrpc\/node$/,
                replacement: vscodeJsonrpcNodePath,
              },
            ],
          },
        }
      : {}),
    run: {
      tasks: {
        build: {
          command: "node scripts/cli.ts build",
          dependsOn: ["@t3tools/web#build"],
          cache: false,
        },
      },
    },
    pack: {
      entry: ["src/bin.ts"],
      outDir: "dist",
      sourcemap: true,
      clean: true,
      deps: {
        alwaysBundle: shouldBundleCliDependency,
        onlyBundle: false,
      },
      banner: {
        js: "#!/usr/bin/env node\n",
      },
      define: {
        __T3CODE_BUILD_CHANNEL__: JSON.stringify(cliBuildChannel),
        __T3CODE_BUILD_RELAY_URL__: JSON.stringify(repoEnv.T3CODE_RELAY_URL?.trim() ?? ""),
        __T3CODE_BUILD_CLERK_PUBLISHABLE_KEY__: JSON.stringify(
          repoEnv.T3CODE_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
        ),
        __T3CODE_BUILD_CLERK_CLI_OAUTH_CLIENT_ID__: JSON.stringify(
          repoEnv.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID?.trim() ?? "",
        ),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_URL__: JSON.stringify(
          repoEnv.T3CODE_RELAY_CLIENT_OTLP_TRACES_URL?.trim() ?? "",
        ),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_DATASET__: JSON.stringify(
          repoEnv.T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET?.trim() ?? "",
        ),
        __T3CODE_BUILD_RELAY_CLIENT_OTLP_TRACES_TOKEN__: JSON.stringify(
          repoEnv.T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN?.trim() ?? "",
        ),
      },
    },
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide runs they can exceed the default budget on loaded CI hosts.
      hookTimeout: 120_000,
      testTimeout: 120_000,
      server: {
        deps: {
          // Force vite to transform @github/copilot-sdk and its vscode-jsonrpc
          // dependency through the SSR pipeline so the resolve alias above
          // (vscode-jsonrpc/node -> vscode-jsonrpc/node.js) applies. Without
          // this, Node's native loader handles the import and rejects the
          // extensionless specifier under nodenext resolution.
          inline: [/@github\/copilot-sdk/, /vscode-jsonrpc/],
        },
      },
    },
  }),
);
