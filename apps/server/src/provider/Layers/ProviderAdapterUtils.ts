/**
 * Shared utilities for provider adapter implementations.
 *
 * Centralises common error-mapping and type-narrowing helpers that were
 * previously duplicated across every adapter layer.
 *
 * @module ProviderAdapterUtils
 */

import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionClosedError,
  ProviderAdapterSessionNotFoundError,
  type ProviderAdapterError,
} from "../Errors.ts";

// Re-export toMessage so adapters can import everything from one place.
export { toMessage } from "../toMessage.ts";
import { toMessage } from "../toMessage.ts";

// ---------------------------------------------------------------------------
// Error mapping helpers (parameterised by provider name)
// ---------------------------------------------------------------------------

/**
 * Inspect `cause` and return a session-level error when the message matches
 * well-known "not found" / "closed" patterns for the given provider.
 *
 * Each provider historically checked for `"unknown <provider> session"` plus
 * the generic `"unknown session"` string.  Passing additional keywords via
 * `extraSessionNotFoundHints` allows per-provider customisation without code
 * duplication.
 */
export function toSessionError(
  provider: string,
  threadId: string,
  cause: unknown,
  options?: {
    readonly sessionNotFoundHints?: ReadonlyArray<string>;
    readonly sessionClosedHint?: string;
  },
): ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined {
  const normalized = toMessage(cause, "").toLowerCase();

  const notFoundHints: ReadonlyArray<string> = options?.sessionNotFoundHints ?? [
    `unknown ${provider} session`,
    "unknown session",
  ];

  if (notFoundHints.some((hint) => normalized.includes(hint))) {
    return new ProviderAdapterSessionNotFoundError({
      provider,
      threadId,
      cause,
    });
  }

  const closedHint = options?.sessionClosedHint ?? "closed";
  if (normalized.includes(closedHint)) {
    return new ProviderAdapterSessionClosedError({
      provider,
      threadId,
      cause,
    });
  }

  return undefined;
}

/**
 * Map an unknown `cause` into a typed `ProviderAdapterError`.
 *
 * Delegates to {@link toSessionError} first; falls back to a generic
 * {@link ProviderAdapterRequestError}.
 */
export function toRequestError(
  provider: string,
  threadId: string,
  method: string,
  cause: unknown,
  sessionErrorOptions?: Parameters<typeof toSessionError>[3],
): ProviderAdapterError {
  const sessionError = toSessionError(provider, threadId, cause, sessionErrorOptions);
  if (sessionError) {
    return sessionError;
  }
  return new ProviderAdapterRequestError({
    provider,
    method,
    detail: toMessage(cause, `${method} failed`),
    cause,
  });
}

// ---------------------------------------------------------------------------
// Factory: bind error helpers to a specific provider
// ---------------------------------------------------------------------------

export interface BoundErrorHelpers {
  readonly toSessionError: (
    threadId: string,
    cause: unknown,
  ) => ProviderAdapterSessionNotFoundError | ProviderAdapterSessionClosedError | undefined;
  readonly toRequestError: (
    threadId: string,
    method: string,
    cause: unknown,
  ) => ProviderAdapterError;
}

/**
 * Return `toSessionError` / `toRequestError` pre-bound to a specific provider
 * name so that call sites keep their original `(threadId, method, cause)`
 * signatures.
 */
export function makeErrorHelpers(
  provider: string,
  sessionErrorOptions?: Parameters<typeof toSessionError>[3],
): BoundErrorHelpers {
  return {
    toSessionError: (threadId, cause) =>
      toSessionError(provider, threadId, cause, sessionErrorOptions),
    toRequestError: (threadId, method, cause) =>
      toRequestError(provider, threadId, method, cause, sessionErrorOptions),
  };
}

// ---------------------------------------------------------------------------
// Type-narrowing helpers
// ---------------------------------------------------------------------------

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
