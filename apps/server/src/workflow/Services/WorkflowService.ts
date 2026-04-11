/**
 * WorkflowService - Workflow template management and execution.
 *
 * Owns CRUD for workflow templates (including built-in seed templates),
 * variable substitution, and execution by converting resolved templates
 * into pipelines and delegating to PipelineService.
 *
 * @module WorkflowService
 */
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { Effect, Layer, ServiceMap } from "effect";

import { PipelineService, type PipelineStage } from "../../pipeline/Services/PipelineService.ts";

// ── Domain Types ────────────────────────────────────────────────────────────

export interface WorkflowVariable {
  readonly name: string;
  readonly description: string;
  readonly defaultValue: string | null;
}

export interface WorkflowStep {
  readonly id: string;
  readonly name: string;
  readonly prompt: string;
  readonly dependsOn: ReadonlyArray<string>;
}

export interface WorkflowTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string;
  readonly variables: ReadonlyArray<WorkflowVariable>;
  readonly steps: ReadonlyArray<WorkflowStep>;
  readonly isBuiltIn: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Service Shape ───────────────────────────────────────────────────────────

export interface WorkflowServiceShape {
  /** List workflow templates with optional category filter. */
  readonly list: (input: {
    readonly category?: string | undefined;
  }) => Effect.Effect<ReadonlyArray<WorkflowTemplate>>;

  /** Create a new workflow template. */
  readonly create: (input: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly category: string;
    readonly variables: ReadonlyArray<WorkflowVariable>;
    readonly steps: ReadonlyArray<WorkflowStep>;
  }) => Effect.Effect<WorkflowTemplate>;

  /** Delete a non-built-in template. */
  readonly delete: (input: { readonly templateId: string }) => Effect.Effect<void>;

  /** Resolve variables, create a pipeline from steps, and execute. */
  readonly execute: (input: {
    readonly templateId: string;
    readonly projectId: string;
    readonly threadId: string;
    readonly variables: Record<string, string>;
    readonly executionId: string;
    readonly pipelineId: string;
  }) => Effect.Effect<void>;
}

// ── Service Tag ─────────────────────────────────────────────────────────────

export class WorkflowService extends ServiceMap.Service<WorkflowService, WorkflowServiceShape>()(
  "t3/workflow/Services/WorkflowService",
) {}

// ── Built-in Templates ──────────────────────────────────────────────────────

