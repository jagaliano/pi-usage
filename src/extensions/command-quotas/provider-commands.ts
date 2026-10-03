import type { SupportedQuotaProvider } from "../../types/quotas.js";

export interface ProviderCommandInfo {
  provider: SupportedQuotaProvider;
  commandName: string;
  title: string;
}

export function getProviderCommandInfo(
  provider: SupportedQuotaProvider,
): ProviderCommandInfo {
  switch (provider) {
    case "anthropic":
      return {
        provider,
        commandName: "anthropic:usage",
        title: "Anthropic Usage",
      };
    case "openai-codex":
      return {
        provider,
        commandName: "codex:usage",
        title: "OpenAI Codex Usage",
      };
    case "github-copilot":
      return {
        provider,
        commandName: "github:usage",
        title: "GitHub Copilot Usage",
      };
    case "openrouter":
      return {
        provider,
        commandName: "openrouter:usage",
        title: "OpenRouter Usage",
      };
    case "synthetic":
      return {
        provider,
        commandName: "synthetic:usage",
        title: "Synthetic Usage",
      };
    case "xai":
      return {
        provider,
        commandName: "grok:usage",
        title: "Grok Usage",
      };
    case "zai":
      return {
        provider,
        commandName: "zai:usage",
        title: "Z.ai Usage",
      };
    case "opencode-go":
      return {
        provider,
        commandName: "opencode-go:usage",
        title: "OpenCode Go Usage",
      };
    case "kimi-coding":
      return {
        provider,
        commandName: "kimi:usage",
        title: "Kimi Code Usage",
      };
    case "ollama-cloud":
      return {
        provider,
        commandName: "ollama:usage",
        title: "Ollama Cloud Usage",
      };
    case "minimax":
      return {
        provider,
        commandName: "minimax:usage",
        title: "MiniMax Usage",
      };
    case "commandcode":
      return {
        provider,
        commandName: "commandcode:usage",
        title: "Command Code Usage",
      };
  }
}
