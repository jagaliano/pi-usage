import { describe, expect, it } from "vitest";
import { SUPPORTED_PROVIDERS } from "./quotas.js";
import {
  isProviderConfigured,
  type ProviderAvailabilityDeps,
} from "./provider-availability.js";

const EMPTY: ProviderAvailabilityDeps = {
  env: {} as NodeJS.ProcessEnv,
  hasStoredCredential: () => false,
  fileExists: () => false,
};

describe("isProviderConfigured", () => {
  it("is false for every provider when nothing is set", () => {
    for (const provider of SUPPORTED_PROVIDERS) {
      expect(isProviderConfigured(provider, EMPTY)).toBe(false);
    }
  });

  it("is true when the provider's env var is set", () => {
    const cases: Array<[string, NodeJS.ProcessEnv]> = [
      ["anthropic", { ANTHROPIC_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["openai-codex", { OPENAI_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["openrouter", { OPENROUTER_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["synthetic", { SYNTHETIC_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["xai", { XAI_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["zai", { ZAI_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["opencode-go", { OPENCODE_GO_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["opencode-go", { OPENCODE_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["kimi-coding", { KIMI_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["ollama-cloud", { OLLAMA_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["minimax", { MINIMAX_API_KEY: "k" } as NodeJS.ProcessEnv],
      ["github-copilot", { COPILOT_GITHUB_TOKEN: "k" } as NodeJS.ProcessEnv],
    ];
    for (const [provider, env] of cases) {
      expect(
        isProviderConfigured(provider as (typeof SUPPORTED_PROVIDERS)[number], {
          ...EMPTY,
          env,
        }),
      ).toBe(true);
    }
  });

  it("ignores blank env values", () => {
    expect(
      isProviderConfigured("xai", {
        ...EMPTY,
        env: { XAI_API_KEY: "   " } as NodeJS.ProcessEnv,
      }),
    ).toBe(false);
  });

  it("is true when auth.json holds a credential", () => {
    expect(
      isProviderConfigured("anthropic", {
        ...EMPTY,
        hasStoredCredential: (provider) => provider === "anthropic",
      }),
    ).toBe(true);
    expect(
      isProviderConfigured("xai", {
        ...EMPTY,
        hasStoredCredential: (provider) => provider === "anthropic",
      }),
    ).toBe(false);
  });

  it("is true when a provider-specific config file exists", () => {
    expect(
      isProviderConfigured("openai-codex", {
        ...EMPTY,
        fileExists: (path) => path.endsWith(".codex/auth.json"),
      }),
    ).toBe(true);
    expect(
      isProviderConfigured("opencode-go", {
        ...EMPTY,
        fileExists: (path) => path.endsWith("opencode/auth.json"),
      }),
    ).toBe(true);
  });

  it("does not treat unrelated files as credentials for env-only providers", () => {
    expect(
      isProviderConfigured("xai", { ...EMPTY, fileExists: () => true }),
    ).toBe(false);
    expect(
      isProviderConfigured("minimax", { ...EMPTY, fileExists: () => true }),
    ).toBe(false);
  });
});
