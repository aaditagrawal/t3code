"use client";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CopyIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  EnvironmentId,
  HermesGatewayEnrollmentResult,
  HermesGatewayInstanceStatus,
  ProviderInstanceId,
} from "@t3tools/contracts";

import { useAtomCommand } from "../../state/use-atom-command";
import { serverEnvironment } from "../../state/server";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { requestConfirmDialog } from "../../confirmDialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

const STATUS_LABELS: Record<HermesGatewayInstanceStatus["status"], string> = {
  offline: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  "upgrade-required": "Plugin upgrade required",
  revoked: "Revoked",
};

function defaultConnectorUrl(): string {
  return typeof window === "undefined"
    ? ""
    : new URL("/api/hermes-gateway/ws", window.location.origin).toString();
}

function messageFromUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return "The Hermes companion request failed.";
}

function isInstanceNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "instance-not-found"
  );
}

function statusGuidance(status: HermesGatewayInstanceStatus["status"] | null): string {
  switch (status) {
    case "connected":
      return "The companion is connected. Ordinary chats still run through hermes-acp.";
    case "connecting":
      return "The companion is completing its authenticated handshake.";
    case "upgrade-required":
      return "Re-run the plugin install script on the Hermes host, then restart hermes gateway.";
    case "revoked":
      return "Create a new one-time enrollment to reconnect this Hermes host.";
    case "offline":
      return "Run the enrollment command on the Hermes host, then restart hermes gateway.";
    case null:
      return "Install the shipped plugin on the Hermes host, then create a one-time enrollment.";
  }
}

