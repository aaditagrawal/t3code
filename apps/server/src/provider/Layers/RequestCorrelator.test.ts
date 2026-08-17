import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { ProviderAdapterRequestError } from "../Errors.ts";
import { makeRequestCorrelator } from "./RequestCorrelator.ts";

const TIMEOUT = Duration.seconds(30);

const makeCorrelator = () =>
  makeRequestCorrelator<string, { readonly requestId: string }>({
    provider: "test",
    timeout: TIMEOUT,
    maxAge: Duration.seconds(90),
  });

const owner = "owner-a";

it.effect("resolves a correlated response and releases the pending entry", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const pending = yield* correlator
      .request({ owner, requestId: "r1", method: "test.method", send: Effect.void })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    assert.equal(yield* correlator.pendingCount, 1);

    assert.isTrue(yield* correlator.complete(owner, "r1", { requestId: "r1" }));
    assert.deepEqual(yield* Fiber.join(pending), { requestId: "r1" });
    assert.equal(yield* correlator.pendingCount, 0);
  }),
);

it.effect("refuses a response from a different owner without consuming the waiter", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const pending = yield* correlator
      .request({ owner, requestId: "r-fenced", method: "test.method", send: Effect.void })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;

    assert.isFalse(
      yield* correlator.complete("stale-owner", "r-fenced", { requestId: "r-fenced" }),
    );
    assert.equal(yield* correlator.pendingCount, 1);
    assert.isUndefined(pending.pollUnsafe());

    assert.isTrue(yield* correlator.complete(owner, "r-fenced", { requestId: "r-fenced" }));
    assert.deepEqual(yield* Fiber.join(pending), { requestId: "r-fenced" });
  }),
);

it.effect("rejects a duplicate request id without stranding the original waiter", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const first = yield* correlator
      .request({ owner, requestId: "r-duplicate", method: "first.method", send: Effect.void })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;

    const duplicate = yield* Effect.flip(
      correlator.request({
        owner: "owner-b",
        requestId: "r-duplicate",
        method: "second.method",
        send: Effect.void,
      }),
    );
    assert.include(duplicate.detail, "already pending");
    assert.equal(yield* correlator.pendingCount, 1);

    yield* correlator.complete(owner, "r-duplicate", { requestId: "r-duplicate" });
    assert.deepEqual(yield* Fiber.join(first), { requestId: "r-duplicate" });
    assert.equal(yield* correlator.pendingCount, 0);
    assert.isFalse(
      yield* correlator.complete(owner, "r-duplicate", { requestId: "r-duplicate" }),
      "a duplicate or late response must not revive a completed request",
    );
  }),
);

it.effect("releases the pending entry when the send fails", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const failure = yield* Effect.flip(
      correlator.request({
        owner,
        requestId: "r-send-fail",
        method: "test.method",
        send: Effect.fail(
          new ProviderAdapterRequestError({
            provider: "test",
            method: "test.method",
            detail: "the transport refused the write",
          }),
        ),
      }),
    );
    assert.include(failure.detail, "refused");
    assert.equal(yield* correlator.pendingCount, 0);
  }),
);

// The send used to sit outside `restore`, so a transport write that never
// returned could not be interrupted: `Fiber.interrupt` would hang forever
// waiting for the uninterruptible region to finish. The write is now inside the
// restored region, so an interrupt lands — and the entry is still released.
it.effect("interrupts a request whose transport write never returns", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const writeStarted = yield* Deferred.make<void>();
    const neverCompletes = yield* Deferred.make<void>();

    const pending = yield* correlator
      .request({
        owner,
        requestId: "r-stalled-write",
        method: "test.method",
        send: Deferred.succeed(writeStarted, undefined).pipe(
          Effect.andThen(Deferred.await(neverCompletes)),
        ),
      })
      .pipe(Effect.forkChild({ startImmediately: true }));

    yield* Deferred.await(writeStarted);
    assert.equal(yield* correlator.pendingCount, 1);

    // Would never return before the fix.
    yield* Fiber.interrupt(pending);
    assert.equal(
      yield* correlator.pendingCount,
      0,
      "an interrupted request must not leave a pending entry behind",
    );
  }),
);

