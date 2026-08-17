/**
 * Live {@link HermesEnrollmentStore}. See the service module for the token
 * rules this upholds.
 *
 * @module Layers/HermesEnrollmentStore
 */
import { HermesGatewayEnrollmentToken, type ProviderInstanceId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Ref from "effect/Ref";

import type {
  HermesEnrollmentStore,
  PendingEnrollment,
} from "../Services/HermesEnrollmentStore.ts";

const ENROLLMENT_TOKEN_BYTES = 32;

export interface MakeHermesEnrollmentStoreOptions {
  readonly ttl: Duration.Duration;
}

export const makeHermesEnrollmentStore = (
  options: MakeHermesEnrollmentStoreOptions,
): Effect.Effect<HermesEnrollmentStore, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const enrollments = yield* Ref.make(new Map<string, PendingEnrollment>());

    const mint: HermesEnrollmentStore["mint"] = (input) =>
      Effect.gen(function* () {
        const bytes = yield* crypto.randomBytes(ENROLLMENT_TOKEN_BYTES).pipe(Effect.orDie);
        const token = HermesGatewayEnrollmentToken.make(Encoding.encodeBase64Url(bytes));
        const expiresAtMillis = (yield* Clock.currentTimeMillis) + Duration.toMillis(options.ttl);

        yield* Ref.update(enrollments, (current) => {
          const next = new Map(current);
          // Minting supersedes this instance's previous tokens so only the
          // newest unconsumed token is redeemable.
          for (const [pendingToken, pending] of current) {
            if (pending.input.instanceId === input.instanceId) next.delete(pendingToken);
          }
          return next.set(token, { input, expiresAtMillis });
        });

        return { token, expiresAtMillis };
      });

    const peek: HermesEnrollmentStore["peek"] = (token) =>
      Effect.gen(function* () {
        const found = (yield* Ref.get(enrollments)).get(token);
        if (!found) return undefined;
        return found.expiresAtMillis < (yield* Clock.currentTimeMillis) ? undefined : found;
      });

    const consume: HermesEnrollmentStore["consume"] = (token, expected) =>
      Effect.gen(function* () {
        // Compare-and-swap: delete only if the entry is still the exact object
        // the caller authenticated against, so a concurrent redemption or a
        // re-mint in between cannot be consumed by this caller.
        const claimed = yield* Ref.modify(enrollments, (current) => {
          const found = current.get(token);
          if (found !== expected) return [undefined, current] as const;
          const next = new Map(current);
          next.delete(token);
          return [found, next] as const;
        });
        if (claimed === undefined) return undefined;
        // Re-check expiry after winning the swap: the entry may have aged out
        // between authentication and consumption.
        return claimed.expiresAtMillis < (yield* Clock.currentTimeMillis) ? undefined : claimed;
      });

    const forget = (instanceId: ProviderInstanceId) =>
      Ref.update(enrollments, (current) => {
        const next = new Map(current);
        for (const [token, pending] of current) {
          if (pending.input.instanceId === instanceId) next.delete(token);
        }
        return next;
      });

    const sweep = Clock.currentTimeMillis.pipe(
      Effect.flatMap((now) =>
        Ref.update(enrollments, (current) => {
          const next = new Map(current);
          for (const [token, pending] of current) {
            if (pending.expiresAtMillis < now) next.delete(token);
          }
          return next.size === current.size ? current : next;
        }),
      ),
    );

    return {
      mint,
      peek,
      consume,
      forget,
      sweep,
      size: Ref.get(enrollments).pipe(Effect.map((current) => current.size)),
    } satisfies HermesEnrollmentStore;
  });
