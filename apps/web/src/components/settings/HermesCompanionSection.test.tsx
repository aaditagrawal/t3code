import { AsyncResult } from "effect/unstable/reactivity";
import type { ReactElement } from "react";
import {
  EnvironmentId,
  ProviderInstanceId,
  type HermesGatewayInstanceStatus,
} from "@t3tools/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const atoms = vi.hoisted(() => ({
  getStatus: Symbol("getStatus"),
  createEnrollment: Symbol("createEnrollment"),
  revoke: Symbol("revoke"),
  remove: Symbol("remove"),
}));

const commands = vi.hoisted(() => ({
  getStatus: vi.fn(),
  createEnrollment: vi.fn(),
  revoke: vi.fn(),
  remove: vi.fn(),
}));

const effects = vi.hoisted(() => ({
  current: undefined as (() => void | (() => void)) | undefined,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: (effect: () => void | (() => void)) => {
      effects.current = effect;
    },
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("../../state/server", () => ({
  serverEnvironment: {
    hermesGatewayGetInstanceStatus: atoms.getStatus,
    hermesGatewayCreateEnrollment: atoms.createEnrollment,
    hermesGatewayRevokeInstance: atoms.revoke,
    hermesGatewayRemoveInstance: atoms.remove,
  },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) => {
    if (atom === atoms.getStatus) return commands.getStatus;
    if (atom === atoms.createEnrollment) return commands.createEnrollment;
    if (atom === atoms.revoke) return commands.revoke;
    return commands.remove;
  },
}));

vi.mock("../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn() }),
}));

import { HermesCompanionSection } from "./HermesCompanionSection";

const environmentId = EnvironmentId.make("local");
const instanceId = ProviderInstanceId.make("hermes");

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function renderSection(): ReactElement<Record<string, unknown>> {
  hooks.beginRender();
  return HermesCompanionSection({
    environmentId,
    instanceId,
    nickname: "Hermes",
  }) as ReactElement<Record<string, unknown>>;
}

function refreshButton(section: ReactElement<Record<string, unknown>>) {
  return visitElements(section, (element) => {
    const children = element.props.children;
    return Array.isArray(children) && children.includes(" Refresh");
  });
}

function connectedStatus(): HermesGatewayInstanceStatus {
  return {
    instanceId,
    nickname: "Hermes",
    status: "connected",
    connectorUrl: "https://t3.example/api/hermes-gateway/ws",
    lastConnectedAt: "2026-08-17T00:00:00.000Z",
    pluginVersion: "1.0.0",
    hermesVersion: "1.0.0",
    model: null,
    connectionGeneration: 1,
    activeSessionCount: 1,
    protocolVersion: 4,
    capabilities: null,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("HermesCompanionSection", () => {
  beforeEach(() => {
    hooks.reset();
    effects.current = undefined;
    commands.getStatus.mockReset();
    commands.createEnrollment.mockReset();
    commands.revoke.mockReset();
    commands.remove.mockReset();
    vi.stubGlobal("window", {
      location: { origin: "https://t3.example" },
      setInterval: vi.fn(),
      clearInterval: vi.fn(),
    });
  });

  it("releases foreground pending state when a quiet poll supersedes the response", async () => {
    const foreground = deferred<AsyncResult.AsyncResult<HermesGatewayInstanceStatus, unknown>>();
    const quiet = deferred<AsyncResult.AsyncResult<HermesGatewayInstanceStatus, unknown>>();
    commands.getStatus.mockReturnValueOnce(foreground.promise).mockReturnValueOnce(quiet.promise);

    renderSection();
    effects.current?.();
    expect(commands.getStatus).toHaveBeenCalledTimes(1);
    expect(refreshButton(renderSection())?.props.disabled).toBe(true);

    const quietPoll = vi.mocked(window.setInterval).mock.calls[0]?.[0];
    expect(quietPoll).toBeTypeOf("function");
    if (typeof quietPoll === "function") quietPoll();
    expect(commands.getStatus).toHaveBeenCalledTimes(2);

    quiet.resolve(AsyncResult.success(connectedStatus()));
    await flushPromises();
    foreground.resolve(AsyncResult.success(connectedStatus()));
    await flushPromises();

    expect(refreshButton(renderSection())?.props.disabled).toBe(false);
  });
});
