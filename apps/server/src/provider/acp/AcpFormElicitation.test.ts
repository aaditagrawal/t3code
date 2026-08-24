import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import { ElicitationRequest as ElicitationRequestSchema } from "effect-acp/schema";

import {
  extractStandardAcpFormQuestions,
  makeStandardAcpFormAcceptedResponse,
  makeStandardAcpFormCancelledResponse,
  makeStandardAcpFormDeclinedResponse,
} from "./AcpFormElicitation.ts";

const decodeElicitationRequest = Schema.decodeUnknownSync(ElicitationRequestSchema);
const rawAskRequest = {
  mode: "form",
  sessionId: "omp-session",
  message: "Which approach?",
  requestedSchema: {
    type: "object",
    properties: {
      q0: {
        type: "string",
        title: "Which approach?",
        oneOf: [
          { const: "fast", title: "Fast" },
          { const: "safe", title: "Safe", description: "Run the extra checks" },
        ],
      },
      q0__other: { type: "string", title: "Other (type your own)" },
      confirmed: { type: "boolean", title: "Proceed?" },
    },
  },
};
const decodedAskRequest = decodeElicitationRequest(rawAskRequest);
if (decodedAskRequest.mode !== "form") {
  throw new TypeError("expected a form elicitation fixture");
}
const askRequest = decodedAskRequest;

describe("standard ACP form elicitation", () => {
  it("coalesces OhMyPi choice and custom-answer properties into T3 questions", () => {
    expect(extractStandardAcpFormQuestions(askRequest, rawAskRequest)).toEqual([
      {
        id: "q0",
        header: "Which approach?",
        question: "Which approach?",
        options: [
          { label: "Fast", description: "Fast" },
          { label: "Safe", description: "Run the extra checks" },
        ],
        multiSelect: false,
      },
      {
        id: "confirmed",
        header: "Proceed?",
        question: "Proceed?",
        options: [
          { label: "Yes", description: "Yes" },
          { label: "No", description: "No" },
        ],
        multiSelect: false,
      },
    ]);
  });

  it("returns typed accepted content and routes custom choices to the companion field", () => {
    expect(
      makeStandardAcpFormAcceptedResponse(askRequest, {
        q0: "custom approach",
        confirmed: "Yes",
      }),
    ).toEqual({
      action: {
        action: "accept",
        content: { q0__other: "custom approach", confirmed: true },
      },
    });
    expect(
      makeStandardAcpFormAcceptedResponse(askRequest, { q0: "Safe", confirmed: "No" }),
    ).toEqual({
      action: { action: "accept", content: { q0: "safe", confirmed: false } },
    });
  });

  it("keeps cancellation and decline as distinct ACP actions", () => {
    expect(makeStandardAcpFormCancelledResponse()).toEqual({ action: { action: "cancel" } });
    expect(makeStandardAcpFormDeclinedResponse()).toEqual({ action: { action: "decline" } });
  });

  it("declines URL forms by exposing no T3 questions", () => {
    expect(
      extractStandardAcpFormQuestions({
        mode: "url",
        sessionId: "omp-session",
        message: "Open login",
        elicitationId: "login",
        url: "https://example.com/login",
      }),
    ).toEqual([]);
  });

  it("uses the request message instead of a free-text placeholder", () => {
    expect(
      extractStandardAcpFormQuestions({
        mode: "form",
        sessionId: "omp-session",
        message: "What should I change?",
        requestedSchema: {
          type: "object",
          properties: {
            answer: { type: "string", description: "Type your answer" },
          },
        },
      }),
    ).toEqual([
      {
        id: "answer",
        header: "Question",
        question: "What should I change?",
        options: [],
        multiSelect: false,
      },
    ]);
  });

  it("keeps an ask-dialog description as the question header", () => {
    expect(
      extractStandardAcpFormQuestions({
        mode: "form",
        sessionId: "omp-session",
        message: "Choose an option",
        requestedSchema: {
          type: "object",
          properties: {
            answer: {
              type: "string",
              title: "Which approach?",
              description: "Implementation",
              enum: ["Fast", "Safe"],
            },
          },
        },
      }),
    ).toEqual([
      {
        id: "answer",
        header: "Implementation",
        question: "Which approach?",
        options: [
          { label: "Fast", description: "Fast" },
          { label: "Safe", description: "Safe" },
        ],
        multiSelect: false,
      },
    ]);
  });

  it("preserves descriptions on legacy multi-select options", () => {
    const rawRequest = {
      mode: "form",
      sessionId: "omp-session",
      message: "Choose checks",
      requestedSchema: {
        type: "object",
        properties: {
          checks: {
            type: "array",
            title: "Checks",
            items: {
              anyOf: [
                {
                  const: "tests",
                  title: "Tests",
                  description: "Run the focused test suite",
                },
              ],
            },
          },
        },
      },
    };

    expect(
      extractStandardAcpFormQuestions(decodeElicitationRequest(rawRequest), rawRequest)[0]?.options,
    ).toEqual([{ label: "Tests", description: "Run the focused test suite" }]);
  });
});
