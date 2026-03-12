import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      testTimeout: 15_000,
      hookTimeout: 15_000,
      server: {
        deps: {
          // @github/copilot-sdk imports "vscode-jsonrpc/node" which fails
          // under Node ESM because the package lacks an "exports" map.
          // Inlining the SDK lets Vite's bundler resolve the bare specifier.
          inline: ["@github/copilot-sdk"],
        },
      },
    },
  }),
);
