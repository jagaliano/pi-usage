import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SupportedQuotaProvider } from "../types/quotas.js";
import { hasStoredCredential } from "./auth.js";

/**
 * Environment variables Pi (or the provider itself) reads for each quota
 * provider.
 *
 * This list deliberately errs toward inclusion: a false positive only keeps an
 * extra `/provider:usage` command visible, while a false negative would hide a
 * command for a provider the user has actually configured.
 */
const PROVIDER_ENV_VARS: Record<SupportedQuotaProvider, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"],
  "openai-codex": ["OPENAI_API_KEY", "OPENAI_CODEX_API_KEY"],
  "github-copilot": ["COPILOT_GITHUB_TOKEN"],
  openrouter: ["OPENROUTER_API_KEY"],
  synthetic: ["SYNTHETIC_API_KEY"],
  xai: ["XAI_API_KEY"],
  zai: ["ZAI_API_KEY", "ZAI_CODING_CN_API_KEY"],
  // OPENCODE_GO_* predates the usage API; still a signal that the provider is
  // configured.
  "opencode-go": [
    "OPENCODE_GO_API_KEY",
    "OPENCODE_API_KEY",
    "OPENCODE_GO_WORKSPACE_ID",
  ],
  "kimi-coding": ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
  "ollama-cloud": ["OLLAMA_API_KEY"],
  minimax: ["MINIMAX_API_KEY", "MINIMAX_CN_API_KEY"],
};

/** Config files that hold a credential for providers that use one. */
function providerConfigPaths(provider: SupportedQuotaProvider): string[] {
  const home = homedir();
  switch (provider) {
    case "opencode-go":
      return [
        join(home, ".config", "opencode", "opencode-quota", "opencode-go.json"),
        join(home, ".config", "opencode-go", "config.json"),
        join(home, ".local", "share", "opencode", "auth.json"),
        join(home, ".config", "opencode", "auth.json"),
      ];
    case "openai-codex":
      return [join(home, ".codex", "auth.json")];
    default:
      return [];
  }
}

export interface ProviderAvailabilityDeps {
  env?: NodeJS.ProcessEnv;
  hasStoredCredential?: (provider: string) => boolean;
  fileExists?: (path: string) => boolean;
}

/**
 * Best-effort, offline check for whether a provider has any credential the
 * quota fetchers could use: an environment variable, an `auth.json` entry, or
 * a provider-specific config file.
 *
 * Registration-time only, so it never touches the network.
 */
export function isProviderConfigured(
  provider: SupportedQuotaProvider,
  deps: ProviderAvailabilityDeps = {},
): boolean {
  const env = deps.env ?? process.env;
  if (PROVIDER_ENV_VARS[provider].some((name) => Boolean(env[name]?.trim()))) {
    return true;
  }

  const credentialCheck = deps.hasStoredCredential ?? hasStoredCredential;
  if (credentialCheck(provider)) return true;

  const fileExists = deps.fileExists ?? existsSync;
  return providerConfigPaths(provider).some((path) => fileExists(path));
}
