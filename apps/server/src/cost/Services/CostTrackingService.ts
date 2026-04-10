/**
 * CostTrackingService - Service interface and Live layer for token usage cost tracking.
 *
 * Records per-turn token usage and cost, manages budgets with alerting,
 * and provides summaries aggregated by provider, thread, or project.
 *
 * @module CostTrackingService
 */
import type {
  CostAlert,
  CostBudget,
  CostEntry,
  CostGetSummaryInput,
  CostSetBudgetInput,
  CostStreamEvent,
  CostSummary,
  ProviderKind,
  TokenUsage,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface CostTrackingServiceShape {
  /**
   * Record token usage and cost for a single interaction.
   *
   * Automatically updates any matching budget spend and publishes alerts
   * when budget thresholds are reached.
   */
  readonly recordUsage: (input: {
    readonly threadId: string;
    readonly projectId: string;
    readonly turnId: string | null;
    readonly provider: string;
    readonly model: string;
    readonly usage: TokenUsage;
    readonly costCents: number;
  }) => Effect.Effect<CostEntry>;

  /**
   * Retrieve an aggregated cost summary for a given time period and filters.
   */
  readonly getSummary: (input: CostGetSummaryInput) => Effect.Effect<CostSummary>;

  /**
   * Create or update a cost budget with alerting threshold.
   */
  readonly setBudget: (input: CostSetBudgetInput) => Effect.Effect<CostBudget>;

  /**
   * List all budgets, optionally filtered by project.
   */
  readonly getBudgets: (input: {
    readonly projectId?: string | undefined;
  }) => Effect.Effect<{ readonly budgets: ReadonlyArray<CostBudget> }>;

  /**
   * Live stream of cost events (new entries, alerts, budget updates).
   *
   * Each access creates a fresh PubSub subscription so multiple consumers
   * independently receive all events.
   */
  readonly streamEvents: Stream.Stream<CostStreamEvent>;
}

export class CostTrackingService extends ServiceMap.Service<
  CostTrackingService,
  CostTrackingServiceShape
>()("t3/cost/Services/CostTrackingService") {}

type BudgetRow = {
  id: string;
  project_id: string | null;
  limit_cents: number;
  period_days: number;
  current_spend_cents: number;
  alert_threshold_percent: number;
  enabled: number;
  created_at: string;
  updated_at: string;
};

const makeCostTrackingService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pubsub = yield* PubSub.unbounded<CostStreamEvent>();

  const recordUsage: CostTrackingServiceShape["recordUsage"] = (input) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      yield* sql`INSERT INTO cost_entries (id, thread_id, project_id, turn_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, thinking_tokens, cost_cents, created_at)
        VALUES (${id}, ${input.threadId}, ${input.projectId}, ${input.turnId}, ${input.provider}, ${input.model}, ${input.usage.inputTokens}, ${input.usage.outputTokens}, ${input.usage.cacheReadTokens}, ${input.usage.cacheWriteTokens}, ${input.usage.thinkingTokens}, ${input.costCents}, ${now})`;

      const entry: CostEntry = {
        id: id as CostEntry["id"],
        threadId: input.threadId as CostEntry["threadId"],
        projectId: input.projectId as CostEntry["projectId"],
        turnId: (input.turnId ?? null) as CostEntry["turnId"],
        provider: input.provider as CostEntry["provider"],
        model: input.model as CostEntry["model"],
        usage: input.usage,
        costCents: input.costCents as CostEntry["costCents"],
        createdAt: now,
      };

      // Update budget spend and check alert thresholds
      const budgets = yield* sql<{
        id: string;
        limit_cents: number;
        current_spend_cents: number;
        alert_threshold_percent: number;
        project_id: string | null;
      }>`SELECT id, limit_cents, current_spend_cents, alert_threshold_percent, project_id
        FROM cost_budgets
        WHERE enabled = 1 AND (project_id IS NULL OR project_id = ${input.projectId})`;

      for (const budget of budgets) {
        const newSpend = budget.current_spend_cents + input.costCents;
        yield* sql`UPDATE cost_budgets SET current_spend_cents = ${newSpend}, updated_at = ${now} WHERE id = ${budget.id}`;

        const percentUsed = Math.round((newSpend / budget.limit_cents) * 100);
        if (percentUsed >= budget.alert_threshold_percent) {
          const alert: CostAlert = {
            budgetId: budget.id as CostAlert["budgetId"],
            projectId: (budget.project_id ?? null) as CostAlert["projectId"],
            currentSpendCents: newSpend as CostAlert["currentSpendCents"],
            limitCents: budget.limit_cents as CostAlert["limitCents"],
            percentUsed: percentUsed as CostAlert["percentUsed"],
            alertedAt: now,
          };
          yield* PubSub.publish(pubsub, { type: "cost.alert" as const, alert });
        }
      }

      yield* PubSub.publish(pubsub, { type: "cost.entry" as const, entry });
      return entry;
    }).pipe(Effect.orDie);

  const getSummary: CostTrackingServiceShape["getSummary"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();
      const periodStart =
        input.periodStart ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const periodEnd = input.periodEnd ?? now;

      const conditions: Array<string> = ["created_at >= ?", "created_at <= ?"];
      const params: Array<string> = [periodStart, periodEnd];
      if (input.projectId) {
        conditions.push("project_id = ?");
        params.push(input.projectId);
      }
      if (input.threadId) {
        conditions.push("thread_id = ?");
        params.push(input.threadId);
      }
      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const totals = yield* sql.unsafe<{
        total_cost: number;
        total_input: number;
        total_output: number;
        total_thinking: number;
      }>(
        `SELECT COALESCE(SUM(cost_cents), 0) as total_cost, COALESCE(SUM(input_tokens), 0) as total_input, COALESCE(SUM(output_tokens), 0) as total_output, COALESCE(SUM(thinking_tokens), 0) as total_thinking FROM cost_entries ${whereClause}`,
        params,
      );
      const byProvider = yield* sql.unsafe<{
        provider: string;
        cost_cents: number;
        input_tokens: number;
        output_tokens: number;
      }>(
        `SELECT provider, COALESCE(SUM(cost_cents), 0) as cost_cents, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens FROM cost_entries ${whereClause} GROUP BY provider`,
        params,
      );
      const byThread = yield* sql.unsafe<{ threadId: string; cost_cents: number }>(
        `SELECT thread_id as threadId, COALESCE(SUM(cost_cents), 0) as cost_cents FROM cost_entries ${whereClause} GROUP BY thread_id ORDER BY cost_cents DESC LIMIT 20`,
        params,
      );

      const row = totals[0] ?? {
        total_cost: 0,
        total_input: 0,
        total_output: 0,
        total_thinking: 0,
      };
      return {
        totalCostCents: Number(row.total_cost),
        totalInputTokens: Number(row.total_input),
        totalOutputTokens: Number(row.total_output),
        totalThinkingTokens: Number(row.total_thinking),
        byProvider: byProvider.map((r) => ({
          provider: r.provider as ProviderKind,
          costCents: Number(r.cost_cents),
          inputTokens: Number(r.input_tokens),
          outputTokens: Number(r.output_tokens),
        })),
        byThread: byThread.map((r) => ({
          threadId: r.threadId as CostSummary["byThread"][number]["threadId"],
          costCents: Number(r.cost_cents) as CostSummary["byThread"][number]["costCents"],
        })),
        periodStart,
        periodEnd,
      } satisfies CostSummary;
    }).pipe(Effect.orDie);

  const setBudget: CostTrackingServiceShape["setBudget"] = (input) =>
    Effect.gen(function* () {
      const now = new Date().toISOString();

      yield* sql`INSERT OR REPLACE INTO cost_budgets (id, project_id, limit_cents, period_days, current_spend_cents, alert_threshold_percent, enabled, created_at, updated_at)
        VALUES (${input.budgetId}, ${input.projectId}, ${input.limitCents}, ${input.periodDays}, 0, ${input.alertThresholdPercent}, ${input.enabled ? 1 : 0}, ${now}, ${now})`;

      const budget: CostBudget = {
        id: input.budgetId as CostBudget["id"],
        projectId: (input.projectId ?? null) as CostBudget["projectId"],
        limitCents: input.limitCents as CostBudget["limitCents"],
        periodDays: input.periodDays as CostBudget["periodDays"],
        currentSpendCents: 0 as CostBudget["currentSpendCents"],
        alertThresholdPercent: input.alertThresholdPercent as CostBudget["alertThresholdPercent"],
        enabled: input.enabled,
        createdAt: now,
        updatedAt: now,
      };

      yield* PubSub.publish(pubsub, { type: "cost.budget.updated" as const, budget });
      return budget;
    }).pipe(Effect.orDie);

  const getBudgets: CostTrackingServiceShape["getBudgets"] = (input) =>
    Effect.gen(function* () {
      const rows: readonly BudgetRow[] = input.projectId
        ? yield* sql<BudgetRow>`SELECT * FROM cost_budgets WHERE project_id = ${input.projectId} OR project_id IS NULL`
        : yield* sql<BudgetRow>`SELECT * FROM cost_budgets`;

      return {
        budgets: rows.map((r) => ({
          id: r.id as CostBudget["id"],
          projectId: (r.project_id ?? null) as CostBudget["projectId"],
          limitCents: r.limit_cents as CostBudget["limitCents"],
          periodDays: r.period_days as CostBudget["periodDays"],
          currentSpendCents: r.current_spend_cents as CostBudget["currentSpendCents"],
          alertThresholdPercent: r.alert_threshold_percent as CostBudget["alertThresholdPercent"],
          enabled: r.enabled === 1,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })) as readonly CostBudget[],
      };
    }).pipe(Effect.orDie);

  return {
    recordUsage,
    getSummary,
    setBudget,
    getBudgets,
    get streamEvents(): CostTrackingServiceShape["streamEvents"] {
      return Stream.fromPubSub(pubsub);
    },
  } satisfies CostTrackingServiceShape;
});

export const CostTrackingServiceLive = Layer.effect(CostTrackingService, makeCostTrackingService);
