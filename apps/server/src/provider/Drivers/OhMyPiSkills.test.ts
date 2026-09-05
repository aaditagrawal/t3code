import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { discoverOhMyPiSkills, resolveOhMyPiHomePath } from "./OhMyPiSkills.ts";

const writeSkill = Effect.fn(function* (
  root: string,
  directory: string,
  frontmatter: ReadonlyArray<string> = [],
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDirectory = path.join(root, directory);
  yield* fs.makeDirectory(skillDirectory, { recursive: true });
  yield* fs.writeFileString(
    path.join(skillDirectory, "SKILL.md"),
    [
      "---",
      `name: ${path.basename(directory)}`,
      "description: A test skill.",
      ...frontmatter,
      "---",
      "# Skill",
    ].join("\n"),
  );
});

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "t3-oh-my-pi-skills-" });
  const agent = path.join(home, ".omp", "agent");
  const root = path.join(agent, "skills");
  yield* fs.makeDirectory(agent, { recursive: true });
  return { fs, path, home, agent, root, environment: { HOME: home } };
});

it.layer(NodeServices.layer)("discoverOhMyPiSkills", (it) => {
  it.effect("reads the native agent directory and ignores the config-root skills directory", () =>
    Effect.gen(function* () {
      const { path, home, root, environment } = yield* fixture;
      yield* writeSkill(root, "native");
      yield* writeSkill(path.join(home, ".omp", "skills"), "not-native");
      const skills = yield* discoverOhMyPiSkills(environment);
      assert.deepEqual(skills, [
        {
          name: "native",
          description: "A test skill.",
          path: path.join(root, "native", "SKILL.md"),
          enabled: true,
          scope: "user",
        },
      ]);
    }),
  );

  it.effect(
    "treats PI_CODING_AGENT_DIR as the agent directory without an extra agent segment",
    () =>
      Effect.gen(function* () {
        const { path, agent, root } = yield* fixture;
        yield* writeSkill(root, "native");
        yield* writeSkill(path.join(agent, "agent", "skills"), "wrong");
        const skills = yield* discoverOhMyPiSkills({ PI_CODING_AGENT_DIR: agent });
        assert.deepEqual(
          skills.map((skill) => skill.name),
          ["native"],
        );
      }),
  );

  it.effect("reads enabled and ignoredSkills from the real agent config", () =>
    Effect.gen(function* () {
      const { fs, path, agent, root, environment } = yield* fixture;
      yield* writeSkill(root, "kept");
      yield* writeSkill(root, "hidden-task");
      yield* fs.writeFileString(
        path.join(agent, "config.yml"),
        "skills:\n  ignoredSkills: ['hidden-*']\n",
      );
      assert.deepEqual(
        (yield* discoverOhMyPiSkills(environment)).map((skill) => skill.name),
        ["kept"],
      );
      yield* fs.writeFileString(path.join(agent, "config.yml"), "skills:\n  enabled: false\n");
      assert.deepEqual(yield* discoverOhMyPiSkills(environment), []);
    }),
  );

  it.effect("honors include patterns and disabledExtensions in config.yaml", () =>
    Effect.gen(function* () {
      const { fs, path, agent, root, environment } = yield* fixture;
      for (const name of ["ship-app", "ship-docs", "review"]) yield* writeSkill(root, name);
      yield* fs.writeFileString(
        path.join(agent, "config.yaml"),
        "skills:\n  includeSkills: ['ship-*']\ndisabledExtensions: ['skill:ship-docs']\n",
      );
      assert.deepEqual(
        (yield* discoverOhMyPiSkills(environment)).map((skill) => skill.name),
        ["ship-app"],
      );
    }),
  );

  it.effect("prefers config.yml when both configuration files exist", () =>
    Effect.gen(function* () {
      const { fs, path, agent, root, environment } = yield* fixture;
      yield* writeSkill(root, "native");
      yield* fs.writeFileString(path.join(agent, "config.yml"), "skills:\n  enabled: false\n");
      yield* fs.writeFileString(path.join(agent, "config.yaml"), "skills:\n  enabled: true\n");
      assert.deepEqual(yield* discoverOhMyPiSkills(environment), []);
    }),
  );

  it.effect(
    "custom directories override native names and remain enabled when native user skills are off",
    () =>
      Effect.gen(function* () {
        const { fs, path, home, agent, root, environment } = yield* fixture;
        const custom = path.join(home, "custom");
        yield* writeSkill(root, "shared");
        yield* writeSkill(root, "native-only");
        yield* writeSkill(custom, "shared");
        yield* fs.writeFileString(
          path.join(agent, "config.yml"),
          "skills:\n  customDirectories: ['~/custom']\n",
        );
        const skills = yield* discoverOhMyPiSkills(environment);
        assert.equal(
          skills.find((skill) => skill.name === "shared")?.path,
          path.join(custom, "shared", "SKILL.md"),
        );
        yield* fs.writeFileString(
          path.join(agent, "config.yml"),
          "skills:\n  customDirectories: ['~/custom']\n  enablePiUser: false\n",
        );
        assert.deepEqual(
          (yield* discoverOhMyPiSkills(environment)).map((skill) => skill.name),
          ["shared"],
        );
      }),
  );

  it.effect("matches native immediate-child scanning and frontmatter eligibility", () =>
    Effect.gen(function* () {
      const { fs, path, root, environment } = yield* fixture;
      yield* writeSkill(root, "valid");
      yield* writeSkill(root, "valid/nested");
      yield* writeSkill(root, ".hidden");
      yield* writeSkill(root, "disabled", ["enabled: false"]);
      yield* fs.makeDirectory(path.join(root, "no-description"), { recursive: true });
      yield* fs.writeFileString(
        path.join(root, "no-description", "SKILL.md"),
        "---\nname: no-description\n---\n# Skill",
      );
      yield* fs.makeDirectory(path.join(root, "invalid"), { recursive: true });
      yield* fs.writeFileString(
        path.join(root, "invalid", "SKILL.md"),
        "---\nname: [broken\n---\n# Skill",
      );
      assert.deepEqual(
        (yield* discoverOhMyPiSkills(environment)).map((skill) => skill.name),
        ["valid"],
      );
    }),
  );

  it.effect("uses the named profile even when an agent-dir override is inherited", () =>
    Effect.gen(function* () {
      const { path, home, root, environment } = yield* fixture;
      yield* writeSkill(root, "default-only");
      const profileRoot = path.join(home, ".omp", "profiles", "work", "agent", "skills");
      yield* writeSkill(profileRoot, "profile-only");
      const skills = yield* discoverOhMyPiSkills({
        ...environment,
        OMP_PROFILE: "work",
        PI_CODING_AGENT_DIR: path.dirname(root),
      });
      assert.deepEqual(
        skills.map((skill) => skill.name),
        ["profile-only"],
      );
    }),
  );
});

