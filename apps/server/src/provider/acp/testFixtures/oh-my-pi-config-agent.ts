#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import type * as AcpSchema from "effect-acp/compat";
import { makeV1FixtureAgent } from "./v1FixtureAgent.ts";

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

const agent = makeV1FixtureAgent();
agent.handle("initialize", () => ({
  protocolVersion: 1,
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
}));
agent.handle("authenticate", (request) => {
  appendRequestLog({ method: "authenticate", methodId: request.methodId });
  return {};
});
agent.handle("session/new", () => ({
  sessionId,
  configOptions: configOptions(),
  modes: modeState(),
}));
agent.handle("session/load", () => ({ configOptions: configOptions(), modes: modeState() }));
agent.handle("session/set_config_option", (request) => {
  appendRequestLog({
    method: "session/set_config_option",
    configId: request.configId,
    value: request.value,
  });
  if (typeof request.value !== "string")
    throw new Error(`Unsupported ACP config option: ${request.configId}`);
  if (request.configId === "model") currentModelId = request.value;
  if (request.configId === "thinking") currentThinking = request.value;
  if (request.configId === "mode") currentModeId = request.value;
  return { configOptions: configOptions() };
});
agent.handle("session/cancel", () => ({}));
agent.handle("session/prompt", () => ({ stopReason: "end_turn" }));
agent.start();
