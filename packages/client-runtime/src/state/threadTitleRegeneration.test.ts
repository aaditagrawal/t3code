import { describe, expect, it } from "vite-plus/test";

import { CommandId } from "@t3tools/contracts";

import {
  collectTitleRegenerationFailures,
  isTitleRegenerationPending,
  titleRegenerationError,
  type ThreadTitleRegenerationHolder,
} from "./threadTitleRegeneration.ts";

const pending = (requestId: string): ThreadTitleRegenerationHolder => ({
  titleRegeneration: {
    requestId: CommandId.make(requestId),
    startedAt: "2026-01-01T00:00:00.000Z",
  },
});

const failed = (requestId: string, error: string): ThreadTitleRegenerationHolder => ({
  titleRegeneration: {
    requestId: CommandId.make(requestId),
    startedAt: "2026-01-01T00:00:00.000Z",
    error,
  },
});

describe("isTitleRegenerationPending", () => {
  it("is pending only while no failure is recorded", () => {
    expect(isTitleRegenerationPending(pending("req-1"))).toBe(true);
    expect(isTitleRegenerationPending(failed("req-1", "nope"))).toBe(false);
    expect(isTitleRegenerationPending({ titleRegeneration: null })).toBe(false);
    expect(isTitleRegenerationPending({})).toBe(false);
  });
});

describe("titleRegenerationError", () => {
  it("returns the recorded failure reason", () => {
    expect(titleRegenerationError(failed("req-1", "provider offline"))).toBe("provider offline");
    expect(titleRegenerationError(pending("req-1"))).toBeNull();
    expect(titleRegenerationError({})).toBeNull();
  });
});

describe("collectTitleRegenerationFailures", () => {
  const keyOf = (thread: { id: string }) => thread.id;

  it("reports a failure that appears after the thread was already observed", () => {
    const seen = new Map<string, string | null>();
    expect(
      collectTitleRegenerationFailures([{ id: "a", ...pending("req-1") }], keyOf, seen),
    ).toEqual([]);

    expect(
      collectTitleRegenerationFailures(
        [{ id: "a", ...failed("req-1", "provider offline") }],
        keyOf,
        seen,
      ),
    ).toEqual([{ key: "a", requestId: "req-1", error: "provider offline" }]);
  });

  it("stays quiet for a failure that is already present on first observation", () => {
    const seen = new Map<string, string | null>();
    expect(
      collectTitleRegenerationFailures(
        [{ id: "a", ...failed("req-1", "provider offline") }],
        keyOf,
        seen,
      ),
    ).toEqual([]);
  });

  it("does not repeat the same failure on later observations", () => {
    const seen = new Map<string, string | null>();
    collectTitleRegenerationFailures([{ id: "a", ...pending("req-1") }], keyOf, seen);
    collectTitleRegenerationFailures([{ id: "a", ...failed("req-1", "boom") }], keyOf, seen);
    expect(
      collectTitleRegenerationFailures([{ id: "a", ...failed("req-1", "boom") }], keyOf, seen),
    ).toEqual([]);
  });

  it("reports a second failure because each request carries its own id", () => {
    const seen = new Map<string, string | null>();
    collectTitleRegenerationFailures([{ id: "a", ...pending("req-1") }], keyOf, seen);
    collectTitleRegenerationFailures([{ id: "a", ...failed("req-1", "boom") }], keyOf, seen);
    collectTitleRegenerationFailures([{ id: "a", ...pending("req-2") }], keyOf, seen);
    expect(
      collectTitleRegenerationFailures(
        [{ id: "a", ...failed("req-2", "boom again") }],
        keyOf,
        seen,
      ),
    ).toEqual([{ key: "a", requestId: "req-2", error: "boom again" }]);
  });

  it("forgets threads that leave the set", () => {
    const seen = new Map<string, string | null>();
    collectTitleRegenerationFailures([{ id: "a", ...pending("req-1") }], keyOf, seen);
    collectTitleRegenerationFailures([], keyOf, seen);
    expect(seen.size).toBe(0);
  });
});
