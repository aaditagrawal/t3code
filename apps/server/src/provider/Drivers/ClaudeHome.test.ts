import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  makeClaudeCapabilitiesCacheKey,
  makeClaudeContinuationGroupKey,
  makeClaudeEnvironment,
  resolveClaudeConfigDir,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("uses the process home when no Claude home override is configured", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolvedHome = path.resolve(NodeOS.homedir());
        const defaultConfigDir = path.join(resolvedHome, ".claude");

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolvedHome);
        expect(yield* resolveClaudeConfigDir({ homePath: "" })).toBe(defaultConfigDir);
        expect(yield* makeClaudeEnvironment({ homePath: "" })).toBe(process.env);
      }),
    );

    it.effect("preserves legacy HOME layouts under $HOME/.claude for CLAUDE_CONFIG_DIR", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolvedHome = path.resolve(NodeOS.homedir(), ".claude-work");
        const configDir = path.join(resolvedHome, ".claude");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolvedHome);
        expect(yield* resolveClaudeConfigDir({ homePath })).toBe(configDir);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(configDir);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(
          `claude:home:${configDir}`,
        );
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${configDir}\0`,
        );
      }),
    );

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );

    it.effect("treats paths that already end with .claude as the config dir", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude";
        const configDir = path.resolve(NodeOS.homedir(), ".claude");

        expect(yield* resolveClaudeConfigDir({ homePath })).toBe(configDir);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(configDir);
        expect(yield* makeClaudeContinuationGroupKey({ homePath })).toBe(
          `claude:home:${configDir}`,
        );
      }),
    );

    it.effect("keys continuation by the effective default config directory", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const defaultConfigDir = path.resolve(path.join(NodeOS.homedir(), ".claude"));

        expect(yield* makeClaudeContinuationGroupKey({ homePath: "" })).toBe(
          `claude:home:${defaultConfigDir}`,
        );
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "~/.claude" })).toBe(
          `claude:home:${defaultConfigDir}`,
        );
        expect(yield* makeClaudeContinuationGroupKey({ homePath: "~" })).toBe(
          `claude:home:${defaultConfigDir}`,
        );
      }),
    );
  });
});
