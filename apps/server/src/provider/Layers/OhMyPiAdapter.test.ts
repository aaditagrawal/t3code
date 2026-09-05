// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  type ModelSelection,
  OhMyPiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as EffectAcpSchema from "effect-acp/schema";

import { ServerConfig } from "../../config.ts";
import {
  applyOhMyPiAcpSelection,
  currentOhMyPiOptionsFromSetup,
  makeOhMyPiAdapter,
  OH_MY_PI_AUTH_METHOD_ID,
  OH_MY_PI_DEFAULT_MODE_ID,
  OH_MY_PI_PLAN_MODE_ID,
  OH_MY_PI_THINKING_AUTO,
  OH_MY_PI_THINKING_OFF,
  requestedOhMyPiOptionsFromSelection,
  resolveOhMyPiAuthMethodId,
  resolveOhMyPiPlanMode,
  resolveOhMyPiThinkingValue,
} from "./OhMyPiAdapter.ts";

const decodeOhMyPiSettings = Schema.decodeUnknownEffect(OhMyPiSettings);
const instanceId = ProviderInstanceId.make("ohMyPi");
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const ohMyPiConfigAgentPath = NodePath.join(
  __dirname,
  "../acp/testFixtures/oh-my-pi-config-agent.ts",
);

function selection(
  options: ModelSelection["options"],
  model = "anthropic/claude-sonnet-4.6",
): ModelSelection {
  return {
    instanceId,
    model,
    ...(options ? { options } : {}),
  };
}

function selectOption(input: {
  readonly id: string;
  readonly category: "mode" | "model" | "thought_level";
  readonly currentValue: string;
  readonly values: ReadonlyArray<string>;
  readonly type?: "select" | "boolean";
}): EffectAcpSchema.SessionConfigOption {
  if (input.type === "boolean") {
    return {
      id: input.id,
      name: input.id,
      category: input.category,
      type: "boolean",
      currentValue: input.currentValue === "true",
    };
  }
  return {
    id: input.id,
    name: input.id,
    category: input.category,
    type: "select",
    currentValue: input.currentValue,
    options: input.values.map((value) => ({ value, name: value })),
  };
}

