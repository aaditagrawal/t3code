import type * as EffectAcpSchema from "effect-acp/compat";
import { stableStringify } from "@t3tools/shared/relaySigning";

import { parsePermissionRequest } from "./AcpRuntimeModel.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Identity of a permission request that "always allow this session" can
 * replay. Commands and structured tool inputs match exactly; empty shell
 * prompts do not, so a later unrelated command still asks.
 */
export function standardAcpSessionApprovalKey(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  const parsed = parsePermissionRequest(request);
  const command = parsed.toolCall?.command;
  const { kind, title, rawInput, locations } = request.toolCall;
  let operationInput = rawInput;
  if (isRecord(rawInput) && rawInput.variant === "Bash") {
    const { description: _description, ...shellInput } = rawInput;
    operationInput = shellInput;
  }
  return command || (isRecord(rawInput) && Object.keys(rawInput).length > 0)
    ? stableStringify({ kind, title, command, input: operationInput, locations })
    : undefined;
}
