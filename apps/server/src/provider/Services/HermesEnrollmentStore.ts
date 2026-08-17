/**
 * HermesEnrollmentStore — the mint/consume/expire lifecycle of one-time
 * enrollment tokens.
 *
 * Separated from the broker so the token rules live in one place:
 *
 *   - A token is redeemable exactly once. Consumption is compare-and-swap:
 *     the entry is deleted only if it is still byte-identical to the one the
 *     caller authenticated against, and expiry is re-checked afterwards, so
 *     two concurrent redemptions cannot both win.
 *   - Minting a token for an instance invalidates that instance's previous
 *     tokens, so only the newest unconsumed token is ever redeemable.
 *   - Tokens expire from memory on a sweep, not only lazily at redemption.
 *     Redemption-time expiry alone let any operator-scoped client grow the
 *     map without bound by calling createEnrollment in a loop.
 *
 * @module HermesEnrollmentStore
 */
import type {
  HermesGatewayCreateEnrollmentInput,
  HermesGatewayEnrollmentToken,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

export interface PendingEnrollment {
  readonly input: HermesGatewayCreateEnrollmentInput;
  readonly expiresAtMillis: number;
}

export interface HermesEnrollmentStore {
  /**
   * Mint a token for `input`, invalidating any prior unconsumed token for the
   * same instance. Returns the token and its absolute expiry.
   */
  readonly mint: (
    input: HermesGatewayCreateEnrollmentInput,
  ) => Effect.Effect<
    { readonly token: HermesGatewayEnrollmentToken; readonly expiresAtMillis: number },
    never
  >;

  /**
   * Look up a token without consuming it. Returns `undefined` when the token
   * is unknown or already expired — the caller authenticates against this
   * value and later passes it back to `consume`.
   */
  readonly peek: (token: string) => Effect.Effect<PendingEnrollment | undefined>;

  /**
   * Compare-and-swap consumption. Deletes the entry only if it is still
   * identical to `expected`, then re-checks expiry. Returns the consumed
   * enrollment, or `undefined` if it was raced away or expired in between.
   */
  readonly consume: (
    token: string,
    expected: PendingEnrollment,
  ) => Effect.Effect<PendingEnrollment | undefined>;

  /** Drop every unconsumed token belonging to `instanceId`. */
  readonly forget: (instanceId: ProviderInstanceId) => Effect.Effect<void>;

  /** Drop every expired token. Run periodically; bounds memory. */
  readonly sweep: Effect.Effect<void>;

  /** Number of unconsumed tokens. Exposed for tests and diagnostics. */
  readonly size: Effect.Effect<number>;
}
