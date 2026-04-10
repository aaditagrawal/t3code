import { Schema } from "effect";
import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas";
import { ProviderKind } from "./orchestration";

const makeEntityId = <Brand extends string>(brand: Brand) =>
  TrimmedNonEmptyString.pipe(Schema.brand(brand));

export const CostEntryId = makeEntityId("CostEntryId");
export type CostEntryId = typeof CostEntryId.Type;
export const BudgetId = makeEntityId("BudgetId");
export type BudgetId = typeof BudgetId.Type;

export const TokenUsage = Schema.Struct({
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
  cacheReadTokens: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
  cacheWriteTokens: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
  thinkingTokens: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 0)),
});
export type TokenUsage = typeof TokenUsage.Type;

/** Cents (USD × 100) to avoid floating-point drift. */
export const CostCents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type CostCents = typeof CostCents.Type;

export const CostEntry = Schema.Struct({
  id: CostEntryId,
  threadId: ThreadId,
  projectId: ProjectId,
  turnId: Schema.NullOr(TurnId),
  provider: ProviderKind,
  model: TrimmedNonEmptyString,
  usage: TokenUsage,
  costCents: CostCents,
  createdAt: IsoDateTime,
});
export type CostEntry = typeof CostEntry.Type;

export const CostSummary = Schema.Struct({
  totalCostCents: CostCents,
  totalInputTokens: NonNegativeInt,
  totalOutputTokens: NonNegativeInt,
  totalThinkingTokens: NonNegativeInt,
  byProvider: Schema.Array(
    Schema.Struct({
      provider: ProviderKind,
      costCents: CostCents,
      inputTokens: NonNegativeInt,
      outputTokens: NonNegativeInt,
    }),
  ),
  byThread: Schema.Array(
    Schema.Struct({
      threadId: ThreadId,
      costCents: CostCents,
    }),
  ),
  periodStart: IsoDateTime,
  periodEnd: IsoDateTime,
});
export type CostSummary = typeof CostSummary.Type;

export const CostBudget = Schema.Struct({
  id: BudgetId,
  projectId: Schema.NullOr(ProjectId),
  limitCents: CostCents,
  periodDays: NonNegativeInt,
  currentSpendCents: CostCents,
  alertThresholdPercent: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 80)),
  enabled: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CostBudget = typeof CostBudget.Type;

export const CostAlert = Schema.Struct({
  budgetId: BudgetId,
  projectId: Schema.NullOr(ProjectId),
  currentSpendCents: CostCents,
  limitCents: CostCents,
  percentUsed: NonNegativeInt,
  alertedAt: IsoDateTime,
});
export type CostAlert = typeof CostAlert.Type;

export const CostGetSummaryInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  threadId: Schema.optional(ThreadId),
  periodStart: Schema.optional(IsoDateTime),
  periodEnd: Schema.optional(IsoDateTime),
});
export type CostGetSummaryInput = typeof CostGetSummaryInput.Type;

export const CostSetBudgetInput = Schema.Struct({
  budgetId: BudgetId,
  projectId: Schema.NullOr(ProjectId),
  limitCents: CostCents,
  periodDays: NonNegativeInt,
  alertThresholdPercent: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 80)),
  enabled: Schema.Boolean,
});
export type CostSetBudgetInput = typeof CostSetBudgetInput.Type;

export const CostGetBudgetsInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
});

export const CostStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("cost.entry"), entry: CostEntry }),
  Schema.Struct({ type: Schema.Literal("cost.alert"), alert: CostAlert }),
  Schema.Struct({ type: Schema.Literal("cost.budget.updated"), budget: CostBudget }),
]);
export type CostStreamEvent = typeof CostStreamEvent.Type;

export class CostTrackingError extends Schema.TaggedErrorClass<CostTrackingError>()(
  "CostTrackingError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
