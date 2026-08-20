import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { discoverHermesSkills, resolveHermesHomePath } from "./HermesSkills.ts";

const writeSkill = Effect.fn(function* (
  root: string,
  directory: string,
  frontmatter: ReadonlyArray<string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDirectory = path.join(root, directory);
  yield* fileSystem.makeDirectory(skillDirectory, { recursive: true });
  yield* fileSystem.writeFileString(
    path.join(skillDirectory, "SKILL.md"),
    ["---", ...frontmatter, "---", "", "# Skill"].join("\n"),
  );
});

it.layer(NodeServices.layer)("discoverHermesSkills", (it) => {
  it.effect("reads active user skills from HERMES_HOME", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-hermes-skills-" });
      yield* writeSkill(path.join(home, "skills"), "deploy", [
        "name: deploy",
        "description: Deploy the app.",
      ]);

      const skills = yield* discoverHermesSkills({ HERMES_HOME: home });

      assert.deepEqual(skills, [
        {
          name: "deploy",
          description: "Deploy the app.",
          path: path.join(home, "skills", "deploy", "SKILL.md"),
          enabled: true,
          scope: "user",
        },
      ]);
    }),
  );

  it.effect("uses Hermes exclusions, support directories, and active org gating", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-hermes-skills-" });
      const root = path.join(home, "skills");
      yield* writeSkill(root, "main", ["name: main"]);
      yield* writeSkill(root, "main/references/archive", ["name: archived"]);
      yield* writeSkill(root, "node_modules/package", ["name: dependency"]);
      yield* writeSkill(root, "_org/active/shared", ["name: active-org"]);
      yield* writeSkill(root, "_org/stale/shared", ["name: stale-org"]);
      yield* fileSystem.writeFileString(path.join(root, "_org", ".active_org"), "active\n");

      const skills = yield* discoverHermesSkills({ HERMES_HOME: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["active-org", "main"],
      );
    }),
  );

  it.effect("applies disabled, platform, and environment filters", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const hostPlatform = yield* HostProcessPlatform;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-hermes-skills-" });
      const root = path.join(home, "skills");
      yield* writeSkill(root, "disabled", ["name: disabled"]);
      yield* writeSkill(root, "wrong-platform", [
        "name: wrong-platform",
        `platforms: [${hostPlatform === "win32" ? "linux" : "windows"}]`,
      ]);
      yield* writeSkill(root, "kanban", ["name: kanban", "environments: [kanban]"]);
      yield* writeSkill(root, "unknown", ["name: unknown", "environments: [future-runtime]"]);
      yield* fileSystem.writeFileString(
        path.join(home, "config.yaml"),
        ["skills:", "  disabled: [disabled]"].join("\n"),
      );

      const skills = yield* discoverHermesSkills({ HERMES_HOME: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["unknown"],
      );
    }),
  );

  it.effect("reads external skill directories after the local directory", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-hermes-skills-" });
      const home = path.join(temp, "home");
      const external = path.join(temp, "external");
      yield* writeSkill(path.join(home, "skills"), "local", ["name: shared"]);
      yield* writeSkill(external, "external", ["name: external"]);
      yield* writeSkill(external, "duplicate", ["name: shared"]);
      yield* fileSystem.makeDirectory(home, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(home, "config.yaml"),
        ["skills:", `  external_dirs: ['${external.replaceAll("'", "''")}']`].join("\n"),
      );

      const skills = yield* discoverHermesSkills({ HERMES_HOME: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["external", "shared"],
      );
      assert.equal(
        skills.find((skill) => skill.name === "shared")?.path,
        path.join(home, "skills", "local", "SKILL.md"),
      );
    }),
  );
});

it.layer(NodeServices.layer)("resolveHermesHomePath", (it) => {
  it.effect("uses HERMES_HOME without shell expansion", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resolved = yield* resolveHermesHomePath({ HERMES_HOME: "~/.custom-hermes" });
      assert.equal(resolved, path.resolve("~/.custom-hermes"));
    }),
  );
});