export function HermesCompanionSection(props: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly nickname: string;
}) {
  const [status, setStatus] = useState<HermesGatewayInstanceStatus | null>(null);
  const [enrollment, setEnrollment] = useState<HermesGatewayEnrollmentResult | null>(null);
  const [connectorUrl, setConnectorUrl] = useState(defaultConnectorUrl);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connectorUrlHasLocalEdits = useRef(false);
  const refreshGeneration = useRef(0);
  const foregroundRefreshCount = useRef(0);
  const getStatus = useAtomCommand(serverEnvironment.hermesGatewayGetInstanceStatus, {
    reportFailure: false,
  });
  const createEnrollment = useAtomCommand(serverEnvironment.hermesGatewayCreateEnrollment);
  const revoke = useAtomCommand(serverEnvironment.hermesGatewayRevokeInstance);
  const remove = useAtomCommand(serverEnvironment.hermesGatewayRemoveInstance);
  const { copyToClipboard } = useCopyToClipboard<string>({
    onCopy: () => toastManager.add({ type: "success", title: "Enrollment command copied" }),
  });

  const refresh = useCallback(
    async (quiet = false) => {
      const generation = ++refreshGeneration.current;
      if (!quiet) {
        foregroundRefreshCount.current += 1;
        setPending(true);
      }
      try {
        const result = await getStatus({
          environmentId: props.environmentId,
          input: { instanceId: props.instanceId },
        });
        // A management operation or a newer poll superseded this read. Applying
        // its stale not-enrolled result would hide a just-created enrollment (or
        // erase the actionable error from a failed operation).
        if (generation !== refreshGeneration.current) return;
        if (result._tag === "Success") {
          setStatus(result.value);
          if (!connectorUrlHasLocalEdits.current) setConnectorUrl(result.value.connectorUrl);
          if (!quiet) setError(null);
        } else {
          const failure = squashAtomCommandFailure(result);
          if (isInstanceNotFoundError(failure)) {
            // A missing gateway record is the normal, never-enrolled state.
            setStatus(null);
            if (!quiet) setError(null);
          } else if (!quiet) {
            setError(messageFromUnknownError(failure));
          }
        }
      } finally {
        if (!quiet) {
          foregroundRefreshCount.current -= 1;
          if (foregroundRefreshCount.current === 0) setPending(false);
        }
      }
    },
    [getStatus, props.environmentId, props.instanceId],
  );

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(true), 5_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const enroll = async () => {
    if (!connectorUrl.trim()) return;
    refreshGeneration.current += 1;
    setPending(true);
    setError(null);
    const result = await createEnrollment({
      environmentId: props.environmentId,
      input: {
        instanceId: props.instanceId,
        nickname: props.nickname.trim() || "Hermes companion",
        connectorUrl: connectorUrl.trim(),
      },
    });
    if (result._tag === "Success") {
      setEnrollment(result.value);
      connectorUrlHasLocalEdits.current = false;
      setConnectorUrl(result.value.connectorUrl);
      toastManager.add({ type: "success", title: "One-time enrollment created" });
      await refresh(true);
    } else {
      setError(messageFromUnknownError(squashAtomCommandFailure(result)));
    }
    setPending(false);
  };

  const revokeOrRemove = async (action: "revoke" | "remove") => {
    const prompt =
      action === "revoke"
        ? "Revoke this companion's access? It will need to be enrolled again."
        : "Remove this companion enrollment record? Your Hermes provider remains configured.";
    if (!(await requestConfirmDialog(prompt, { variant: "destructive" }))) return;
    refreshGeneration.current += 1;
    setPending(true);
    setError(null);
    if (action === "revoke") {
      const result = await revoke({
        environmentId: props.environmentId,
        input: { instanceId: props.instanceId },
      });
      if (result._tag === "Success") {
        refreshGeneration.current += 1;
        setEnrollment(null);
        setStatus(result.value);
      } else {
        setError(messageFromUnknownError(squashAtomCommandFailure(result)));
      }
    } else {
      const result = await remove({
        environmentId: props.environmentId,
        input: { instanceId: props.instanceId },
      });
      if (result._tag === "Success") {
        refreshGeneration.current += 1;
        setEnrollment(null);
        setStatus(null);
      } else {
        setError(messageFromUnknownError(squashAtomCommandFailure(result)));
      }
    }
    setPending(false);
  };

  return (
    <section className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div>
        <h4 className="text-sm font-medium">Hermes companion (optional)</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Ordinary chats continue to use hermes-acp. The companion is only for proactive Home, cron,
          handoff, and media delivery.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          On the Hermes host, first run this repository&apos;s{" "}
          <code>integrations/hermes-t3-gateway/install.sh</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>
          <strong>{status ? STATUS_LABELS[status.status] : "Not enrolled"}</strong>
          {status ? (
            <>
              {status.protocolVersion ? ` · protocol v${status.protocolVersion}` : ""}
              {status.activeSessionCount ? ` · ${status.activeSessionCount} active session(s)` : ""}
              {status.pluginVersion ? ` · plugin ${status.pluginVersion}` : ""}
            </>
          ) : null}
        </span>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void refresh()}>
          <RefreshCwIcon className="size-3.5" /> Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{statusGuidance(status?.status ?? null)}</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {!status || status.status === "revoked" ? (
        <div className="space-y-2">
          <label
            className="block text-xs font-medium"
            htmlFor={`hermes-connector-${props.instanceId}`}
          >
            Connector URL
          </label>
          <Input
            id={`hermes-connector-${props.instanceId}`}
            type="url"
            value={connectorUrl}
            placeholder="https://your-t3-server.example"
            onChange={(event) => {
              connectorUrlHasLocalEdits.current = true;
              setConnectorUrl(event.target.value);
            }}
          />
          <Button
            size="sm"
            disabled={pending || !connectorUrl.trim()}
            onClick={() => void enroll()}
          >
            Create one-time enrollment
          </Button>
        </div>
      ) : null}

      {enrollment ? (
        <div className="space-y-2 rounded-md bg-background p-2 text-xs">
          <p>
            Run this once in the Hermes environment before{" "}
            {new Date(enrollment.expiresAt).toLocaleString()}.
          </p>
          <code className="block break-all select-all rounded bg-muted p-2">
            {enrollment.command}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyToClipboard(enrollment.command, enrollment.command)}
          >
            <CopyIcon className="size-3.5" /> Copy command
          </Button>
          <p className="text-muted-foreground">
            The command contains a one-time enrollment token. Keep it private.
          </p>
        </div>
      ) : null}

      {status ? (
        <div className="flex gap-2">
          {status.status !== "revoked" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void revokeOrRemove("revoke")}
            >
              Revoke access
            </Button>
          ) : null}
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => void revokeOrRemove("remove")}
          >
            Remove companion
          </Button>
        </div>
      ) : null}
    </section>
  );
}
