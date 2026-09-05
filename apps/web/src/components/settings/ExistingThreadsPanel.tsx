import { useAtomValue } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, type ExistingThread, ProviderInstanceId } from "@t3tools/contracts";
import { useRef, useState } from "react";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment, EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

function ConnectedExistingThreads({ environmentId }: { environmentId: EnvironmentId }) {
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const supported = providers.filter(
    (p) => p.enabled && (p.driver === "codex" || p.driver === "claudeAgent"),
  );
  const [instanceId, setInstanceId] = useState("");
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<ReadonlyArray<ExistingThread>>([]);
  const [notices, setNotices] = useState<ReadonlyArray<string>>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [released, setReleased] = useState(false);
  const requestId = useRef(0);
  const list = useAtomCommand(serverEnvironment.listExistingThreads, { reportFailure: false });
  const importThread = useAtomCommand(serverEnvironment.importExistingThread, {
    reportFailure: false,
  });
  const navigate = useNavigate();
  const find = async () => {
    if (!instanceId || busy) return;
    const request = ++requestId.current;
    setBusy(true);
    setError(null);
    setSelected(null);
    setReleased(false);
    const result = await list({
      environmentId,
      input: { instanceId: ProviderInstanceId.make(instanceId) },
    });
    if (request !== requestId.current) return;
    setBusy(false);
    setSearched(true);
    if (result._tag === "Success") {
      setThreads(result.value.threads);
      setNotices(result.value.notices);
    } else {
      setThreads([]);
      setNotices([]);
      setError(String(squashAtomCommandFailure(result)));
    }
  };
  const continueThread = async (thread: ExistingThread) => {
    if (!released || busy) return;
    setBusy(true);
    setError(null);
    const result = await importThread({
      environmentId,
      input: { instanceId: thread.instanceId, id: thread.id, sessionReleased: true },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setError(String(squashAtomCommandFailure(result)));
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: result.value.threadId },
    });
  };
  const filtered = threads.filter((t) =>
    `${t.title}\n${t.cwd}\n${t.sessionId}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <SettingsSection title="Existing conversations">
      <p className="text-sm text-muted-foreground">
        Find conversations from official T3 and provider CLIs on this environment's computer. Codex
        and Claude are supported.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-48 flex-1 gap-2 text-sm">
          Provider account
          <select
            aria-label="Provider account"
            className="h-9 rounded-md border border-input bg-background px-3 text-foreground"
            value={instanceId}
            disabled={busy}
            onChange={(e) => {
              requestId.current++;
              setInstanceId(e.target.value);
              setThreads([]);
              setNotices([]);
              setSearched(false);
              setError(null);
              setSelected(null);
              setReleased(false);
            }}
          >
            <option value="">Choose a provider account</option>
            {supported.map((p) => (
              <option key={p.instanceId} value={p.instanceId}>
                {p.displayName ?? (p.driver === "codex" ? "Codex" : "Claude")}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!instanceId || busy} onClick={() => void find()}>
          {busy ? "Loading…" : searched ? "Refresh" : "Find conversations"}
        </Button>
      </div>
      {supported.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Enable a Codex or Claude account in{" "}
          <Link to="/settings/providers" className="underline">
            Providers
          </Link>{" "}
          to get started.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Choose the account that originally ran the conversation. Its session files must still be
        available. Official T3 titles are read from the default .t3 profile.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notices.map((notice) => (
        <p key={notice} role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      ))}
      {threads.length > 0 && (
        <label className="grid gap-2 text-sm">
          Filter conversations
          <input
            className="h-9 rounded-md border border-input bg-background px-3"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, folder, or session ID"
          />
        </label>
      )}
      {searched && !busy && filtered.length === 0 && (
        <p role="status" className="py-6 text-sm text-muted-foreground">
          {threads.length
            ? "No matching conversations."
            : "No sessions found for this provider account. Check its home directory in Providers."}
        </p>
      )}
      <ul className="divide-y divide-border">
        {filtered.map((thread) => (
          <li key={thread.id} className="py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{thread.title}</p>
                <p className="mt-1 break-all text-xs text-muted-foreground">{thread.cwd}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {thread.source === "official-t3" ? "Official T3" : "Provider CLI"} ·{" "}
                  {new Date(thread.updatedAt).toLocaleDateString()}
                </p>
              </div>
              {thread.importedThreadId ? (
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: thread.importedThreadId }}
                  className="text-sm underline"
                >
                  Open
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !!thread.unavailableReason}
                  onClick={() => {
                    setSelected(thread.id);
                    setReleased(false);
                  }}
                >
                  Continue
                </Button>
              )}
            </div>
            {thread.unavailableReason && !thread.importedThreadId && (
              <p className="mt-2 text-xs text-muted-foreground">{thread.unavailableReason}</p>
            )}
            {selected === thread.id && (
              <div className="mt-4 grid gap-3 rounded-md bg-muted/40 p-3">
                <p className="text-sm">
                  Text history will be imported here. Your next message continues the original
                  provider session. T3-specific plans, attachments, and checkpoints are not
                  imported.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={released}
                    onChange={(e) => setReleased(e.target.checked)}
                    disabled={busy}
                  />
                  I have stopped this session in the other app or CLI.
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!released || busy}
                    onClick={() => void continueThread(thread)}
                  >
                    {busy ? "Importing…" : "Import and open"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setSelected(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
export function ExistingThreadsPanel() {
  const environmentId = usePrimaryEnvironmentId();
  return (
    <SettingsPageContainer>
      {environmentId ? (
        <ConnectedExistingThreads key={environmentId} environmentId={environmentId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Connect to an environment to find existing conversations.
        </p>
      )}
    </SettingsPageContainer>
  );
}