const BUILT_IN_TEMPLATES: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly variables: ReadonlyArray<WorkflowVariable>;
  readonly steps: ReadonlyArray<WorkflowStep>;
}> = [
  {
    id: "builtin:implement-and-test",
    name: "Implement & Test",
    description: "Implement a feature and write tests for it.",
    category: "development",
    variables: [
      {
        name: "FEATURE_DESCRIPTION",
        description: "Description of the feature to implement",
        defaultValue: null,
      },
      { name: "TEST_FRAMEWORK", description: "Testing framework to use", defaultValue: "vitest" },
    ],
    steps: [
      {
        id: "implement",
        name: "Implement Feature",
        prompt: "Implement the following feature: {{FEATURE_DESCRIPTION}}",
        dependsOn: [],
      },
      {
        id: "test",
        name: "Write Tests",
        prompt: "Write {{TEST_FRAMEWORK}} tests for the feature: {{FEATURE_DESCRIPTION}}",
        dependsOn: ["implement"],
      },
    ],
  },
  {
    id: "builtin:review-and-fix",
    name: "Review & Fix",
    description: "Review code for issues and apply fixes.",
    category: "quality",
    variables: [
      { name: "REVIEW_SCOPE", description: "Files or modules to review", defaultValue: "." },
    ],
    steps: [
      {
        id: "review",
        name: "Code Review",
        prompt:
          "Review the code in {{REVIEW_SCOPE}} for bugs, security issues, and code quality problems. List all issues found.",
        dependsOn: [],
      },
      {
        id: "fix",
        name: "Apply Fixes",
        prompt: "Fix all issues identified in the code review of {{REVIEW_SCOPE}}.",
        dependsOn: ["review"],
      },
    ],
  },
  {
    id: "builtin:feature-branch",
    name: "Feature Branch",
    description: "Create a feature branch, implement, test, and prepare for review.",
    category: "development",
    variables: [
      { name: "BRANCH_NAME", description: "Name for the feature branch", defaultValue: null },
      {
        name: "FEATURE_DESCRIPTION",
        description: "Description of the feature",
        defaultValue: null,
      },
    ],
    steps: [
      {
        id: "branch",
        name: "Create Branch",
        prompt: "Create a new git branch named '{{BRANCH_NAME}}' from the current branch.",
        dependsOn: [],
      },
      {
        id: "implement",
        name: "Implement",
        prompt: "Implement the following feature: {{FEATURE_DESCRIPTION}}",
        dependsOn: ["branch"],
      },
      {
        id: "test",
        name: "Test",
        prompt: "Write and run tests for: {{FEATURE_DESCRIPTION}}",
        dependsOn: ["implement"],
      },
      {
        id: "prepare",
        name: "Prepare for Review",
        prompt: "Commit all changes and prepare a summary of what was implemented for code review.",
        dependsOn: ["test"],
      },
    ],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Substitute {{VAR_NAME}} placeholders in a prompt string. */
function substituteVariables(
  prompt: string,
  variables: Record<string, string>,
  defaults: ReadonlyArray<WorkflowVariable>,
): string {
  let result = prompt;
  const defaultMap = new Map(defaults.map((v) => [v.name, v.defaultValue]));

  for (const [name, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${name}}}`, value);
  }
  // Fill any remaining placeholders with defaults
  for (const [name, defaultValue] of defaultMap) {
    if (defaultValue !== null) {
      result = result.replaceAll(`{{${name}}}`, defaultValue);
    }
  }
  return result;
}

function templateRowToDomain(row: Record<string, unknown>): WorkflowTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    category: row.category as string,
    variables: JSON.parse(row.variables as string) as ReadonlyArray<WorkflowVariable>,
    steps: JSON.parse(row.steps as string) as ReadonlyArray<WorkflowStep>,
    isBuiltIn: (row.isBuiltIn as number) === 1,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  };
}

// ── Layer Implementation ────────────────────────────────────────────────────

const makeWorkflowService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pipelineService = yield* PipelineService;

  // Seed built-in templates on startup
  for (const template of BUILT_IN_TEMPLATES) {
    const now = new Date().toISOString();
    yield* sql`
      INSERT INTO workflow_templates (id, name, description, category, variables, steps, is_built_in, created_at, updated_at)
      VALUES (
        ${template.id},
        ${template.name},
        ${template.description},
        ${template.category},
        ${JSON.stringify(template.variables)},
        ${JSON.stringify(template.steps)},
        ${1},
        ${now},
        ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        variables = excluded.variables,
        steps = excluded.steps,
        updated_at = excluded.updated_at
    `;
  }

  const list: WorkflowServiceShape["list"] = (input) =>
    Effect.gen(function* () {
      const rows = input.category
        ? yield* sql`
            SELECT id, name, description, category, variables, steps, is_built_in AS "isBuiltIn",
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM workflow_templates
            WHERE category = ${input.category}
            ORDER BY is_built_in DESC, created_at ASC
          `
        : yield* sql`
            SELECT id, name, description, category, variables, steps, is_built_in AS "isBuiltIn",
                   created_at AS "createdAt", updated_at AS "updatedAt"
            FROM workflow_templates
            ORDER BY is_built_in DESC, created_at ASC
          `;

      return rows.map(templateRowToDomain);
    }).pipe(Effect.orDie);

  const create: WorkflowServiceShape["create"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      yield* sql`
        INSERT INTO workflow_templates (id, name, description, category, variables, steps, is_built_in, created_at, updated_at)
        VALUES (
          ${input.id},
          ${input.name},
          ${input.description},
          ${input.category},
          ${JSON.stringify(input.variables)},
          ${JSON.stringify(input.steps)},
          ${0},
          ${now},
          ${now}
        )
      `;

      return {
        id: input.id,
        name: input.name,
        description: input.description,
        category: input.category,
        variables: input.variables,
        steps: input.steps,
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now,
      } satisfies WorkflowTemplate;
    }).pipe(Effect.orDie);

  const deleteTemplate: WorkflowServiceShape["delete"] = (input) =>
    sql`
      DELETE FROM workflow_templates
      WHERE id = ${input.templateId} AND is_built_in = 0
    `.pipe(Effect.orDie);

  const execute: WorkflowServiceShape["execute"] = (input) =>
    Effect.gen(function* () {
      // Resolve template
      const rows = yield* sql`
        SELECT id, name, description, category, variables, steps, is_built_in AS "isBuiltIn",
               created_at AS "createdAt", updated_at AS "updatedAt"
        FROM workflow_templates
        WHERE id = ${input.templateId}
      `;
      if (rows.length === 0) {
        return yield* Effect.die(new Error(`Workflow template not found: ${input.templateId}`));
      }
      const template = templateRowToDomain(rows[0]!);

      // Convert steps to pipeline stages with variable substitution
      const pipelineStages: PipelineStage[] = template.steps.map((step) => ({
        id: step.id,
        name: step.name,
        prompt: substituteVariables(step.prompt, input.variables, template.variables),
        dependsOn: step.dependsOn,
      }));

      // Create pipeline definition
      yield* pipelineService.create({
        id: input.pipelineId,
        name: `workflow:${template.name}`,
        description: template.description,
        projectId: input.projectId,
        stages: pipelineStages,
      });

      // Execute pipeline
      yield* pipelineService.execute({
        executionId: input.executionId,
        pipelineId: input.pipelineId,
        projectId: input.projectId,
        threadId: input.threadId,
      });
    }).pipe(Effect.orDie);

  return {
    list,
    create,
    delete: deleteTemplate,
    execute,
  } satisfies WorkflowServiceShape;
});

export const WorkflowServiceLive = Layer.effect(WorkflowService, makeWorkflowService);
