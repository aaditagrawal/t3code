#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import { makeV1FixtureAgent } from "./v1FixtureAgent.ts";

const sessionId = "oh-my-pi-elicitation-session";
const responsePath = process.env.T3_OH_MY_PI_ELICITATION_RESPONSE_PATH;
const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model" as const,
    type: "select" as const,
    currentValue: "default",
    options: [{ value: "default", name: "Auto" }],
  },
];

const agent = makeV1FixtureAgent();
agent.handle("initialize", () => ({
  protocolVersion: 1,
  agentCapabilities: { loadSession: true },
  agentInfo: { name: "Oh My Pi test agent", version: "18.0.3" },
}));
agent.handle("session/new", () => ({ sessionId, configOptions }));
agent.handle("session/load", () => ({ configOptions }));
agent.handle("session/set_config_option", () => ({ configOptions }));
agent.handle("session/cancel", () => ({}));
agent.handle("session/prompt", async () => {
  const response = await agent.request("elicitation/create", {
    mode: "form",
    sessionId,
    message: "Which approach?",
    requestedSchema: {
      type: "object",
      properties: {
        approach: {
          type: "string",
          title: "Which approach?",
          oneOf: [
            { const: "fast", title: "Fast", description: "Skip optional checks" },
            { const: "safe", title: "Safe", description: "Run the extra checks" },
          ],
        },
      },
      required: ["approach"],
    },
  });
  if (responsePath) NodeFS.writeFileSync(responsePath, JSON.stringify(response));
  return { stopReason: "end_turn" };
});
agent.start();
