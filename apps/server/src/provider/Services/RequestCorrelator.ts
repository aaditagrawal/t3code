/**
 * Generic request/response correlation for providers with request IDs.
 *
 * The correlator owns interrupt-safe cleanup, timeout handling, stale-entry
 * sweeping, and failing every pending request for a disconnected owner.
 */
import type * as Duration from "effect/Duration";
import type * as Effect from "effect/Effect";

import type { ProviderAdapterRequestError } from "../Errors.ts";

export interface RequestCorrelatorSend<Owner> {
  readonly owner: Owner;
  readonly requestId: string;
  readonly method: string;
  readonly send: Effect.Effect<void, ProviderAdapterRequestError>;
  readonly timeout?: Duration.Duration | undefined;
}

export interface RequestCorrelator<Owner, Response> {
  readonly request: (
    input: RequestCorrelatorSend<Owner>,
  ) => Effect.Effect<Response, ProviderAdapterRequestError>;
  /** Complete only when the response arrived over the request's exact owner. */
  readonly complete: (
    owner: Owner,
    requestId: string,
    response: Response,
  ) => Effect.Effect<boolean>;
  readonly failOwner: (owner: Owner, detail: string) => Effect.Effect<void>;
  readonly sweep: Effect.Effect<void>;
  readonly pendingCount: Effect.Effect<number>;
}
