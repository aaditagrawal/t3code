import { defineConfig, mergeConfig } from "vitest/config";

import baseConfig from "../../vitest.config";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // The server suite spins up long-lived Effect runtimes and git subprocesses.
      // Running files serially avoids worker-pool teardown stalls and the full-suite
      // timing races that only appear under heavy parallel contention.
      fileParallelism: false,
      testTimeout: 60_000,
      hookTimeout: 60_000,
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
