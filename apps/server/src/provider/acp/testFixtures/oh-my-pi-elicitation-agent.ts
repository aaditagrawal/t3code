#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as EffectAcpAgent from "effect-acp/agent";

const sessionId = "oh-my-pi-elicitation-session";
const responsePath = process.env.T3_OH_MY_PI_ELICITATION_RESPONSE_PATH;
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
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

const program = Effect.gen(function* () {
  const agent = yield* EffectAcpAgent.AcpAgent;
  yield* agent.handleInitialize((request) =>
    Effect.sync(() => ({
      protocolVersion: 1 as const,
      agentCapabilities: { loadSession: true },
      agentInfo: {
        name: "Oh My Pi test agent",
        version: request.clientCapabilities?.elicitation?.form ? "18.0.3" : "missing-form",
      },
    })),
  );
  yield* agent.handleCreateSession(() => Effect.succeed({ sessionId, configOptions }));
  yield* agent.handleLoadSession(() => Effect.succeed({ configOptions }));
  yield* agent.handleSetSessionConfigOption(() => Effect.succeed({ configOptions }));
  yield* agent.handleCancel(() => Effect.void);
  yield* agent.handlePrompt(() =>
    agent.client
      .extRequest("elicitation/create", {
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
      })
      .pipe(
        Effect.tap((response) =>
          responsePath
            ? Effect.sync(() => NodeFS.writeFileSync(responsePath, encodeUnknownJson(response)))
            : Effect.void,
        ),
        Effect.as({ stopReason: "end_turn" as const }),
      ),
  );
  return yield* Effect.never;
}).pipe(
  Effect.provide(EffectAcpAgent.layerStdio()),
  Effect.scoped,
  Effect.provide(NodeServices.layer),
);

NodeRuntime.runMain(program);
