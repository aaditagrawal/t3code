import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeOS from "node:os";
import * as Path from "effect/Path";

import { discoverAcpCliSkills, resolveAcpCliHomePath } from "./StandardAcpCliSkills.ts";

const writeSkill = Effect.fn(function* (
  skillsDir: string,
  directoryName: string,
  contents: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skillDir = path.join(skillsDir, directoryName);
  yield* fs.makeDirectory(skillDir, { recursive: true });
  yield* fs.writeFileString(path.join(skillDir, "SKILL.md"), contents);
});

it.layer(NodeServices.layer)("discoverAcpCliSkills", (it) => {
  it.effect("discovers flat skills with frontmatter metadata", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-skills-" });
      const home = path.join(tempDir, "hermes-home");

      yield* writeSkill(
        path.join(home, "skills"),
        "deploy",
        ["---", "name: deploy", "description: Deploy the app.", "---", "", "# Deploy"].join("\n"),
      );
      yield* writeSkill(
        path.join(home, "skills"),
        "research",
        ["---", "name: paper", "---", "", "# Paper"].join("\n"),
      );

      const skills = yield* discoverAcpCliSkills({ homePath: home });

      assert.deepEqual(skills.map((s) => s.name).sort(), ["deploy", "paper"]);
      assert.equal(skills[0]?.enabled, true);
      assert.equal(skills[0]?.scope, "user");
      const deploy = skills.find((s) => s.name === "deploy");
      assert.equal(deploy?.description, "Deploy the app.");
      assert.equal(deploy?.path, path.join(home, "skills", "deploy", "SKILL.md"));
    }),
  );

  it.effect("recurses into nested category folders", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-skills-" });
      const home = path.join(tempDir, "hermes-home");

      yield* writeSkill(path.join(home, "skills", "devops"), "deploy", "---\nname: deploy\n---\n");
      yield* writeSkill(
        path.join(home, "skills", "devops", "k8s"),
        "k8s",
        ["---", "name: k8s", "description: Kubernetes helper.", "---"].join("\n"),
      );

      const skills = yield* discoverAcpCliSkills({ homePath: home });

      assert.deepEqual(skills.map((s) => s.name).sort(), ["deploy", "k8s"]);
    }),
  );

  it.effect("honors HERMES_HOME from the environment when homePath is unset", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-skills-" });
      const envHome = path.join(tempDir, "env-home");

      yield* writeSkill(
        path.join(envHome, "skills"),
        "env-skill",
        ["---", "name: env-skill", "description: From env home.", "---"].join("\n"),
      );

      const skills = yield* discoverAcpCliSkills({}, { HERMES_HOME: envHome }, "HERMES_HOME");

      assert.deepEqual(
        skills.map((s) => s.name),
        ["env-skill"],
      );
    }),
  );

  it.effect("explicit homePath wins over the environment variable", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-skills-" });
      const explicitHome = path.join(tempDir, "explicit-home");
      const envHome = path.join(tempDir, "env-home");

      yield* writeSkill(
        path.join(explicitHome, "skills"),
        "explicit-skill",
        ["---", "name: explicit-skill", "---"].join("\n"),
      );
      yield* writeSkill(
        path.join(envHome, "skills"),
        "env-skill",
        ["---", "name: env-skill", "---"].join("\n"),
      );

      const skills = yield* discoverAcpCliSkills(
        { homePath: explicitHome },
        { HERMES_HOME: envHome },
      );

      assert.deepEqual(
        skills.map((s) => s.name),
        ["explicit-skill"],
      );
    }),
  );

  it.effect("returns no skills when no home is declared (opt-in)", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-skills-" });
      const home = path.join(tempDir, "some-home");

      yield* writeSkill(
        path.join(home, "skills"),
        "skill",
        ["---", "name: skill", "---"].join("\n"),
      );

      // Even with skills on disk, a provider that declares neither homePath nor
      // a home env var gets no discovery — we don't guess where it keeps skills.
      const skills = yield* discoverAcpCliSkills({}, { HERMES_HOME: home, PI_HOME: home });

      assert.deepEqual(skills, []);
    }),
  );

  it.effect("falls back to the directory name and skips malformed frontmatter", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-skills-" });
      const home = path.join(tempDir, "hermes-home");
      const skillsDir = path.join(home, "skills");

      yield* writeSkill(skillsDir, "no-frontmatter", "# Just a heading\n");
      yield* writeSkill(skillsDir, "broken-yaml", "---\nname: [unclosed\n---\n");
      yield* fs.makeDirectory(skillsDir, { recursive: true });
      yield* fs.writeFileString(path.join(skillsDir, "README.md"), "not a skill");

      const skills = yield* discoverAcpCliSkills({ homePath: home });

      assert.deepEqual(
        skills.map((s) => s.name),
        ["no-frontmatter"],
      );
      assert.equal(skills[0]?.description, undefined);
    }),
  );

  it.effect("returns an empty list when no skills root exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-skills-" });

      const skills = yield* discoverAcpCliSkills({
        homePath: path.join(tempDir, "missing-home"),
      });

      assert.deepEqual(skills, []);
    }),
  );
});

it.layer(NodeServices.layer)("resolveAcpCliHomePath", (it) => {
  it.effect("prefers explicit homePath, then env var, then defaults to ~/.hermes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-acp-cli-home-" });

      const explicit = yield* resolveAcpCliHomePath(
        { homePath: path.join(tempDir, "explicit") },
        { HERMES_HOME: path.join(tempDir, "env") },
      );
      assert.equal(explicit, path.join(tempDir, "explicit"));

      const fromEnv = yield* resolveAcpCliHomePath({}, { HERMES_HOME: path.join(tempDir, "env") });
      assert.equal(fromEnv, path.join(tempDir, "env"));

      // No override: default ~/.hermes, resolved against the platform home.
      const fromDefault = yield* resolveAcpCliHomePath({}, {});
      assert.equal(fromDefault, path.join(NodeOS.homedir(), ".hermes"));
    }),
  );
});
