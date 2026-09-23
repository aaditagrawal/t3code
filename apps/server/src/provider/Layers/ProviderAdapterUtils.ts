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
function toRequestError(
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
