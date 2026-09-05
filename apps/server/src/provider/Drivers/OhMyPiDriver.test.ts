// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { resolveOhMyPiAuthMethodId } from "../Layers/OhMyPiAdapter.ts";
import {
  checkStandardAcpCliProviderStatus,
  type StandardAcpCliProviderConfig,
} from "../Layers/StandardAcpCliProvider.ts";
import { makeOhMyPiProbeArgs } from "./OhMyPiDriver.ts";

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const ohMyPiConfigAgentPath = NodePath.join(
  __dirname,
  "../acp/testFixtures/oh-my-pi-config-agent.ts",
);

const ohMyPiProbeConfig = {
  provider: ProviderDriverKind.make("ohMyPi"),
  displayName: "Oh My Pi",
  command: process.execPath,
  args: ["acp"],
  enabled: true,
  customModels: [],
  environment: process.env,
  setupHint:
    "Install `@oh-my-pi/pi-coding-agent`, then run `omp` and use `/login` to authenticate.",
  missingCommandMessage: "Oh My Pi CLI (`omp`) is not installed or not on PATH.",
  resolveAuthMethodId: resolveOhMyPiAuthMethodId,
  unauthenticatedWhenNoDiscoveredModels: true,
} satisfies StandardAcpCliProviderConfig;

it.layer(NodeServices.layer)("OhMyPi provider probe", (it) => {
  it.effect("uses a scoped session directory without changing runtime argv", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      let capturedSessionDir: string | undefined;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const args = yield* makeOhMyPiProbeArgs(["acp"]);
          assert.equal(args[0], "acp");
          assert.equal(args[1], "--session-dir");
          assert.notInclude(args, "--yolo");
          capturedSessionDir = args[2];
          if (capturedSessionDir === undefined) {
            throw new Error("missing scoped OhMyPi probe session directory");
          }
          assert.isTrue(yield* fileSystem.exists(capturedSessionDir));
        }),
      );
      if (capturedSessionDir === undefined) {
        throw new Error("missing captured OhMyPi probe session directory");
      }
      assert.isFalse(yield* fileSystem.exists(capturedSessionDir));
    }),
  );
});

it.live("treats empty discovered models as unauthenticated", () =>
  Effect.gen(function* () {
    const provider = yield* checkStandardAcpCliProviderStatus(
      {
        ...ohMyPiProbeConfig,
        args: [ohMyPiConfigAgentPath],
        environment: {
          ...process.env,
          T3_OH_MY_PI_EMPTY_MODELS: "1",
        },
      },
      { prepareArgs: makeOhMyPiProbeArgs([ohMyPiConfigAgentPath]) },
    );

    assert.equal(provider.status, "error");
    assert.equal(provider.auth.status, "unauthenticated");
    assert.equal(provider.installed, true);
    assert.equal(provider.version, "18.0.5");
    assert.isTrue((provider.message ?? "").includes("/login"));
    assert.equal(provider.models.length, 0);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.live("keeps empty-model probes ready unless Oh My Pi opts into unauthenticated", () =>
  Effect.gen(function* () {
    const provider = yield* checkStandardAcpCliProviderStatus({
      ...ohMyPiProbeConfig,
      args: [ohMyPiConfigAgentPath],
      unauthenticatedWhenNoDiscoveredModels: false,
      environment: {
        ...process.env,
        T3_OH_MY_PI_EMPTY_MODELS: "1",
      },
    });

    assert.equal(provider.status, "ready");
    assert.equal(provider.auth.status, "unknown");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.live("stays ready when session setup advertises models", () =>
  Effect.gen(function* () {
    const provider = yield* checkStandardAcpCliProviderStatus(
      {
        ...ohMyPiProbeConfig,
        args: [ohMyPiConfigAgentPath],
      },
      { prepareArgs: makeOhMyPiProbeArgs([ohMyPiConfigAgentPath]) },
    );

    assert.equal(provider.status, "ready");
    assert.equal(provider.auth.status, "unknown");
    assert.include(
      provider.models.map((model) => model.slug),
      "anthropic/claude-sonnet-4.6",
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
