// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

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
  environment: process.env,
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

it.layer(NodeServices.layer)("standard ACP CLI provider arguments", (it) => {
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
