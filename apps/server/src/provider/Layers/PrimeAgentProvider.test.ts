import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { PrimeAgentSettings } from "@t3tools/contracts";

import {
  buildInitialPrimeAgentProviderSnapshot,
  checkPrimeAgentProviderStatus,
} from "./PrimeAgentProvider.ts";

const decodePrimeAgentSettings = Schema.decodeSync(PrimeAgentSettings);

describe("buildInitialPrimeAgentProviderSnapshot", () => {
  it.effect("returns a disabled snapshot when settings.enabled is false", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPrimeAgentProviderSnapshot(
        decodePrimeAgentSettings({ enabled: false }),
      );
      expect(snapshot.enabled).toBe(false);
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );

  it.effect("returns a pending snapshot by default", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPrimeAgentProviderSnapshot(decodePrimeAgentSettings({}));
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("warning");
      expect(snapshot.version).toBeNull();
      expect(snapshot.message).toContain("Checking Prime Agent");
      expect(snapshot.requiresNewThreadForModelChange).toBe(true);
    }),
  );

  it.effect("surfaces custom model slugs", () =>
    Effect.gen(function* () {
      const snapshot = yield* buildInitialPrimeAgentProviderSnapshot(
        decodePrimeAgentSettings({ customModels: ["claude-sonnet-4-20250514"] }),
      );
      expect(snapshot.models.map((model) => model.slug)).toEqual(["claude-sonnet-4-20250514"]);
      expect(snapshot.models.every((model) => model.isCustom)).toBe(true);
    }),
  );
});

it.layer(NodeServices.layer)("checkPrimeAgentProviderStatus", (it) => {
  it.effect("reports the binary as missing when the binary path does not resolve", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPrimeAgentProviderStatus(
        decodePrimeAgentSettings({
          enabled: true,
          binaryPath: "/definitely/not/installed/prime-agent-binary",
        }),
      );
      expect(snapshot.enabled).toBe(true);
      expect(snapshot.installed).toBe(false);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toMatch(/not installed|not on PATH/);
    }),
  );

  it.effect("reports an installed CLI as unhealthy when --version exits non-zero", () =>
    Effect.gen(function* () {
      const secretStderr = "broken prime-agent install: secret-token-value";
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-prime-agent-version-" });
          const binaryPath = path.join(dir, "prime-agent");
          yield* fs.writeFileString(
            binaryPath,
            ["#!/bin/sh", `printf "%s\\n" "${secretStderr}" >&2`, "exit 2", ""].join("\n"),
          );
          yield* fs.chmod(binaryPath, 0o755);

          return yield* checkPrimeAgentProviderStatus(
            decodePrimeAgentSettings({ enabled: true, binaryPath }),
          );
        }),
      );

      expect(snapshot.enabled).toBe(true);
      // Installed-but-erroring must not be reported as missing.
      expect(snapshot.installed).toBe(true);
      expect(snapshot.status).toBe("error");
      expect(snapshot.message).toBe("Prime Agent CLI is installed but failed to run.");
      expect(snapshot.message).not.toContain(secretStderr);
    }),
  );

  it.effect("parses the bare semver line printed by `prime-agent --version`", () =>
    Effect.gen(function* () {
      const snapshot = yield* Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-prime-agent-ready-" });
          const binaryPath = path.join(dir, "prime-agent");
          yield* fs.writeFileString(
            binaryPath,
            ["#!/bin/sh", 'printf "0.7.0\\n"', "exit 0", ""].join("\n"),
          );
          yield* fs.chmod(binaryPath, 0o755);

          return yield* checkPrimeAgentProviderStatus(
            decodePrimeAgentSettings({
              enabled: true,
              binaryPath,
              customModels: ["claude-sonnet-4-20250514"],
            }),
          );
        }),
      );

      expect(snapshot.status).toBe("ready");
      expect(snapshot.installed).toBe(true);
      expect(snapshot.version).toBe("0.7.0");
      expect(snapshot.message).toContain("0.7.0");
      expect(snapshot.models.map((model) => model.slug)).toEqual(["claude-sonnet-4-20250514"]);
    }),
  );

  it.effect("returns a disabled snapshot without probing when disabled", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkPrimeAgentProviderStatus(
        decodePrimeAgentSettings({
          enabled: false,
          binaryPath: "/definitely/not/installed/prime-agent-binary",
        }),
      );
      expect(snapshot.status).toBe("disabled");
      expect(snapshot.installed).toBe(false);
      expect(snapshot.message).toContain("disabled");
    }),
  );
});