it.layer(NodeServices.layer)("resolveOhMyPiHomePath", (it) => {
  it.effect("defaults to ~/.omp/agent", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(yield* resolveOhMyPiHomePath({}), path.join(NodeOS.homedir(), ".omp", "agent"));
    }),
  );
  it.effect("uses the provider HOME and PI_CONFIG_DIR directory-name override", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(
        yield* resolveOhMyPiHomePath({ HOME: "/tmp/provider", PI_CONFIG_DIR: "/custom" }),
        path.join("/tmp/provider", "/custom", "agent"),
      );
    }),
  );
  it.effect("uses PI_CODING_AGENT_DIR without shell expansion for the default profile", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(
        yield* resolveOhMyPiHomePath({
          PI_CODING_AGENT_DIR: "~/.custom-omp",
          OMP_PROFILE: "default",
        }),
        path.resolve("~/.custom-omp"),
      );
    }),
  );
  it.effect("uses PI_PROFILE only when OMP_PROFILE is absent", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(
        yield* resolveOhMyPiHomePath({ HOME: "/tmp/provider", PI_PROFILE: "work" }),
        path.join("/tmp/provider", ".omp", "profiles", "work", "agent"),
      );
      assert.equal(
        yield* resolveOhMyPiHomePath({
          HOME: "/tmp/provider",
          PI_PROFILE: "work",
          OMP_PROFILE: "",
        }),
        path.join("/tmp/provider", ".omp", "agent"),
      );
    }),
  );
});
