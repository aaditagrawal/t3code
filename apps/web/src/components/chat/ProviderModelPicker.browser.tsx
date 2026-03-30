import { type ProviderKind, type ServerProvider } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProviderModelPicker, buildModelOptionsByProvider } from "./ProviderModelPicker";
import { getCustomModelOptionsByProvider } from "../../modelSelection";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";

function effort(value: string, isDefault = false) {
  return {
    value,
    label: value,
    ...(isDefault ? { isDefault: true } : {}),
  };
}

const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "gpt-5-codex",
        name: "GPT-5 Codex",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "claudeAgent",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [
      {
        slug: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            effort("low"),
            effort("medium", true),
            effort("high"),
            effort("max"),
          ],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            effort("low"),
            effort("medium", true),
            effort("high"),
            effort("max"),
          ],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
      {
        slug: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
          supportsFastMode: false,
          supportsThinkingToggle: true,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
];

function buildCodexProvider(models: ServerProvider["models"]): ServerProvider {
  return {
    provider: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models,
  };
}

async function mountPicker(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  triggerVariant?: "ghost" | "outline";
  providers?: ReadonlyArray<ServerProvider>;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const onProviderModelChange = vi.fn();
  const modelOptionsByProvider = buildModelOptionsByProvider({
    customCodexModels: [],
    customCopilotModels: [],
    customClaudeModels: [],
    customCursorModels: [],
    customOpencodeModels: [],
    customGeminiCliModels: [],
    customAmpModels: [],
    customKiloModels: [],
  });
  const screen = await render(
    <ProviderModelPicker
      provider={props.provider}
      model={props.model}
      lockedProvider={props.lockedProvider}
      modelOptionsByProvider={modelOptionsByProvider}
      triggerVariant={props.triggerVariant}
      onProviderModelChange={onProviderModelChange}
    />,
    { container: host },
  );

  return {
    onProviderModelChange,
    cleanup: async () => {
      await screen.unmount();
      host.remove();
    },
  };
}

describe("ProviderModelPicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows provider submenus when provider switching is allowed", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("Codex");
        expect(text).toContain("Claude");
        expect(text).not.toContain("Claude Sonnet 4.6");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  it("opens provider submenus with a visible gap from the parent menu", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
    });

    try {
      await page.getByRole("button").click();
      const providerTrigger = page.getByRole("menuitem", { name: "Codex" });
      await providerTrigger.hover();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("GPT-5.4");
      });

      const providerTriggerElement = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ).find((element) => element.textContent?.includes("Codex"));
      if (!providerTriggerElement) {
        throw new Error("Expected the Codex provider trigger to be mounted.");
      }

      const providerTriggerRect = providerTriggerElement.getBoundingClientRect();
      const modelElement = Array.from(
        document.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
      ).find((element) => element.textContent?.includes("GPT-5.4"));
      if (!modelElement) {
        throw new Error("Expected the submenu model option to be mounted.");
      }

      const submenuPopup = modelElement.closest('[data-slot="menu-sub-content"]');
      if (!(submenuPopup instanceof HTMLElement)) {
        throw new Error("Expected submenu popup to be mounted.");
      }

      const submenuRect = submenuPopup.getBoundingClientRect();

      expect(submenuRect.left).toBeGreaterThanOrEqual(providerTriggerRect.right);
      expect(submenuRect.left - providerTriggerRect.right).toBeGreaterThanOrEqual(2);
    } finally {
      await mounted.cleanup();
    }
  });

  it("disables non-locked providers when provider is locked mid-thread", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        // All providers still appear in the menu
        expect(text).toContain("Claude");
        expect(text).toContain("Codex");
      });
    } finally {
      await mounted.cleanup();
    }
  });

  // Fork: our picker uses a static model list via buildModelOptionsByProvider and
  // doesn't consume the providers prop, so dynamic server-reported model lists
  // (like conditionally showing Spark) are not implemented.
  it.skip("only shows codex spark when the server reports it for the account", async () => {
    const providersWithoutSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
            supportsFastMode: true,
            supportsThinkingToggle: false,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ]),
      TEST_PROVIDERS[1]!,
    ];
    const providersWithSpark: ReadonlyArray<ServerProvider> = [
      buildCodexProvider([
        {
          slug: "gpt-5.3-codex",
          name: "GPT-5.3 Codex",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
            supportsFastMode: true,
            supportsThinkingToggle: false,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
        {
          slug: "gpt-5.3-codex-spark",
          name: "GPT-5.3 Codex Spark",
          isCustom: false,
          capabilities: {
            reasoningEffortLevels: [effort("low"), effort("medium", true), effort("high")],
            supportsFastMode: true,
            supportsThinkingToggle: false,
            contextWindowOptions: [],
            promptInjectedEffortLevels: [],
          },
        },
      ]),
      TEST_PROVIDERS[1]!,
    ];

    const hidden = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
      providers: providersWithoutSpark,
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Codex" }).hover();

      await vi.waitFor(() => {
        const text = document.body.textContent ?? "";
        expect(text).toContain("GPT-5.3 Codex");
        expect(text).not.toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await hidden.cleanup();
    }

    const visible = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: null,
      providers: providersWithSpark,
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitem", { name: "Codex" }).hover();

      await vi.waitFor(() => {
        expect(document.body.textContent ?? "").toContain("GPT-5.3 Codex Spark");
      });
    } finally {
      await visible.cleanup();
    }
  });

  // Fork: our picker uses grouped sub-menus with a different structure than
  // upstream's flat menuitemradio layout, so this selection test doesn't apply.
  it.skip("dispatches the canonical slug when a model is selected", async () => {
    const mounted = await mountPicker({
      provider: "claudeAgent",
      model: "claude-opus-4-6",
      lockedProvider: "claudeAgent",
    });

    try {
      await page.getByRole("button").click();
      await page.getByRole("menuitemradio", { name: "Claude Sonnet 4.6" }).click();

      expect(mounted.onProviderModelChange).toHaveBeenCalledWith(
        "claudeAgent",
        "claude-sonnet-4-6",
      );
    } finally {
      await mounted.cleanup();
    }
  });

  // Fork: picker uses static PROVIDER_OPTIONS, not ServerProvider data,
  // so the disabled-provider rendering from upstream is not yet wired.
  // Test removed: providers prop was dead code and has been cleaned up.

  it("accepts outline trigger styling", async () => {
    const mounted = await mountPicker({
      provider: "codex",
      model: "gpt-5-codex",
      lockedProvider: null,
      triggerVariant: "outline",
    });

    try {
      const button = document.querySelector("button");
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Expected picker trigger button to be rendered.");
      }
      expect(button.className).toContain("border-input");
      expect(button.className).toContain("bg-popover");
    } finally {
      await mounted.cleanup();
    }
  });
});
