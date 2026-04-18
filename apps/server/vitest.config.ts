import { createRequire } from "node:module";
import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config.ts";

const require = createRequire(import.meta.url);

// @github/copilot-sdk ships an ESM build that imports "vscode-jsonrpc/node"
// without the `.js` extension. Under Node's nodenext resolver (used by
// vitest's SSR loader) this throws "Cannot find module". Resolve the actual
// file on disk and alias the extensionless specifier to it so the copilot-sdk
// can be loaded during tests. Runtime code paths use Bun which tolerates the
// extensionless specifier, so this shim is test-only.
let vscodeJsonrpcNodePath: string | undefined;
try {
  vscodeJsonrpcNodePath = require.resolve("vscode-jsonrpc/node.js");
} catch {
  vscodeJsonrpcNodePath = undefined;
}

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
    test: {
      // The server suite exercises sqlite, git, temp worktrees, and orchestration
      // runtimes heavily. Running files in parallel introduces load-sensitive flakes.
      fileParallelism: false,
      // Server integration tests exercise sqlite, git, and orchestration together.
      // Under package-wide parallel runs they regularly exceed the default 15s budget.
      testTimeout: 60_000,
      hookTimeout: 60_000,
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
