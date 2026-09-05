import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";

import type { CursorSettings } from "@t3tools/contracts";
import { CursorSettings as CursorSettingsSchema } from "@t3tools/contracts";

import {
  discoverCursorSkills,
  hasCursorSkillMention,
  probeCursorSkills,
  rewriteCursorSkillMentions,
} from "../Drivers/CursorSkills.ts";
import type { CursorSdkClient, CursorSdkModelListItem } from "../cursor/CursorSdkClient.ts";
import {
  buildCursorCapabilitiesFromSdkModel,
  buildCursorDiscoveredModelsFromSdkModels,
} from "../cursor/CursorSdkMappings.ts";
import { checkCursorProviderStatus, getCursorFallbackModels } from "./CursorProvider.ts";

const decodeCursorSettings = Schema.decodeSync(CursorSettingsSchema);

function runEffect<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.runPromise(effect);
}

const runNode = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

function makeSettings(input?: Partial<CursorSettings>): CursorSettings {
  return decodeCursorSettings({
    enabled: true,
    ...input,
  });
}

function makeSdkClient(input?: {
  readonly userError?: unknown;
  readonly modelError?: unknown;
  readonly models?: ReadonlyArray<CursorSdkModelListItem>;
}): CursorSdkClient {
  return {
    createAgent: vi.fn(),
    resumeAgent: vi.fn(),
    prompt: vi.fn(),
    getCurrentUser: vi.fn(async () => {
      if (input?.userError) {
        throw input.userError;
      }
      return {
        apiKeyName: "Personal key",
        userEmail: "cursor@example.com",
        userFirstName: "Cursor",
        userLastName: "User",
        createdAt: "2026-05-24T00:00:00.000Z",
      };
    }),
    listModels: vi.fn(async () => {
      if (input?.modelError) {
        throw input.modelError;
      }
      return input?.models ?? [];
    }),
  };
}

