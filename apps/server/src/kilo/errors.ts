import type { EventSessionError } from "./types.ts";

/**
 * Maps an Kilo error name to a runtime error class used by the
 * orchestration layer to categorize errors for display.
 */
export function sessionErrorClass(
  errorName: string | undefined,
): "provider_error" | "transport_error" | "permission_error" | "validation_error" | "unknown" {
  switch (errorName) {
    case "ProviderAuthError":
      return "permission_error";
    case "APIError":
    case "ContextOverflowError":
    case "MessageOutputLengthError":
    case "StructuredOutputError":
      return "provider_error";
    case "MessageAbortedError":
      return "transport_error";
    case "UnknownError":
    default:
      return "unknown";
  }
}

/**
 * Returns a human-readable label for the Kilo error name.
 */
export function sessionErrorLabel(errorName: string): string {
  switch (errorName) {
    case "ProviderAuthError":
      return "Authentication failed";
    case "UnknownError":
      return "Unknown error";
    case "MessageAbortedError":
      return "Message aborted";
    case "StructuredOutputError":
      return "Structured output error";
    case "ContextOverflowError":
      return "Context window exceeded";
    case "APIError":
      return "API error";
    case "MessageOutputLengthError":
      return "Response exceeded output length";
    default:
      return errorName;
  }
}

/**
 * Returns whether an Kilo error is retryable, if the information is
 * available (currently only `APIError` carries `isRetryable`).
 */
export function sessionErrorIsRetryable(
  error: EventSessionError["properties"]["error"],
): boolean | undefined {
  if (!error) {
    return undefined;
  }
  if (error.name === "APIError") {
    const data = error.data as Record<string, unknown> | undefined;
    return typeof data?.isRetryable === "boolean" ? data.isRetryable : undefined;
  }
  return undefined;
}

/**
 * Extracts a human-readable error message from an Kilo `session.error`
 * event, combining the error label with any detail from the payload.
 *
 * Each Kilo error type has a specific `data` shape (from the SDK):
 *  - ProviderAuthError:      { providerID, message }
 *  - UnknownError:           { message }
 *  - MessageAbortedError:    { message }
 *  - StructuredOutputError:  { message, retries }
 *  - ContextOverflowError:   { message, responseBody? }
 *  - APIError:               { message, statusCode?, isRetryable, responseHeaders?, responseBody?, metadata? }
 *  - MessageOutputLengthError: { [key: string]: unknown }
 */
export function sessionErrorMessage(
  error: EventSessionError["properties"]["error"],
): string | undefined {
  if (!error) {
    return undefined;
  }

  const data = error.data as Record<string, unknown> | undefined;
  const label = sessionErrorLabel(error.name);
  const detail = typeof data?.message === "string" ? data.message : undefined;

  switch (error.name) {
    case "ProviderAuthError": {
      const providerID = typeof data?.providerID === "string" ? data.providerID : undefined;
      const prefix = providerID ? `${label} (${providerID})` : label;
      return detail ? `${prefix}: ${detail}` : prefix;
    }
    case "APIError": {
      const statusCode = typeof data?.statusCode === "number" ? data.statusCode : undefined;
      const prefix = statusCode ? `${label} ${statusCode}` : label;
      return detail ? `${prefix}: ${detail}` : prefix;
    }
    case "StructuredOutputError": {
      const retries = typeof data?.retries === "number" ? data.retries : undefined;
      const suffix = retries != null ? ` (after ${retries} retries)` : "";
      return detail ? `${label}: ${detail}${suffix}` : `${label}${suffix}`;
    }
    default: {
      return detail ? `${label}: ${detail}` : label;
    }
  }
}
