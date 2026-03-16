import { spawn } from "node:child_process";

import {
  DEFAULT_HOSTNAME,
  DEFAULT_PORT,
  SERVER_PROBE_TIMEOUT_MS,
  SERVER_START_TIMEOUT_MS,
  type KiloProviderOptions,
  type KiloClient,
  type OpencodeClientOptions,
  type KiloSdkModule,
  type SharedServerState,
} from "./types.ts";
import { buildAuthHeader, parseServerUrl } from "./utils.ts";

/**
 * Probes the Kilo server health endpoint to check if it's running.
 */
export async function probeServer(baseUrl: string, authHeader?: string): Promise<boolean> {
  const response = await fetch(`${baseUrl}/global/health`, {
    method: "GET",
    ...(authHeader ? { headers: { Authorization: authHeader } } : {}),
    signal: AbortSignal.timeout(SERVER_PROBE_TIMEOUT_MS),
  }).catch(() => undefined);
  return response?.ok === true;
}

/**
 * Creates a Kilo SDK client by dynamically importing the OpenCode SDK.
 * Kilo is a fork of OpenCode and exposes the same HTTP+SSE API.
 */
export async function createClient(options: OpencodeClientOptions): Promise<KiloClient> {
  const sdkModuleId = "@opencode-ai/sdk/v2/client";
  const sdk = (await import(sdkModuleId)) as KiloSdkModule;
  return sdk.createOpencodeClient(options);
}

/**
 * Ensures a Kilo server is running, either by connecting to an existing
 * one or spawning a new process. Returns the shared server state.
 */
export async function ensureServer(
  options: KiloProviderOptions | undefined,
  cached: {
    server: SharedServerState | undefined;
    serverPromise: Promise<SharedServerState> | undefined;
  },
): Promise<{
  state: SharedServerState;
  serverPromise: Promise<SharedServerState> | undefined;
}> {
  if (cached.server) {
    return { state: cached.server, serverPromise: cached.serverPromise };
  }
  if (cached.serverPromise) {
    const state = await cached.serverPromise;
    return { state, serverPromise: cached.serverPromise };
  }

  const serverPromise = spawnOrConnect(options);
  const state = await serverPromise;
  return { state, serverPromise };
}

async function spawnOrConnect(options?: KiloProviderOptions): Promise<SharedServerState> {
  const authHeader = buildAuthHeader(options?.username, options?.password);

  if (options?.serverUrl) {
    return {
      baseUrl: options.serverUrl,
      ...(authHeader ? { authHeader } : {}),
    };
  }

  const hostname = options?.hostname ?? DEFAULT_HOSTNAME;
  const port = Math.trunc(options?.port ?? DEFAULT_PORT);
  const baseUrl = `http://${hostname}:${port}`;
  const healthy = await probeServer(baseUrl, authHeader);
  if (healthy) {
    return {
      baseUrl,
      ...(authHeader ? { authHeader } : {}),
    };
  }

  const binaryPath = options?.binaryPath ?? "kilo";
  const child = spawn(binaryPath, ["serve", `--hostname=${hostname}`, `--port=${port}`], {
    env: {
      ...process.env,
      ...(options?.username ? { KILO_SERVER_USERNAME: options.username } : {}),
      ...(options?.password ? { KILO_SERVER_PASSWORD: options.password } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const startedBaseUrl = await new Promise<string>((resolve, reject) => {
    let output = "";

    const onChunk = (chunk: Buffer) => {
      output += chunk.toString();
      const url = parseServerUrl(output);
      if (!url) {
        return;
      }
      cleanup();
      resolve(url);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code: number | null) => {
      cleanup();
      void probeServer(baseUrl, authHeader).then((reuse) => {
        if (reuse) {
          resolve(baseUrl);
          return;
        }
        const detail = output.trim().replaceAll(/\s+/g, " ").slice(0, 400);
        reject(
          new Error(
            `Kilo server exited before startup completed (code ${code})${
              detail.length > 0 ? `: ${detail}` : ""
            }`,
          ),
        );
      });
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.off("data", onChunk);
      child.stderr.off("data", onChunk);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const timeout = setTimeout(() => {
      cleanup();
      try {
        child.kill();
      } catch {
        // Process may already be dead.
      }
      reject(
        new Error(`Timed out waiting for Kilo server to start after ${SERVER_START_TIMEOUT_MS}ms`),
      );
    }, SERVER_START_TIMEOUT_MS);

    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.once("error", onError);
    child.once("exit", onExit);
  });

  return {
    baseUrl: startedBaseUrl,
    child,
    ...(authHeader ? { authHeader } : {}),
  };
}
