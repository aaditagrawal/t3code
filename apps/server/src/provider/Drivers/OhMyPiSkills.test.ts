import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { discoverOhMyPiSkills, resolveOhMyPiHomePath } from "./OhMyPiSkills.ts";

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

it.layer(NodeServices.layer)("discoverOhMyPiSkills", (it) => {
  it.effect("reads user skills from PI_CODING_AGENT_DIR/skills", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
      yield* writeSkill(path.join(home, "skills"), "deploy", [
        "name: deploy",
        "description: Deploy the app.",
      ]);

      const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: home });

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

  it.effect("reads native omp skills from agent/skills under the home", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
      yield* writeSkill(path.join(home, "agent", "skills"), "review", [
        "name: review",
        "description: Review the change.",
      ]);

      const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: home });

      assert.deepEqual(skills, [
        {
          name: "review",
          description: "Review the change.",
          path: path.join(home, "agent", "skills", "review", "SKILL.md"),
          enabled: true,
          scope: "user",
        },
      ]);
    }),
  );

  it.effect("prefers agent/skills when the same name exists under skills/", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
      yield* writeSkill(path.join(home, "agent", "skills"), "shared", ["name: shared"]);
      yield* writeSkill(path.join(home, "skills"), "shared-copy", ["name: shared"]);

      const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: home });

      assert.deepEqual(
        skills.map((skill) => skill.path),
        [path.join(home, "agent", "skills", "shared", "SKILL.md")],
      );
    }),
  );

  it.effect("uses exclusions, support directories, and active org gating", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
      const root = path.join(home, "skills");
      yield* writeSkill(root, "main", ["name: main"]);
      yield* writeSkill(root, "main/references/archive", ["name: archived"]);
      yield* writeSkill(root, "node_modules/package", ["name: dependency"]);
      yield* writeSkill(root, "_org/active/shared", ["name: active-org"]);
      yield* writeSkill(root, "_org/stale/shared", ["name: stale-org"]);
      yield* fileSystem.writeFileString(path.join(root, "_org", ".active_org"), "active\n");

      const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: home });

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
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
      const root = path.join(home, "skills");
      yield* writeSkill(root, "disabled", ["name: disabled"]);
      yield* writeSkill(root, "wrong-platform", [
        "name: wrong-platform",
        `platforms: [${hostPlatform === "win32" ? "linux" : "windows"}]`,
      ]);
      yield* writeSkill(root, "s6-only", ["name: s6-only", "environments: [s6]"]);
      yield* writeSkill(root, "unknown", ["name: unknown", "environments: [future-runtime]"]);
      yield* fileSystem.writeFileString(
        path.join(home, "config.yaml"),
        ["skills:", "  disabled: [disabled]"].join("\n"),
      );

      const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["unknown"],
      );
    }),
  );

  it.effect("reads config.yml when config.yaml is absent", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
      yield* writeSkill(path.join(home, "skills"), "kept", ["name: kept"]);
      yield* writeSkill(path.join(home, "skills"), "hidden", ["name: hidden"]);
      yield* fileSystem.writeFileString(
        path.join(home, "config.yml"),
        ["skills:", "  disabled: [hidden]"].join("\n"),
      );

      const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: home });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["kept"],
      );
    }),
  );

  it.effect("reads external skill directories after the local directories", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const temp = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
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

      const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: home });

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

  it.effect("uses PI_CONFIG_DIR and OMP_PROFILE when PI_CODING_AGENT_DIR is unset", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
      const profileHome = path.join(root, "profiles", "work");
      yield* writeSkill(path.join(profileHome, "agent", "skills"), "profiled", ["name: profiled"]);

      const skills = yield* discoverOhMyPiSkills({
        PI_CONFIG_DIR: root,
        OMP_PROFILE: "work",
      });

      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["profiled"],
      );
    }),
  );
});

it.layer(NodeServices.layer)("resolveOhMyPiHomePath", (it) => {
  it.effect("defaults to ~/.omp", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resolved = yield* resolveOhMyPiHomePath({});
      assert.equal(resolved, path.join(NodeOS.homedir(), ".omp"));
    }),
  );

  it.effect("uses PI_CODING_AGENT_DIR without shell expansion", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resolved = yield* resolveOhMyPiHomePath({ PI_CODING_AGENT_DIR: "~/.custom-omp" });
      assert.equal(resolved, path.resolve("~/.custom-omp"));
    }),
  );

  it.effect("prefers PI_CODING_AGENT_DIR over PI_CONFIG_DIR and profile", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const resolved = yield* resolveOhMyPiHomePath({
        PI_CODING_AGENT_DIR: "/tmp/omp-agent",
        PI_CONFIG_DIR: "/tmp/ignored-omp",
        OMP_PROFILE: "work",
      });
      assert.equal(resolved, path.resolve("/tmp/omp-agent"));
    }),
  );
});
