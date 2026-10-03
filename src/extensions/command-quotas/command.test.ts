import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inMemoryAuthStorage } from "../../lib/auth.js";
import { SUPPORTED_PROVIDERS } from "../../lib/quotas.js";
import { registerUsageCommands } from "./command.js";
import { getProviderCommandInfo } from "./provider-commands.js";

// Provider credentials can leak in from the host environment (pi resolves
// API keys from env vars, and the Synthetic provider reads
// SYNTHETIC_API_KEY directly), which would turn these "no credentials"
// tests into live network calls. Keep them hermetic.
const CREDENTIAL_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "SYNTHETIC_API_KEY",
  "OLLAMA_API_KEY",
  "MINIMAX_API_KEY",
  "OPENCODE_GO_API_KEY",
  "OPENCODE_API_KEY",
  "COMMAND_CODE_API_KEY",
  "COMMANDCODE_API_KEY",
];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of CREDENTIAL_ENV_KEYS) delete process.env[key];
  // Providers that fall back to credential files (Command Code, OpenCode Go,
  // Codex) would otherwise pick up the developer's real keys from their home
  // directory.
  vi.stubEnv("HOME", join(tmpdir(), "pi-usage-test-no-home"));
  globalThis.fetch = vi.fn().mockRejectedValue(
    new Error("network disabled in tests"),
  );
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
});

function registeredCommands(
  options: Parameters<typeof registerUsageCommands>[1] = {},
) {
  const commands = new Map<string, any>();
  registerUsageCommands(
    {
      registerCommand(name: string, command: any) {
        commands.set(name, command);
      },
    } as any,
    options,
  );
  return commands;
}

function contextWithoutCredentials(notify: ReturnType<typeof vi.fn>) {
  return {
    modelRegistry: { authStorage: inMemoryAuthStorage() },
    ui: {
      custom: async () => undefined,
      notify,
    },
  } as any;
}

describe("quota command visibility", () => {
  it("hides unconfigured providers from the combined dashboard", async () => {
    const commands = registeredCommands({ isConfigured: () => false });
    const notify = vi.fn();

    await commands.get("usage").handler(
      "",
      contextWithoutCredentials(notify),
    );

    expect(notify).toHaveBeenCalledWith("No quota data available", "info");
  });

  it("registers provider commands only for configured providers", () => {
    const commands = registeredCommands({
      isConfigured: (provider) => provider === "anthropic",
    });

    expect(commands.has("usage")).toBe(true);
    expect(commands.has("anthropic:usage")).toBe(true);
    expect(commands.has("grok:usage")).toBe(false);
    expect(commands.has("xai:usage")).toBe(false);
    expect(commands.has("minimax:usage")).toBe(false);
  });

  it("registers every provider when hiding is disabled", () => {
    const commands = registeredCommands({ hideUnconfigured: false });

    for (const provider of SUPPORTED_PROVIDERS) {
      expect(commands.has(getProviderCommandInfo(provider).commandName)).toBe(
        true,
      );
    }
    expect(commands.has("grok:usage")).toBe(true);
  });

  it("keeps provider-specific commands diagnostic", async () => {
    const commands = registeredCommands({ hideUnconfigured: false });
    const notify = vi.fn();

    await commands.get("anthropic:usage").handler(
      "",
      contextWithoutCredentials(notify),
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("No Anthropic OAuth token found"),
      "info",
    );
  });
});
