import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { makeOhMyPiProbeArgs } from "./OhMyPiDriver.ts";

it.layer(NodeServices.layer)("OhMyPi provider probe", (it) => {
  it.effect("uses a scoped session directory without changing runtime argv", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      let capturedSessionDir: string | undefined;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const args = yield* makeOhMyPiProbeArgs(["acp"]);
          assert.equal(args[0], "acp");
          assert.equal(args[1], "--session-dir");
          assert.notInclude(args, "--yolo");
          capturedSessionDir = args[2];
          if (capturedSessionDir === undefined) {
            throw new Error("missing scoped OhMyPi probe session directory");
          }
          assert.isTrue(yield* fileSystem.exists(capturedSessionDir));
        }),
      );
      if (capturedSessionDir === undefined) {
        throw new Error("missing captured OhMyPi probe session directory");
      }
      assert.isFalse(yield* fileSystem.exists(capturedSessionDir));
    }),
  );
});