async function makeMockOhMyPiWrapper() {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "oh-my-pi-config-mock-"));
  const wrapperPath = NodePath.join(dir, "fake-omp.sh");
  await NodeFSP.writeFile(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(ohMyPiConfigAgentPath)} "$@"\n`,
    "utf8",
  );
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-oh-my-pi-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

describe("Oh My Pi auth method resolution", () => {
  it("selects the advertised agent method over terminal setup", () => {
    expect(
      resolveOhMyPiAuthMethodId({
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [
          { id: "agent", name: "Use existing local credentials" },
          { id: "terminal", name: "Set up Oh My Pi in terminal" },
        ],
      }),
    ).toBe(OH_MY_PI_AUTH_METHOD_ID);
  });

  it("selects the first advertised method named agent when the id differs", () => {
    expect(
      resolveOhMyPiAuthMethodId({
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [
          { id: "terminal", name: "Terminal" },
          { id: "omp-agent", name: "Agent" },
        ],
      }),
    ).toBe("omp-agent");
  });

  it("skips authenticate when initialize advertises no methods", () => {
    expect(
      resolveOhMyPiAuthMethodId({
        protocolVersion: 1,
        agentCapabilities: {},
      }),
    ).toBeUndefined();
  });

  it("falls back to agent when initialize advertises methods but none are named agent", () => {
    expect(
      resolveOhMyPiAuthMethodId({
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [{ id: "terminal", name: "Set up Oh My Pi in terminal" }],
      }),
    ).toBe(OH_MY_PI_AUTH_METHOD_ID);
  });
});

describe("Oh My Pi thinking and plan mapping", () => {
  it("maps boolean thinking onto the string select values omp accepts", () => {
    expect(resolveOhMyPiThinkingValue(selection([{ id: "thinking", value: false }]))).toBe(
      OH_MY_PI_THINKING_OFF,
    );
    expect(resolveOhMyPiThinkingValue(selection([{ id: "thinking", value: true }]))).toBe(
      OH_MY_PI_THINKING_AUTO,
    );
  });

  it("maps reasoning effort and thinking strings onto omp thinking levels", () => {
    expect(resolveOhMyPiThinkingValue(selection([{ id: "thinking", value: "high" }]))).toBe("high");
    expect(
      resolveOhMyPiThinkingValue(selection([{ id: "reasoningEffort", value: "extra-high" }])),
    ).toBe("xhigh");
    expect(resolveOhMyPiThinkingValue(selection([{ id: "reasoning", value: "none" }]))).toBe(
      OH_MY_PI_THINKING_OFF,
    );
    expect(
      requestedOhMyPiOptionsFromSelection(selection([{ id: "thinking", value: true }])),
    ).toEqual({ thinking: OH_MY_PI_THINKING_AUTO });
  });

  it("ignores unknown thinking tokens instead of sending them", () => {
    expect(resolveOhMyPiThinkingValue(selection([{ id: "thinking", value: "bogus" }]))).toBe(
      undefined,
    );
  });

  it("maps T3 plan interaction onto the omp mode config option", () => {
    expect(resolveOhMyPiPlanMode("plan")).toBe(OH_MY_PI_PLAN_MODE_ID);
    expect(resolveOhMyPiPlanMode("default")).toBe(OH_MY_PI_DEFAULT_MODE_ID);
    expect(resolveOhMyPiPlanMode(undefined)).toBeUndefined();
  });

  it("reads current thinking and plan mode from session setup config options", () => {
    expect(
      currentOhMyPiOptionsFromSetup({
        sessionId: "omp-session",
        configOptions: [
          selectOption({
            id: "thinking",
            category: "thought_level",
            currentValue: "auto",
            values: ["off", "auto", "high"],
          }),
          selectOption({
            id: "mode",
            category: "mode",
            currentValue: "plan",
            values: ["default", "plan"],
          }),
        ],
      }),
    ).toEqual({ thinking: "auto", mode: "plan" });
  });
});

describe("Oh My Pi ACP config option application", () => {
  it.effect("retries a skipped thinking selection after switching to a supporting model", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      let supportsHigh = false;
      let thinking = "off";
      const configOptions = () => [
        selectOption({
          id: "thinking",
          category: "thought_level",
          currentValue: thinking,
          values: supportsHigh ? ["off", "auto", "high"] : ["off", "auto"],
        }),
      ];
      const runtime = {
        getConfigOptions: Effect.sync(configOptions),
        setModel: () =>
          Effect.sync(() => {
            supportsHigh = true;
            return configOptions();
          }),
        setConfigOption: (configId: string, value: string | boolean) =>
          Effect.sync(() => {
            calls.push(`${configId}:${value}`);
            if (typeof value === "string") thinking = value;
            return { configOptions: configOptions() };
          }),
        setMode: () => Effect.succeed({}),
      };
      yield* applyOhMyPiAcpSelection({
        runtime,
        currentModelId: "model-a",
        requestedModelId: "model-a",
        currentModelOptions: { thinking: "off" },
        requestedModelOptions: { thinking: "high" },
        mapError: String,
      });
      expect(calls).toEqual([]);

      yield* applyOhMyPiAcpSelection({
        runtime,
        currentModelId: "model-a",
        requestedModelId: "model-b",
        // The shared adapter remembers the requested value even when unsupported.
        currentModelOptions: { thinking: "high" },
        requestedModelOptions: { thinking: "high" },
        mapError: String,
      });
      expect(calls).toEqual(["thinking:high"]);
    }),
  );

  it.effect("restores plan mode after an agent-side mode change without redundant writes", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      let mode = "default";
      const input = {
        runtime: {
          getConfigOptions: Effect.sync(() => [
            selectOption({
              id: "mode",
              category: "mode",
              currentValue: mode,
              values: ["default", "plan"],
            }),
          ]),
          setModel: () => Effect.succeed([]),
          setConfigOption: () => Effect.succeed({ configOptions: [] }),
          setMode: (modeId: string) =>
            Effect.sync(() => {
              calls.push(modeId);
              mode = modeId;
              return {};
            }),
        },
        currentModelId: undefined,
        requestedModelId: undefined,
        currentModelOptions: { mode: "plan" },
        requestedModelOptions: { mode: "plan" },
        mapError: String,
      };
      yield* applyOhMyPiAcpSelection(input);
      expect(calls).toEqual(["plan"]);
      yield* applyOhMyPiAcpSelection(input);
      expect(calls).toEqual(["plan"]);
    }),
  );

  it.effect("sets thinking and plan as string config options after the model", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: string; args: ReadonlyArray<unknown> }> = [];
      let thinking = "off";
      let mode = "default";
      const configOptions = () => [
        selectOption({
          id: "model",
          category: "model",
          currentValue: "anthropic/claude-sonnet-4.6",
          values: ["anthropic/claude-sonnet-4.6", "openai/gpt-5"],
        }),
        selectOption({
          id: "thinking",
          category: "thought_level",
          currentValue: thinking,
          values: ["off", "auto", "low", "high"],
        }),
        selectOption({
          id: "mode",
          category: "mode",
          currentValue: mode,
          values: ["default", "plan"],
        }),
      ];
      const selected = yield* applyOhMyPiAcpSelection({
        runtime: {
          getConfigOptions: Effect.sync(configOptions),
          setModel: (modelId) =>
            Effect.sync(() => {
              calls.push({ method: "setModel", args: [modelId] });
              return configOptions();
            }),
          setConfigOption: (configId, value) =>
            Effect.sync(() => {
              calls.push({ method: "setConfigOption", args: [configId, value] });
              if (configId === "thinking" && typeof value === "string") thinking = value;
              if (configId === "mode" && typeof value === "string") mode = value;
              return { configOptions: configOptions() };
            }),
          setMode: (modeId) =>
            Effect.sync(() => {
              calls.push({ method: "setMode", args: [modeId] });
              mode = modeId;
              return {};
            }),
        },
        currentModelId: "anthropic/claude-sonnet-4.6",
        requestedModelId: "openai/gpt-5",
        currentModelOptions: { thinking: "off", mode: "default" },
        requestedModelOptions: { thinking: "high", mode: "plan" },
        mapError: String,
      });

      expect(selected).toBe("openai/gpt-5");
      expect(calls).toEqual([
        { method: "setModel", args: ["openai/gpt-5"] },
        { method: "setConfigOption", args: ["thinking", "high"] },
        { method: "setMode", args: ["plan"] },
      ]);
      expect(calls.some((call) => typeof call.args[1] === "boolean")).toBe(false);
    }),
  );

  it.effect("does not send boolean thinking config options", () =>
    Effect.gen(function* () {
      const calls: Array<{ method: string; args: ReadonlyArray<unknown> }> = [];
      yield* applyOhMyPiAcpSelection({
        runtime: {
          getConfigOptions: Effect.succeed([
            selectOption({
              id: "thinking",
              category: "thought_level",
              currentValue: "true",
              values: [],
              type: "boolean",
            }),
            selectOption({
              id: "mode",
              category: "mode",
              currentValue: "default",
              values: ["default", "plan"],
            }),
          ]),
          setModel: () =>
            Effect.sync(() => {
              calls.push({ method: "setModel", args: [] });
              return [];
            }),
          setConfigOption: (configId, value) =>
            Effect.sync(() => {
              calls.push({ method: "setConfigOption", args: [configId, value] });
              return { configOptions: [] };
            }),
          setMode: (modeId) =>
            Effect.sync(() => {
              calls.push({ method: "setMode", args: [modeId] });
              return {};
            }),
        },
        currentModelId: undefined,
        requestedModelId: undefined,
        currentModelOptions: {},
        requestedModelOptions: { thinking: "auto", mode: "plan" },
        mapError: String,
      });

      expect(calls).toEqual([{ method: "setMode", args: ["plan"] }]);
    }),
  );

  it.effect("skips thinking and plan values the agent does not advertise", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      yield* applyOhMyPiAcpSelection({
        runtime: {
          getConfigOptions: Effect.succeed([
            selectOption({
              id: "thinking",
              category: "thought_level",
              currentValue: "off",
              values: ["off", "auto"],
            }),
            selectOption({
              id: "mode",
              category: "mode",
              currentValue: "default",
              values: ["default"],
            }),
          ]),
          setModel: () => Effect.succeed([]),
          setConfigOption: (configId) =>
            Effect.sync(() => {
              calls.push(configId);
              return { configOptions: [] };
            }),
          setMode: () =>
            Effect.sync(() => {
              calls.push("mode");
              return {};
            }),
        },
        currentModelId: undefined,
        requestedModelId: undefined,
        currentModelOptions: { thinking: "off", mode: "default" },
        requestedModelOptions: { thinking: "high", mode: "plan" },
        mapError: String,
      });

      expect(calls).toEqual([]);
    }),
  );
});

describe("Oh My Pi provider kind", () => {
  it("keeps the branded Oh My Pi driver separate from Pi", () => {
    expect(ProviderDriverKind.make("ohMyPi")).toBe("ohMyPi");
    expect(ProviderDriverKind.make("pi")).toBe("pi");
  });
});

it.live("authenticates with agent and maps thinking plus plan mode", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const tempDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-oh-my-pi-config-",
    });
    const requestLogPath = NodePath.join(tempDir, "requests.jsonl");
    const binaryPath = yield* Effect.promise(() => makeMockOhMyPiWrapper());
    const settings = yield* decodeOhMyPiSettings({ binaryPath });
    const adapter = yield* makeOhMyPiAdapter(settings, {
      environment: {
        ...process.env,
        T3_ACP_REQUEST_LOG_PATH: requestLogPath,
      },
    });
    const threadId = ThreadId.make("oh-my-pi-thinking-plan");
    yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("ohMyPi"),
      cwd: process.cwd(),
      runtimeMode: "full-access",
      modelSelection: selection([{ id: "thinking", value: true }]),
    });
    yield* adapter.sendTurn({
      threadId,
      input: "plan the change",
      attachments: [],
      interactionMode: "plan",
      modelSelection: selection([{ id: "thinking", value: "high" }]),
    });
    const log = yield* Effect.tryPromise(() => NodeFSP.readFile(requestLogPath, "utf8"));
    expect(log).toContain('"methodId":"agent"');
    expect(log).toContain('"configId":"thinking"');
    expect(log).toContain('"value":"high"');
    expect(log).toContain('"configId":"mode"');
    expect(log).toContain('"value":"plan"');
    expect(log).not.toContain('"value":true');
    expect(log).not.toContain('"value":false');
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.scoped, Effect.provide(testLayer)),
);