// `Effect.timeout` only wrapped `Deferred.await`, so the clock did not start
// until the write returned: a request over a wedged socket outlived its own
// timeout for as long as the socket stayed wedged. The timeout now covers the
// send too.
it.effect("times out a request whose transport write stalls", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const writeStarted = yield* Deferred.make<void>();
    const neverCompletes = yield* Deferred.make<void>();

    const pending = yield* correlator
      .request({
        owner,
        requestId: "r-stalled-timeout",
        method: "test.method",
        send: Deferred.succeed(writeStarted, undefined).pipe(
          Effect.andThen(Deferred.await(neverCompletes)),
        ),
      })
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));

    yield* Deferred.await(writeStarted);
    yield* TestClock.adjust(Duration.seconds(31));

    const outcome = yield* Fiber.join(pending);
    assert.equal(outcome._tag, "Failure");
    if (outcome._tag === "Failure") assert.include(outcome.failure.detail, "timed out");
    assert.equal(yield* correlator.pendingCount, 0);
  }),
);

it.effect("sweeps an abandoned request after its maximum age", () =>
  Effect.gen(function* () {
    const correlator = yield* makeRequestCorrelator<string, { readonly requestId: string }>({
      provider: "test",
      timeout: Duration.minutes(5),
      maxAge: Duration.seconds(90),
    });
    const pending = yield* correlator
      .request({
        owner,
        requestId: "r-abandoned",
        method: "test.method",
        send: Effect.void,
      })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    assert.equal(yield* correlator.pendingCount, 1);

    yield* TestClock.adjust(Duration.seconds(91));
    yield* correlator.sweep;

    const failure = yield* Effect.flip(Fiber.join(pending));
    assert.include(failure.detail, "abandoned");
    assert.equal(yield* correlator.pendingCount, 0);
  }),
);

// A response can land the instant the write completes. Registration happens
// uninterruptibly before the send, so `complete` always finds an entry —
// moving the send inside `restore` must not have opened that window.
it.effect("completes a response that arrives from inside the transport write", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const pending = yield* correlator
      .request({
        owner,
        requestId: "r-immediate",
        method: "test.method",
        // The transport answers synchronously, before `send` even returns.
        send: correlator.complete(owner, "r-immediate", { requestId: "r-immediate" }).pipe(
          Effect.flatMap((completed) =>
            completed
              ? Effect.void
              : Effect.fail(
                  new ProviderAdapterRequestError({
                    provider: "test",
                    method: "test.method",
                    detail: "the response found no pending entry",
                  }),
                ),
          ),
        ),
      })
      .pipe(Effect.forkChild({ startImmediately: true }));

    assert.deepEqual(yield* Fiber.join(pending), { requestId: "r-immediate" });
    assert.equal(yield* correlator.pendingCount, 0);
  }),
);

it.effect("fails every request routed over a dead owner", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const first = yield* correlator
      .request({ owner, requestId: "r-own-1", method: "test.method", send: Effect.void })
      .pipe(Effect.forkChild({ startImmediately: true }));
    const second = yield* correlator
      .request({ owner, requestId: "r-own-2", method: "test.method", send: Effect.void })
      .pipe(Effect.forkChild({ startImmediately: true }));
    const other = yield* correlator
      .request({
        owner: "owner-b",
        requestId: "r-own-3",
        method: "test.method",
        send: Effect.void,
      })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;

    yield* correlator.failOwner(owner, "the connection dropped");
    assert.include((yield* Effect.flip(Fiber.join(first))).detail, "dropped");
    assert.include((yield* Effect.flip(Fiber.join(second))).detail, "dropped");
    assert.isUndefined(other.pollUnsafe(), "another owner's request must be untouched");

    yield* correlator.complete("owner-b", "r-own-3", { requestId: "r-own-3" });
    assert.deepEqual(yield* Fiber.join(other), { requestId: "r-own-3" });
  }),
);

it.effect("sweeps an abandoned request after its maximum age", () =>
  Effect.gen(function* () {
    const correlator = yield* makeCorrelator();
    const pending = yield* correlator
      .request({
        owner,
        requestId: "r-abandoned",
        method: "test.method",
        send: Effect.void,
        timeout: Duration.minutes(10),
      })
      .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    assert.equal(yield* correlator.pendingCount, 1);

    yield* TestClock.adjust(Duration.seconds(91));
    yield* correlator.sweep;

    const outcome = yield* Fiber.join(pending);
    assert.equal(outcome._tag, "Failure");
    if (outcome._tag === "Failure") assert.include(outcome.failure.detail, "abandoned");
    assert.equal(yield* correlator.pendingCount, 0);
  }),
);
