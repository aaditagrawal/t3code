import { describe, expect, it } from "@effect/vitest";

import { __testing } from "./StandardAcpCliProvider.ts";

describe("standard ACP CLI provider errors", () => {
  it("classifies platform not-found spawn errors as missing commands", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpSpawnError",
        cause: { _tag: "PlatformError", reason: { _tag: "NotFound" } },
      }),
    ).toBe(true);
  });

  it("classifies raw ENOENT spawn errors as missing commands", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpSpawnError",
        cause: { code: "ENOENT" },
      }),
    ).toBe(true);
  });

  it("keeps permission-denied spawn errors on the startup-failure path", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpSpawnError",
        cause: { _tag: "PlatformError", reason: { _tag: "PermissionDenied" } },
      }),
    ).toBe(false);
  });

  it("does not treat unrelated not-found errors as missing commands", () => {
    expect(
      __testing.hasMissingCommandCause({
        _tag: "AcpRequestError",
        cause: { _tag: "PlatformError", reason: { _tag: "NotFound" } },
      }),
    ).toBe(false);
  });
});
