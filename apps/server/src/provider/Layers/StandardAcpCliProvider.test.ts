// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as TestClock from "effect/testing/TestClock";

import {
  __testing,
  checkStandardAcpCliProviderStatus,
  type StandardAcpCliProviderConfig,
} from "./StandardAcpCliProvider.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const providerConfig = {
  provider: ProviderDriverKind.make("acp"),
  displayName: "ACP Agent",
  command: process.execPath,
  enabled: true,
  customModels: [],
  environment: {
    ...process.env,
    T3_ACP_AVAILABLE_COMMANDS_TIMING: "before-response",
    T3_ACP_EMPTY_AVAILABLE_COMMANDS: "1",
  },
  setupHint: "Configure the ACP agent.",
  missingCommandMessage: "ACP agent not found.",
} satisfies StandardAcpCliProviderConfig;

describe("standard ACP CLI provider errors", () => {
  it("classifies platform not-found spawn errors as missing commands", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpSpawnError",
        cause: { _tag: "PlatformError", reason: { _tag: "NotFound" } },
      }),
    ).toBe(true);
  });

  it("classifies raw ENOENT spawn errors as missing commands", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpSpawnError",
        cause: { code: "ENOENT" },
      }),
    ).toBe(true);
  });

  it("keeps permission-denied spawn errors on the startup-failure path", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpSpawnError",
        cause: { _tag: "PlatformError", reason: { _tag: "PermissionDenied" } },
      }),
    ).toBe(false);
  });

  it("does not treat unrelated not-found errors as missing commands", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpRequestError",
        cause: { _tag: "PlatformError", reason: { _tag: "NotFound" } },
      }),
    ).toBe(false);
  });
});

describe("standard ACP CLI model discovery", () => {
  it("uses the initialized agent version for the provider snapshot", () => {
    expect(
      __testing.agentVersionFromInitialize({
        protocolVersion: 1,
        agentCapabilities: {},
        agentInfo: { name: "Oh My Pi", version: " 18.0.3 " },
      }),
    ).toBe("18.0.3");
  });

  it("discovers models advertised through a model config option", () => {
    expect(
      __testing
        .modelsFromConfigOptions(
          [
            {
              id: "model",
              name: "Model",
              category: "model",
              type: "select",
              currentValue: "anthropic/claude-sonnet-4.6",
              options: [
                { name: "Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4.6" },
                { name: "GPT-5", value: "openai/gpt-5" },
              ],
            },
          ],
          ProviderDriverKind.make("fx"),
        )
        .map((model) => model.slug),
    ).toEqual(["anthropic/claude-sonnet-4.6", "openai/gpt-5"]);
  });
});

describe("standard ACP CLI command discovery", () => {
  it.effect("waits for the first command update", () =>
    Effect.gen(function* () {
      const commands = [{ name: "help", description: "Show help" }];
      const update = yield* Deferred.make<typeof commands>();
      const fiber = yield* __testing
        .waitForAvailableCommands({ awaitAvailableCommands: Deferred.await(update) })
        .pipe(Effect.forkChild);

      yield* Deferred.succeed(update, commands);

      expect(yield* Fiber.join(fiber)).toEqual(Option.some(commands));
    }),
  );

  it.effect("treats an empty command update as ready", () =>
    Effect.gen(function* () {
      const update = yield* Deferred.make<ReadonlyArray<never>>();
      yield* Deferred.succeed(update, []);

      const result = yield* __testing.waitForAvailableCommands({
        awaitAvailableCommands: Deferred.await(update),
      });

      expect(result).toEqual(Option.some([]));
    }),
  );

  it.effect("stops waiting after the command discovery window", () =>
    Effect.gen(function* () {
      const fiber = yield* __testing
        .waitForAvailableCommands({ awaitAvailableCommands: Effect.never })
        .pipe(Effect.forkChild);

      yield* TestClock.adjust("1500 millis");

      expect(yield* Fiber.join(fiber)).toEqual(Option.none());
    }),
  );

  it("normalizes names, inputs, and duplicates", () => {
    expect(
      __testing.slashCommandsFromAcpCommands([
        { name: "/help", description: "Show help" },
        { name: "help", description: "Duplicate" },
        { name: "model", inputHint: "model name" },
      ]),
    ).toEqual([
      { name: "help", description: "Show help" },
      { name: "model", input: { hint: "model name" } },
    ]);
  });
});

it.layer(NodeServices.layer)("standard ACP CLI provider arguments", (it) => {
  it.effect("turns probe-argument preparation failures into an error snapshot", () =>
    Effect.gen(function* () {
      const provider = yield* checkStandardAcpCliProviderStatus(providerConfig, {
        prepareArgs: Effect.fail(
          new PlatformError.PlatformError(
            new PlatformError.BadArgument({
              module: "FileSystem",
              method: "makeTempDirectoryScoped",
              description: "temporary session directory unavailable",
            }),
          ),
        ),
      });

      expect(provider.status).toBe("error");
      expect(provider.message).toContain("ACP startup failed or timed out");
    }),
  );

  for (const timing of ["before-response", "after-response"] as const) {
    it.effect(`captures commands sent ${timing}`, () =>
      Effect.gen(function* () {
        const provider = yield* checkStandardAcpCliProviderStatus({
          ...providerConfig,
          args: [mockAgentPath],
          environment: {
            ...providerConfig.environment,
            T3_ACP_AVAILABLE_COMMANDS_TIMING: timing,
            T3_ACP_AVAILABLE_COMMANDS_DELAY_MS: "50",
            T3_ACP_EMPTY_AVAILABLE_COMMANDS: "0",
          },
        });

        expect(provider.slashCommands).toEqual([
          { name: "help", description: "List available commands" },
          { name: "model", description: "Switch model", input: { hint: "model name" } },
        ]);
      }),
    );
  }

  it.effect("forwards configured arguments during provider discovery", () =>
    Effect.gen(function* () {
      const provider = yield* checkStandardAcpCliProviderStatus({
        ...providerConfig,
        args: [mockAgentPath, "--model", "dots/model:free"],
      });
      expect(provider.status).toBe("ready");
    }),
  );

  it.effect("starts commands with no configured arguments", () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "acp-probe-test-"))),
        (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
      );
      const wrapper = NodePath.join(dir, "acp-agent");
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          wrapper,
          `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(mockAgentPath)}\n`,
          { encoding: "utf8", mode: 0o755 },
        ),
      );
      const provider = yield* checkStandardAcpCliProviderStatus({
        ...providerConfig,
        command: wrapper,
      });
      expect(provider.status).toBe("ready");
    }).pipe(Effect.scoped),
  );
});
