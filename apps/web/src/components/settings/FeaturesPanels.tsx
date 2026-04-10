import { useEffect, useState } from "react";
import {
  ActivityIcon,
  BrainIcon,
  GitForkIcon,
  LayoutGridIcon,
  NetworkIcon,
  ShieldCheckIcon,
  UsersIcon,
  WalletIcon,
  WorkflowIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { useCostStore, subscribeCostEvents } from "../../costStore";
import { useAuditStore, subscribeAuditEvents } from "../../auditStore";
import { useCIStore, subscribeCIEvents } from "../../ciStore";
import { useRoutingStore, subscribeRoutingEvents } from "../../routingStore";
import { usePipelineStore, subscribePipelineEvents } from "../../pipelineStore";
import { useWorkflowStore } from "../../workflowStore";
import { useTaskStore, subscribeTaskEvents } from "../../taskStore";
import { useMemoryStore } from "../../memoryStore";
import { usePresenceStore, subscribePresenceEvents } from "../../presenceStore";

// ── Types ──────────────────────────────────────────────────────────────

type FeatureTab =
  | "cost"
  | "audit"
  | "ci"
  | "routing"
  | "pipelines"
  | "workflows"
  | "tasks"
  | "memory"
  | "presence";

interface TabConfig {
  id: FeatureTab;
  label: string;
  icon: typeof WalletIcon;
  description: string;
}

const TABS: readonly TabConfig[] = [
  {
    id: "cost",
    label: "Cost & Tokens",
    icon: WalletIcon,
    description: "Track token usage and budget limits",
  },
  {
    id: "audit",
    label: "Audit Log",
    icon: ShieldCheckIcon,
    description: "Structured activity log",
  },
  { id: "ci", label: "CI / CD", icon: GitForkIcon, description: "CI pipeline status and feedback" },
  {
    id: "routing",
    label: "Routing",
    icon: NetworkIcon,
    description: "Provider health and routing rules",
  },
  {
    id: "pipelines",
    label: "Pipelines",
    icon: WorkflowIcon,
    description: "Multi-agent pipeline execution",
  },
  {
    id: "workflows",
    label: "Workflows",
    icon: LayoutGridIcon,
    description: "Reusable workflow templates",
  },
  { id: "tasks", label: "Tasks", icon: ActivityIcon, description: "Task decomposition trees" },
  { id: "memory", label: "Memory", icon: BrainIcon, description: "Project knowledge base" },
  {
    id: "presence",
    label: "Presence",
    icon: UsersIcon,
    description: "Shared sessions and presence",
  },
] as const;

// ── Cost Panel ─────────────────────────────────────────────────────────

function CostPanel() {
  const { summary, budgets, recentAlerts, isLoading, error, fetchSummary, fetchBudgets } =
    useCostStore();

  useEffect(() => {
    const unsub = subscribeCostEvents();
    void fetchSummary();
    void fetchBudgets();
    return unsub;
  }, [fetchSummary, fetchBudgets]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Usage Summary</h3>
        {isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        {summary && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div className="rounded-md border bg-card p-3">
              <p className="text-xs text-muted-foreground">Total Cost</p>
              <p className="mt-1 text-lg font-semibold">
                ${(summary.totalCostCents / 100).toFixed(4)}
              </p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-xs text-muted-foreground">Input Tokens</p>
              <p className="mt-1 text-lg font-semibold">
                {summary.totalInputTokens.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-xs text-muted-foreground">Output Tokens</p>
              <p className="mt-1 text-lg font-semibold">
                {summary.totalOutputTokens.toLocaleString()}
              </p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-xs text-muted-foreground">Thinking Tokens</p>
              <p className="mt-1 text-lg font-semibold">
                {summary.totalThinkingTokens.toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </div>

      {budgets.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Budgets</h3>
          <div className="mt-2 space-y-2">
            {budgets.map((b) => {
              const pct =
                b.limitCents > 0 ? Math.round((b.currentSpendCents / b.limitCents) * 100) : 0;
              return (
                <div key={b.id} className="rounded-md border bg-card p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{b.projectId ?? "Global"}</span>
                    <span
                      className={cn(
                        "text-xs",
                        pct >= 90 ? "text-red-500" : "text-muted-foreground",
                      )}
                    >
                      {pct}% of ${(b.limitCents / 100).toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full", pct >= 90 ? "bg-red-500" : "bg-primary")}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {recentAlerts.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Recent Alerts</h3>
          <div className="mt-2 space-y-1">
            {recentAlerts.slice(0, 5).map((a, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/10 p-2 text-xs"
              >
                <span className="text-amber-600">{a.percentUsed}% budget used</span>
                <span className="text-muted-foreground">{a.alertedAt}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {summary?.byProvider && summary.byProvider.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">By Provider</h3>
          <div className="mt-2 space-y-1">
            {summary.byProvider.map((p) => (
              <div key={p.provider} className="flex items-center justify-between text-xs">
                <span className="capitalize">{p.provider}</span>
                <span className="text-muted-foreground">${(p.costCents / 100).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Audit Panel ────────────────────────────────────────────────────────

function AuditPanel() {
  const { entries, total, isLoading, error, query } = useAuditStore();

  useEffect(() => {
    const unsub = subscribeAuditEvents();
    void query({ limit: 50, offset: 0 });
    return unsub;
  }, [query]);

  const SEVERITY_COLORS = {
    info: "text-blue-500",
    warning: "text-amber-500",
    critical: "text-red-500",
  } as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Activity Log ({total} total)</h3>
        <Button size="sm" variant="ghost" onClick={() => void query({ limit: 50, offset: 0 })}>
          Refresh
        </Button>
      </div>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="space-y-1">
        {entries.map((e) => (
          <div key={e.id} className="flex items-start gap-2 rounded-md border bg-card p-2 text-xs">
            <span
              className={cn("mt-0.5 shrink-0 font-medium uppercase", SEVERITY_COLORS[e.severity])}
            >
              {e.severity}
            </span>
            <div className="min-w-0 flex-1">
              <span className="font-medium">{e.action}</span>
              <span className="ml-1 text-muted-foreground">{e.summary}</span>
            </div>
            <span className="shrink-0 text-muted-foreground">{e.timestamp.slice(11, 19)}</span>
          </div>
        ))}
        {entries.length === 0 && !isLoading && (
          <p className="text-xs text-muted-foreground">No audit entries yet.</p>
        )}
      </div>
    </div>
  );
}

// ── CI Panel ───────────────────────────────────────────────────────────

function CIPanel() {
  const { runsByProject, isLoading, error } = useCIStore();

  useEffect(() => {
    return subscribeCIEvents();
  }, []);

  const STATUS_COLORS = {
    queued: "text-muted-foreground",
    in_progress: "text-blue-500",
    completed: "text-green-500",
    failed: "text-red-500",
    cancelled: "text-muted-foreground",
    timed_out: "text-amber-500",
  } as const;

  const allRuns = Object.values(runsByProject).flat();

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">CI Runs</h3>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {allRuns.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">
          No CI runs tracked yet. CI runs will appear here when recorded.
        </p>
      )}
      <div className="space-y-2">
        {allRuns.slice(0, 20).map((run) => (
          <div key={run.id} className="rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{run.workflowName}</span>
              <span className={cn("text-xs", STATUS_COLORS[run.status])}>{run.status}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{run.branch}</span>
              <span>·</span>
              <span>{run.commitSha.slice(0, 7)}</span>
              {run.conclusion && (
                <>
                  <span>·</span>
                  <span>{run.conclusion}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Routing Panel ──────────────────────────────────────────────────────

function RoutingPanel() {
  const { providerHealth, rules, isLoading, error, fetchHealth, fetchRules } = useRoutingStore();

  useEffect(() => {
    const unsub = subscribeRoutingEvents();
    void fetchHealth();
    void fetchRules();
    return unsub;
  }, [fetchHealth, fetchRules]);

  const STATUS_COLORS = {
    healthy: "text-green-500",
    degraded: "text-amber-500",
    down: "text-red-500",
    unknown: "text-muted-foreground",
  } as const;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Provider Health</h3>
        {isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-2 grid grid-cols-2 gap-2">
          {providerHealth.map((h) => (
            <div
              key={h.provider}
              className="flex items-center justify-between rounded-md border bg-card p-2 text-xs"
            >
              <span className="capitalize">{h.provider}</span>
              <span className={STATUS_COLORS[h.status]}>{h.status}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium">Routing Rules ({rules.length})</h3>
        {rules.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            No routing rules configured. Default routing uses claudeAgent.
          </p>
        )}
        <div className="mt-2 space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="rounded-md border bg-card p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.name}</span>
                <span className="text-muted-foreground">
                  {r.strategy} · priority {r.priority}
                </span>
              </div>
              {r.preferredProviders.length > 0 && (
                <p className="mt-1 text-muted-foreground">
                  Preferred: {r.preferredProviders.join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Pipelines Panel ────────────────────────────────────────────────────

function PipelinesPanel() {
  const { pipelinesByProject, executions, isLoading, error } = usePipelineStore();

  useEffect(() => {
    return subscribePipelineEvents();
  }, []);

  const allPipelines = Object.values(pipelinesByProject).flat();
  const allExecutions = Object.values(executions);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Pipelines ({allPipelines.length})</h3>
        {isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        {allPipelines.length === 0 && !isLoading && (
          <p className="mt-2 text-xs text-muted-foreground">
            No pipelines defined yet. Create one via the API.
          </p>
        )}
        {allPipelines.slice(0, 10).map((p) => (
          <div key={p.id} className="mt-2 rounded-md border bg-card p-3 text-xs">
            <p className="font-medium">{p.name}</p>
            {p.description && <p className="mt-0.5 text-muted-foreground">{p.description}</p>}
            <p className="mt-1 text-muted-foreground">{p.stages.length} stages</p>
          </div>
        ))}
      </div>

      {allExecutions.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Executions</h3>
          <div className="mt-2 space-y-2">
            {allExecutions.slice(0, 10).map((e) => (
              <div key={e.id} className="rounded-md border bg-card p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{e.pipelineId}</span>
                  <span
                    className={cn(
                      e.status === "completed"
                        ? "text-green-500"
                        : e.status === "failed"
                          ? "text-red-500"
                          : e.status === "running"
                            ? "text-blue-500"
                            : "text-muted-foreground",
                    )}
                  >
                    {e.status}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {e.stages.filter((s) => s.status === "completed").length}/{e.stages.length} stages
                  complete
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Workflows Panel ────────────────────────────────────────────────────

function WorkflowsPanel() {
  const { templates, isLoading, error, fetchTemplates } = useWorkflowStore();

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const builtIn = templates.filter((t) => t.isBuiltIn);
  const custom = templates.filter((t) => !t.isBuiltIn);

  return (
    <div className="space-y-6">
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div>
        <h3 className="text-sm font-medium">Built-in Templates ({builtIn.length})</h3>
        <div className="mt-2 space-y-2">
          {builtIn.map((t) => (
            <div key={t.id} className="rounded-md border bg-card p-3 text-xs">
              <p className="font-medium">{t.name}</p>
              {t.description && <p className="mt-0.5 text-muted-foreground">{t.description}</p>}
              <p className="mt-1 text-muted-foreground">
                {t.steps.length} steps · {t.category}
              </p>
              {t.variables.length > 0 && (
                <p className="mt-0.5 text-muted-foreground">
                  Variables: {t.variables.map((v) => v.name).join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {custom.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Custom Templates ({custom.length})</h3>
          <div className="mt-2 space-y-2">
            {custom.map((t) => (
              <div key={t.id} className="rounded-md border bg-card p-3 text-xs">
                <p className="font-medium">{t.name}</p>
                {t.description && <p className="mt-0.5 text-muted-foreground">{t.description}</p>}
                <p className="mt-1 text-muted-foreground">
                  {t.steps.length} steps · {t.category}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tasks Panel ────────────────────────────────────────────────────────

function TasksPanel() {
  const { trees, isLoading, error } = useTaskStore();

  useEffect(() => {
    return subscribeTaskEvents();
  }, []);

  const allTrees = Object.values(trees);

  const STATUS_COLORS = {
    pending: "text-muted-foreground",
    "in-progress": "text-blue-500",
    completed: "text-green-500",
    failed: "text-red-500",
    blocked: "text-amber-500",
    skipped: "text-muted-foreground",
  } as const;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Task Trees ({allTrees.length})</h3>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {allTrees.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">
          No task trees yet. Decompose a prompt to create one.
        </p>
      )}
      <div className="space-y-3">
        {allTrees.slice(0, 10).map((tree) => (
          <div key={tree.id} className="rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium truncate">{tree.rootPrompt}</p>
              <span className={cn("ml-2 shrink-0 text-xs", STATUS_COLORS[tree.status])}>
                {tree.status}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{tree.tasks.length} tasks</p>
            <div className="mt-2 space-y-0.5">
              {tree.tasks.slice(0, 5).map((task) => (
                <div key={task.id} className="flex items-center gap-2 text-xs">
                  <span className={cn("shrink-0", STATUS_COLORS[task.status])}>·</span>
                  <span className="truncate text-muted-foreground">{task.title}</span>
                </div>
              ))}
              {tree.tasks.length > 5 && (
                <p className="text-xs text-muted-foreground">+{tree.tasks.length - 5} more</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Memory Panel ───────────────────────────────────────────────────────

function MemoryPanel() {
  const { entriesByProject, searchResults, isLoading, error } = useMemoryStore();

  useEffect(() => {
    // No events to subscribe — memory is CRUD-only
  }, []);

  const allEntries = Object.values(entriesByProject).flat();

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Memory Entries ({allEntries.length})</h3>
        {isLoading && <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        {allEntries.length === 0 && !isLoading && (
          <p className="mt-2 text-xs text-muted-foreground">
            No memory entries yet. Add entries to give agents persistent context about your project.
          </p>
        )}
        <div className="mt-2 space-y-2">
          {allEntries.slice(0, 10).map((e) => (
            <div key={e.id} className="rounded-md border bg-card p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium">{e.title}</span>
                <span className="text-muted-foreground">{e.kind}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-muted-foreground">{e.content}</p>
              {e.tags.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-secondary px-1 py-0.5 text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {searchResults.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">Search Results</h3>
          <div className="mt-2 space-y-2">
            {searchResults.map((r) => (
              <div key={r.entry.id} className="rounded-md border bg-card p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{r.entry.title}</span>
                  <span className="text-muted-foreground">score {r.matchScore.toFixed(2)}</span>
                </div>
                <p className="mt-1 text-muted-foreground">{r.entry.content.slice(0, 100)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Presence Panel ─────────────────────────────────────────────────────

function PresencePanel() {
  const { participantsByThread, sharesByThread, isLoading, error } = usePresenceStore();

  useEffect(() => {
    return subscribePresenceEvents();
  }, []);

  const threadIds = Object.keys(participantsByThread);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Active Sessions</h3>
      {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {threadIds.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">
          No active shared sessions. Share a thread to enable multi-user collaboration.
        </p>
      )}
      <div className="space-y-3">
        {threadIds.map((threadId) => {
          const participants = participantsByThread[threadId] ?? [];
          const share = sharesByThread[threadId];
          return (
            <div key={threadId} className="rounded-md border bg-card p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium truncate">{threadId}</p>
                {share && (
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {share.isPublic ? "public" : "private"} · {share.maxParticipants} max
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-1 text-xs">
                    <span className="size-2 rounded-full" style={{ backgroundColor: p.color }} />
                    <span>{p.displayName}</span>
                    <span className="text-muted-foreground">({p.cursor})</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Features Panel ────────────────────────────────────────────────

const TAB_PANELS: Record<FeatureTab, () => React.JSX.Element> = {
  cost: CostPanel,
  audit: AuditPanel,
  ci: CIPanel,
  routing: RoutingPanel,
  pipelines: PipelinesPanel,
  workflows: WorkflowsPanel,
  tasks: TasksPanel,
  memory: MemoryPanel,
  presence: PresencePanel,
};

export function FeaturesSettingsPanel() {
  const [activeTab, setActiveTab] = useState<FeatureTab>("cost");
  const ActivePanel = TAB_PANELS[activeTab];

  return (
    <div className="flex h-full">
      {/* Tab sidebar */}
      <div className="w-44 shrink-0 border-r pr-2">
        <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Features
        </p>
        <nav className="space-y-0.5">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  activeTab === tab.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Panel content */}
      <div className="min-w-0 flex-1 overflow-y-auto pl-6">
        <ActivePanel />
      </div>
    </div>
  );
}
