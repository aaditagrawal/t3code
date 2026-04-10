import { Schema } from "effect";
import { IsoDateTime, NonNegativeInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const RoutingStrategyKind = Schema.Literals([
  "round-robin",
  "cost-optimized",
  "latency-optimized",
  "capability-match",
  "manual",
]);
export type RoutingStrategyKind = typeof RoutingStrategyKind.Type;

export const FailoverTrigger = Schema.Literals([
  "error",
  "timeout",
  "rate-limit",
  "budget-exceeded",
]);
export type FailoverTrigger = typeof FailoverTrigger.Type;

export const ProviderHealthStatus = Schema.Literals(["healthy", "degraded", "down", "unknown"]);
export type ProviderHealthStatus = typeof ProviderHealthStatus.Type;

export const ProviderHealth = Schema.Struct({
  provider: ProviderKind,
  status: ProviderHealthStatus,
  latencyMs: Schema.NullOr(NonNegativeInt),
  errorRate: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  lastCheckedAt: IsoDateTime,
  lastErrorAt: Schema.NullOr(IsoDateTime),
  consecutiveFailures: NonNegativeInt,
});
export type ProviderHealth = typeof ProviderHealth.Type;

export const FailoverPolicy = Schema.Struct({
  projectId: Schema.NullOr(ProjectId),
  triggers: Schema.Array(FailoverTrigger),
  fallbackChain: Schema.Array(ProviderKind),
  maxRetries: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 2)),
  retryDelayMs: NonNegativeInt.pipe(Schema.withDecodingDefault(() => 1000)),
  enabled: Schema.Boolean,
});
export type FailoverPolicy = typeof FailoverPolicy.Type;

export const RoutingRule = Schema.Struct({
  name: TrimmedNonEmptyString,
  projectId: Schema.NullOr(ProjectId),
  strategy: RoutingStrategyKind,
  preferredProviders: Schema.Array(ProviderKind),
  excludedProviders: Schema.Array(ProviderKind),
  taskPatterns: Schema.Array(TrimmedNonEmptyString),
  failoverPolicy: FailoverPolicy,
  priority: NonNegativeInt,
});
export type RoutingRule = typeof RoutingRule.Type;

export const RoutingDecision = Schema.Struct({
  selectedProvider: ProviderKind,
  reason: TrimmedNonEmptyString,
  alternatives: Schema.Array(ProviderKind),
  failoverAttempt: NonNegativeInt,
  decidedAt: IsoDateTime,
});
export type RoutingDecision = typeof RoutingDecision.Type;

export const RoutingGetHealthInput = Schema.Struct({});

export const RoutingGetHealthResult = Schema.Struct({
  providers: Schema.Array(ProviderHealth),
  updatedAt: IsoDateTime,
});
export type RoutingGetHealthResult = typeof RoutingGetHealthResult.Type;

export const RoutingSetRulesInput = Schema.Struct({
  rules: Schema.Array(RoutingRule),
});
export type RoutingSetRulesInput = typeof RoutingSetRulesInput.Type;

export const RoutingGetRulesResult = Schema.Struct({
  rules: Schema.Array(RoutingRule),
});
export type RoutingGetRulesResult = typeof RoutingGetRulesResult.Type;

export const RoutingStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("routing.health.updated"), health: ProviderHealth }),
  Schema.Struct({ type: Schema.Literal("routing.decision"), decision: RoutingDecision }),
  Schema.Struct({
    type: Schema.Literal("routing.failover"),
    fromProvider: ProviderKind,
    toProvider: ProviderKind,
    trigger: FailoverTrigger,
    detail: Schema.String,
  }),
]);
export type RoutingStreamEvent = typeof RoutingStreamEvent.Type;

export class ProviderRoutingError extends Schema.TaggedErrorClass<ProviderRoutingError>()(
  "ProviderRoutingError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
