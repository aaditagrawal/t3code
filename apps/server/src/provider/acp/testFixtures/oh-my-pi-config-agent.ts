#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as EffectAcpAgent from "effect-acp/agent";
import * as AcpError from "effect-acp/errors";
import type * as AcpSchema from "effect-acp/schema";

const sessionId = "oh-my-pi-config-session";
const requestLogPath = process.env.T3_ACP_REQUEST_LOG_PATH;
const emptyModels = process.env.T3_OH_MY_PI_EMPTY_MODELS === "1";

let currentModelId = "anthropic/claude-sonnet-4.6";
let currentThinking = "off";
let currentModeId = "default";

function appendRequestLog(payload: unknown): void {
  if (!requestLogPath) return;
  NodeFS.appendFileSync(requestLogPath, `${JSON.stringify(payload)}\n`, "utf8");
}

function modeOptions(): ReadonlyArray<{ value: string; name: string }> {
  return [
    { value: "default", name: "Default" },
    { value: "plan", name: "Plan" },
  ];
}

function thinkingOptions(): ReadonlyArray<{ value: string; name: string }> {
  return [
    { value: "off", name: "Off" },
    { value: "auto", name: "Auto" },
    { value: "low", name: "Low" },
    { value: "high", name: "High" },
  ];
}

function configOptions(): ReadonlyArray<AcpSchema.SessionConfigOption> {
  const options: Array<AcpSchema.SessionConfigOption> = [
    {
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: currentModeId,
      options: [...modeOptions()],
    },
  ];
  if (!emptyModels) {
    options.push({
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: currentModelId,
      options: [
        { value: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
        { value: "openai/gpt-5", name: "GPT-5" },
      ],
    });
  }
  options.push({
    id: "thinking",
    name: "Thinking",
    category: "thought_level",
    type: "select",
    currentValue: currentThinking,
    options: [...thinkingOptions()],
  });
  return options;
}

function modeState(): AcpSchema.SessionModeState {
  return {
    currentModeId,
    availableModes: [
      { id: "default", name: "Default", description: "Standard ACP headless mode" },
      { id: "plan", name: "Plan", description: "Read-only planning mode" },
    ],
  };
}

const program = Effect.gen(function* () {
  const agent = yield* EffectAcpAgent.AcpAgent;
  yield* agent.handleInitialize(() =>
    Effect.sync(() => ({
      protocolVersion: 1 as const,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "oh-my-pi", title: "Oh My Pi", version: "18.0.5" },
      authMethods: [
        {
          id: "agent",
          name: "Use existing local credentials",
          description: "Authenticate via credentials already configured under ~/.omp.",
        },
        {
          id: "terminal",
          name: "Set up Oh My Pi in terminal",
          description: "Launch the omp TUI to add provider keys.",
        },
      ],
    })),
  );
  yield* agent.handleAuthenticate((request) =>
    Effect.sync(() => {
      appendRequestLog({ method: "authenticate", methodId: request.methodId });
      return {};
    }),
  );
  yield* agent.handleCreateSession(() =>
    Effect.succeed({
      sessionId,
      configOptions: configOptions(),
      modes: modeState(),
    }),
  );
  yield* agent.handleLoadSession(() =>
    Effect.succeed({
      configOptions: configOptions(),
      modes: modeState(),
    }),
  );
  yield* agent.handleSetSessionConfigOption((request) =>
    Effect.gen(function* () {
      appendRequestLog({
        method: "session/set_config_option",
        configId: request.configId,
        value: request.value,
      });
      if (typeof request.value === "boolean") {
        return yield* AcpError.AcpRequestError.invalidParams(
          `Unsupported boolean ACP config option: ${request.configId}`,
        );
      }
      if (request.configId === "model") {
        currentModelId = request.value;
      }
      if (request.configId === "thinking") {
        currentThinking = request.value;
      }
      if (request.configId === "mode") {
        currentModeId = request.value;
      }
      return { configOptions: configOptions() };
    }),
  );
  yield* agent.handleCancel(() => Effect.void);
  yield* agent.handlePrompt(() => Effect.succeed({ stopReason: "end_turn" as const }));
  return yield* Effect.never;
}).pipe(
  Effect.provide(EffectAcpAgent.layerStdio()),
  Effect.scoped,
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