describe("CursorProvider SDK", () => {
  it("keeps fallback and custom models available", () => {
    const models = getCursorFallbackModels(makeSettings({ customModels: ["local-custom"] }));
    expect(models.map((model) => model.slug)).toEqual(["composer-2.5", "local-custom"]);
    expect(models[1]?.isCustom).toBe(true);
  });

  it("maps Cursor SDK model parameters into provider option descriptors", () => {
    const caps = buildCursorCapabilitiesFromSdkModel({
      id: "composer-2.5",
      displayName: "Composer 2.5",
      parameters: [
        {
          id: "effort",
          displayName: "Effort",
          values: [
            { value: "low", displayName: "Low" },
            { value: "high", displayName: "High" },
          ],
        },
        {
          id: "context",
          displayName: "Context",
          values: [{ value: "272k" }, { value: "1m" }],
        },
        {
          id: "fast",
          displayName: "Fast",
          values: [{ value: "false" }, { value: "true" }],
        },
      ],
      variants: [
        {
          displayName: "Default",
          isDefault: true,
          params: [
            { id: "effort", value: "high" },
            { id: "context", value: "272k" },
            { id: "fast", value: "false" },
          ],
        },
      ],
    });

    expect(caps.optionDescriptors).toEqual([
      {
        id: "reasoning",
        label: "Effort",
        type: "select",
        currentValue: "high",
        options: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
      {
        id: "contextWindow",
        label: "Context",
        type: "select",
        currentValue: "272k",
        options: [
          { id: "272k", label: "272k", isDefault: true },
          { id: "1m", label: "1m" },
        ],
      },
      {
        id: "fastMode",
        label: "Fast",
        type: "boolean",
        currentValue: false,
      },
    ]);
  });

  it("builds discovered provider models from the SDK catalog", () => {
    const models = buildCursorDiscoveredModelsFromSdkModels(
      [
        {
          id: "composer-2.5",
          displayName: "Composer 2.5",
          parameters: [],
        },
      ],
      [
        "custom-cursor",
        { slug: "custom-named", name: "Named model", capabilities: { optionDescriptors: [] } },
      ],
    );
    expect(models.map((model) => [model.slug, model.name, model.isCustom])).toEqual([
      ["composer-2.5", "Composer 2.5", false],
      ["custom-cursor", "custom-cursor", true],
      ["custom-named", "Named model", true],
    ]);
  });

  it("reports missing CURSOR_API_KEY as unauthenticated", async () => {
    const snapshot = await runEffect(
      checkCursorProviderStatus(makeSettings(), {} as NodeJS.ProcessEnv, makeSdkClient()),
    );
    expect(snapshot.status).toBe("error");
    expect(snapshot.auth.status).toBe("unauthenticated");
    expect(snapshot.message).toContain("CURSOR_API_KEY");
  });

  it("authenticates and discovers models through the Cursor SDK", async () => {
    const sdkClient = makeSdkClient({
      models: [
        {
          id: "composer-2.5",
          displayName: "Composer 2.5",
          parameters: [],
        },
      ],
    });
    const snapshot = await runEffect(
      checkCursorProviderStatus(
        makeSettings(),
        { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        sdkClient,
      ),
    );
    expect(snapshot.status).toBe("ready");
    expect(snapshot.auth).toMatchObject({
      status: "authenticated",
      email: "cursor@example.com",
      label: "Personal key - Cursor - User",
    });
    expect(snapshot.models.map((model) => model.slug)).toEqual(["composer-2.5"]);
  });

  it("keeps the provider usable when SDK model discovery fails", async () => {
    const snapshot = await runEffect(
      checkCursorProviderStatus(
        makeSettings(),
        { CURSOR_API_KEY: "cursor-key" } as NodeJS.ProcessEnv,
        makeSdkClient({ modelError: new Error("catalog down") }),
      ),
    );
    expect(snapshot.status).toBe("warning");
    expect(snapshot.auth.status).toBe("authenticated");
    expect(snapshot.message).toContain("catalog down");
    expect(snapshot.models.map((model) => model.slug)).toContain("composer-2.5");
  });
});

describe("Cursor skills", () => {
  it("detects and invokes digit-leading Cursor skills without rewriting money", () => {
    const names = new Set(["2spec", "20k", "100M", "1e6"]);
    // Repeated presence checks must not carry a global-regex cursor.
    expect(hasCursorSkillMention("use $2spec here")).toBe(true);
    expect(hasCursorSkillMention("use $2spec here")).toBe(true);
    expect(rewriteCursorSkillMentions("use $2spec here", names)).toBe("use /2spec here");
    expect(rewriteCursorSkillMentions("use $2spec here", new Set())).toBe("use $2spec here");
    for (const text of [
      "pay $20 tomorrow",
      "budget $20k here",
      "cost $100M total",
      "limit $1e6 here",
    ]) {
      expect(hasCursorSkillMention(text)).toBe(false);
      expect(rewriteCursorSkillMentions(text, names)).toBe(text);
    }
  });
  it("treats a symlinked skill outside the root as a package boundary", async () =>
    await runNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userHome = yield* fileSystem.makeTempDirectory({
          directory: NodeOS.tmpdir(),
          prefix: "cursor-skills-home-",
        });
        const workspace = yield* fileSystem
          .makeTempDirectory({
            directory: NodeOS.tmpdir(),
            prefix: "cursor-skills-workspace-",
          })
          .pipe(Effect.flatMap((directory) => fileSystem.realPath(directory)));
        const library = yield* fileSystem.makeTempDirectory({
          directory: NodeOS.tmpdir(),
          prefix: "cursor-skills-library-",
        });
        const writeSkill = Effect.fn("writeCursorSkill")(function* (
          directory: string,
          contents: string,
        ) {
          yield* fileSystem.makeDirectory(directory, { recursive: true });
          yield* fileSystem.writeFileString(path.join(directory, "SKILL.md"), contents);
        });

        // A skill package managed in a config repo and installed by symlink.
        // Its own SKILL.md must be discovered under the link name, but nothing
        // below the target may be walked.
        yield* writeSkill(path.join(library, "shared-review"), "---\ndescription: shared\n---\n");
        yield* writeSkill(path.join(library, "shared-review", "hidden"), "---\n---\n");
        const root = path.join(workspace, ".cursor", "skills");
        yield* fileSystem.makeDirectory(root, { recursive: true });
        yield* fileSystem.symlink(path.join(library, "shared-review"), path.join(root, "review"));

        const skills = yield* discoverCursorSkills(workspace, { HOME: userHome });
        expect(skills).toEqual([
          {
            name: "review",
            description: "shared",
            path: path.join(root, "review", "SKILL.md"),
            scope: "project",
            enabled: true,
          },
        ]);
        expect(
          (yield* probeCursorSkills(workspace, { HOME: userHome }).pipe(Effect.result))._tag,
        ).toBe("Success");
      }),
    ));

  it("discovers recursive project skills with project precedence", async () =>
    await runNode(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const userHome = yield* fileSystem.makeTempDirectory({
          directory: NodeOS.tmpdir(),
          prefix: "cursor-skills-home-",
        });
        const workspace = yield* fileSystem
          .makeTempDirectory({
            directory: NodeOS.tmpdir(),
            prefix: "cursor-skills-workspace-",
          })
          .pipe(Effect.flatMap((directory) => fileSystem.realPath(directory)));
        const writeSkill = Effect.fn("writeCursorSkill")(function* (
          root: string,
          name: string,
          contents: string,
        ) {
          const skillDirectory = path.join(root, name);
          yield* fileSystem.makeDirectory(skillDirectory, { recursive: true });
          yield* fileSystem.writeFileString(path.join(skillDirectory, "SKILL.md"), contents);
        });

        yield* writeSkill(
          path.join(userHome, ".cursor", "skills"),
          "review",
          "---\ndescription: user review\n---\n",
        );
        yield* writeSkill(
          path.join(workspace, ".agents", "skills", "nested"),
          "review",
          "---\nname: Review changes\ndescription: project review\n---\n",
        );
        yield* writeSkill(
          path.join(workspace, ".cursor", "skills"),
          "internal",
          "---\nuser-invocable: false\n---\n",
        );
        yield* writeSkill(
          path.join(workspace, ".cursor", "skills"),
          "oversized",
          "x".repeat(1_000_001),
        );
        yield* fileSystem.makeDirectory(path.join(userHome, ".codex"), { recursive: true });
        yield* fileSystem.writeFileString(
          path.join(userHome, ".codex", "skills"),
          "not a directory",
        );

        const skills = yield* discoverCursorSkills(workspace, { HOME: userHome });
        expect(skills).toEqual([
          {
            name: "internal",
            path: path.join(workspace, ".cursor", "skills", "internal", "SKILL.md"),
            scope: "project",
            enabled: true,
            userInvocable: false,
          },
          {
            name: "oversized",
            path: path.join(workspace, ".cursor", "skills", "oversized", "SKILL.md"),
            scope: "project",
            enabled: true,
          },
          {
            name: "review",
            displayName: "Review changes",
            description: "project review",
            path: path.join(workspace, ".agents", "skills", "nested", "review", "SKILL.md"),
            scope: "project",
            enabled: true,
          },
        ]);
        expect(
          (yield* probeCursorSkills(workspace, { HOME: userHome }).pipe(Effect.result))._tag,
        ).toBe("Failure");
      }),
    ));

  it("rewrites only discovered skill mentions into Cursor slash invocations", () => {
    expect(hasCursorSkillMention("use $Review_Pr:V2 here")).toBe(true);
    expect(hasCursorSkillMention("please $review this")).toBe(true);
    expect(
      rewriteCursorSkillMentions("use $review, keep $HOME and 5$review", new Set(["review"])),
    ).toBe("use $review, keep $HOME and 5$review");
    expect(rewriteCursorSkillMentions("please $review this", new Set(["review"]))).toBe(
      "please /review this",
    );
  });
});
