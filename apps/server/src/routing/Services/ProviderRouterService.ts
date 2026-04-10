/**
 * ProviderRouterService - Service interface for multi-provider routing.
 *
 * Manages provider health tracking, routing rules with failover policies,
 * and provider selection based on strategy, health, and task context.
 *
 * @module ProviderRouterService
 */
import type {
  ProviderHealth,
  RoutingDecision,
  RoutingGetHealthResult,
  RoutingGetRulesResult,
  RoutingRule,
  RoutingSetRulesInput,
  RoutingStreamEvent,
  ProviderHealthStatus,
  ProviderKind,
} from "@t3tools/contracts";
import { Effect, Layer, PubSub, ServiceMap, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface ProviderRouterServiceShape {
  /**
   * Retrieve health status for all known providers.
   */
  readonly getHealth: () => Effect.Effect<RoutingGetHealthResult>;

  /**
   * Create or replace the full set of routing rules.
   */
  readonly setRules: (input: RoutingSetRulesInput) => Effect.Effect<RoutingGetRulesResult>;

  /**
   * Retrieve the current routing rules.
   */
  readonly getRules: () => Effect.Effect<RoutingGetRulesResult>;

  /**
   * Select the best provider for a task based on rules, health, and context.
   */
  readonly selectProvider: (
    projectId: string,
    taskHint: string | null,
  ) => Effect.Effect<RoutingDecision>;

  /**
   * Report a provider's health status (updates in-memory health map).
   */
  readonly reportHealth: (
    provider: ProviderKind,
    status: ProviderHealthStatus,
  ) => Effect.Effect<void>;

  /**
   * Live stream of routing events (health changes, decisions, failovers).
   *
   * Each access creates a fresh PubSub subscription so multiple consumers
   * independently receive all events.
   */
  readonly streamEvents: Stream.Stream<RoutingStreamEvent>;
}

export class ProviderRouterService extends ServiceMap.Service<
  ProviderRouterService,
  ProviderRouterServiceShape
>()("t3/routing/Services/ProviderRouterService") {}

const ALL_PROVIDERS: ProviderKind[] = [
  "codex",
  "copilot",
  "claudeAgent",
  "cursor",
  "opencode",
  "geminiCli",
  "amp",
  "kilo",
];

const makeProviderRouterService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pubsub = yield* PubSub.unbounded<RoutingStreamEvent>();

  // In-memory health map
  const healthMap = new Map<ProviderKind, ProviderHealth>(
    ALL_PROVIDERS.map((p) => [
      p,
      {
        provider: p,
        status: "unknown" as ProviderHealthStatus,
        latencyMs: null,
        errorRate: 0,
        lastCheckedAt: new Date().toISOString(),
        lastErrorAt: null,
        consecutiveFailures: 0,
      },
    ]),
  );

  const getHealth: ProviderRouterServiceShape["getHealth"] = () =>
    Effect.succeed({
      providers: Array.from(healthMap.values()),
      updatedAt: new Date().toISOString(),
    });

  const setRules: ProviderRouterServiceShape["setRules"] = (input) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM routing_rules`;
      for (const rule of input.rules) {
        yield* sql`INSERT INTO routing_rules (name, project_id, strategy, preferred_providers, excluded_providers, task_patterns, failover_policy, priority)
          VALUES (${rule.name}, ${rule.projectId ?? null}, ${rule.strategy}, ${JSON.stringify(rule.preferredProviders)}, ${JSON.stringify(rule.excludedProviders)}, ${JSON.stringify(rule.taskPatterns)}, ${JSON.stringify(rule.failoverPolicy)}, ${rule.priority})`;
      }
      return { rules: input.rules };
    }).pipe(Effect.orDie);

  const getRules: ProviderRouterServiceShape["getRules"] = () =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        name: string;
        project_id: string | null;
        strategy: string;
        preferred_providers: string;
        excluded_providers: string;
        task_patterns: string;
        failover_policy: string;
        priority: number;
      }>`SELECT * FROM routing_rules ORDER BY priority DESC`;
      return {
        rules: rows.map((r) => ({
          name: r.name as RoutingRule["name"],
          projectId: (r.project_id ?? null) as RoutingRule["projectId"],
          strategy: r.strategy as RoutingRule["strategy"],
          preferredProviders: JSON.parse(r.preferred_providers) as ProviderKind[],
          excludedProviders: JSON.parse(r.excluded_providers) as ProviderKind[],
          taskPatterns: JSON.parse(r.task_patterns) as string[],
          failoverPolicy: JSON.parse(r.failover_policy) as RoutingRule["failoverPolicy"],
          priority: r.priority,
        })),
      };
    }).pipe(Effect.orDie);

  const selectProvider: ProviderRouterServiceShape["selectProvider"] = (projectId, _taskHint) =>
    Effect.gen(function* () {
      const { rules } = yield* getRules();
      const now = new Date().toISOString();

      // Find first matching rule for this project
      const matchingRule = rules.find((r) => r.projectId === null || r.projectId === projectId);

      const healthyProviders = Array.from(healthMap.values())
        .filter((h) => h.status !== "down")
        .map((h) => h.provider);

      let selected: ProviderKind = "claudeAgent";
      let reason = "default";
      let alternatives: ProviderKind[] = [];

      if (matchingRule && matchingRule.preferredProviders.length > 0) {
        const preferred = matchingRule.preferredProviders.filter(
          (p) => healthyProviders.includes(p) && !matchingRule.excludedProviders.includes(p),
        );
        if (preferred.length > 0) {
          selected = preferred[0]!;
          alternatives = preferred.slice(1);
          reason = `rule:${matchingRule.name}:${matchingRule.strategy}`;
        }
      } else {
        alternatives = healthyProviders.filter((p) => p !== selected);
      }

      const decision: RoutingDecision = {
        selectedProvider: selected,
        reason: reason as RoutingDecision["reason"],
        alternatives,
        failoverAttempt: 0,
        decidedAt: now,
      };

      yield* PubSub.publish(pubsub, { type: "routing.decision" as const, decision });
      return decision;
    }).pipe(Effect.orDie);

  const reportHealth: ProviderRouterServiceShape["reportHealth"] = (provider, status) =>
    Effect.gen(function* () {
      const existing = healthMap.get(provider);
      const now = new Date().toISOString();
      const updated: ProviderHealth = {
        provider,
        status,
        latencyMs: existing?.latencyMs ?? null,
        errorRate:
          status === "down"
            ? Math.min(1, (existing?.errorRate ?? 0) + 0.1)
            : Math.max(0, (existing?.errorRate ?? 0) - 0.05),
        lastCheckedAt: now,
        lastErrorAt: status === "down" ? now : (existing?.lastErrorAt ?? null),
        consecutiveFailures: status === "down" ? (existing?.consecutiveFailures ?? 0) + 1 : 0,
      };
      healthMap.set(provider, updated);
      yield* PubSub.publish(pubsub, { type: "routing.health.updated" as const, health: updated });
    });

  return {
    getHealth,
    setRules,
    getRules,
    selectProvider,
    reportHealth,
    streamEvents: Stream.fromPubSub(pubsub),
  };
});

export const ProviderRouterServiceLive = Layer.effect(
  ProviderRouterService,
  makeProviderRouterService,
);
