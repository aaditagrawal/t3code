import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { HostProcessExecutablePath } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

it.effect("loads the Copilot SDK with native Node ESM resolution", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const executable = yield* HostProcessExecutablePath;
    const cwd = yield* path.fromFileUrl(new URL("../../", import.meta.url));
    // A transformed Vitest import accepts extensionless dependencies that Node
    // rejects when the real provider dynamically imports this package.
    const output = yield* spawner.string(
      ChildProcess.make(
        executable,
        [
          "--input-type=module",
          "-e",
          'import { CopilotClient } from "@github/copilot-sdk"; if (typeof CopilotClient !== "function") throw new Error("Missing CopilotClient"); process.stdout.write("copilot-sdk-loaded");',
        ],
        { cwd },
      ),
    );
    expect(output).toBe("copilot-sdk-loaded");
  }).pipe(Effect.provide(NodeServices.layer)),
);
