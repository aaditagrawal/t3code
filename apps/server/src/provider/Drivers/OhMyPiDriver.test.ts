// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import * as Layer from "effect/Layer";

import { ServerConfig } from "../../config.ts";
import { layer as idAllocatorLayer } from "../../orchestration-v2/IdAllocator.ts";
import { AcpProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/AcpAdapterV2.ts";
import { legacyAdapterV2Capabilities } from "../../orchestration-v2/Adapters/LegacyAdapterV2.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "../Layers/ProviderEventLoggers.ts";
import { resolveOhMyPiAuthMethodId } from "../Layers/OhMyPiAdapter.ts";
import {
  checkStandardAcpCliProviderStatus,
  type StandardAcpCliProviderConfig,
} from "../Layers/StandardAcpCliProvider.ts";
import { makeOhMyPiProbeArgs, OhMyPiDriver } from "./OhMyPiDriver.ts";

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

const driverLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-oh-my-pi-driver-v2-",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(idAllocatorLayer),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  Layer.provideMerge(
    Layer.mock(BackgroundPolicy.BackgroundPolicy)({
      shouldRunScopeWork: () => Effect.succeed(false),
    }),
  ),
);

it.layer(driverLayer)("OhMyPiDriver orchestration adapter", (it) => {
  it.effect("uses the native Oh My Pi v2 adapter instead of LegacyAdapterV2", () =>
    Effect.gen(function* () {
      const instance = yield* OhMyPiDriver.create({
        instanceId: ProviderInstanceId.make("ohMyPi-v2"),
        displayName: "Oh My Pi",
        enabled: false,
        environment: [],
        config: OhMyPiDriver.defaultConfig(),
      });
      const capabilities = yield* instance.orchestrationAdapter.getCapabilities();
      const legacy = legacyAdapterV2Capabilities(
        {
          resume: "acp",
          nativeHistory: false,
          reasoning: true,
          approvals: true,
          questions: true,
          planning: true,
          mcp: true,
        },
        true,
      );
      assert.equal(instance.orchestrationAdapter.driver, "ohMyPi");
      assert.deepEqual(capabilities, AcpProviderCapabilitiesV2);
      assert.notDeepEqual(capabilities, legacy);
      assert.isTrue(capabilities.threads.canRollbackThread);
      assert.isFalse(legacy.threads.canRollbackThread);
      assert.isTrue(capabilities.turns.supportsSteeringByInterruptRestart);
      assert.isFalse(legacy.turns.supportsSteeringByInterruptRestart);
    }).pipe(Effect.scoped),
  );
});
