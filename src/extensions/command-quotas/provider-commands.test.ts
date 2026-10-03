import { describe, expect, it } from "vitest";
import {
  getProviderCommandInfo,
  type ProviderCommandInfo,
} from "./provider-commands.js";

describe("getProviderCommandInfo", () => {
  it("maps anthropic to anthropic:usage", () => {
    const info = getProviderCommandInfo("anthropic");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "anthropic",
      commandName: "anthropic:usage",
      title: "Anthropic Usage",
    });
  });

  it("maps openai-codex to codex:usage", () => {
    const info = getProviderCommandInfo("openai-codex");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "openai-codex",
      commandName: "codex:usage",
      title: "OpenAI Codex Usage",
    });
  });

  it("maps github-copilot to github:usage", () => {
    const info = getProviderCommandInfo("github-copilot");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "github-copilot",
      commandName: "github:usage",
      title: "GitHub Copilot Usage",
    });
  });

  it("maps openrouter to openrouter:usage", () => {
    const info = getProviderCommandInfo("openrouter");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "openrouter",
      commandName: "openrouter:usage",
      title: "OpenRouter Usage",
    });
  });

  it("maps xai to grok:usage", () => {
    const info = getProviderCommandInfo("xai");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "xai",
      commandName: "grok:usage",
      title: "Grok Usage",
    });
  });

  it("maps zai to zai:usage", () => {
    const info = getProviderCommandInfo("zai");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "zai",
      commandName: "zai:usage",
      title: "Z.ai Usage",
    });
  });

  it("maps kimi-coding to kimi:usage", () => {
    const info = getProviderCommandInfo("kimi-coding");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "kimi-coding",
      commandName: "kimi:usage",
      title: "Kimi Code Usage",
    });
  });

  it("maps minimax to minimax:usage", () => {
    const info = getProviderCommandInfo("minimax");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "minimax",
      commandName: "minimax:usage",
      title: "MiniMax Usage",
    });
  });

  it("maps commandcode to commandcode:usage", () => {
    const info = getProviderCommandInfo("commandcode");
    expect(info).toMatchObject<Partial<ProviderCommandInfo>>({
      provider: "commandcode",
      commandName: "commandcode:usage",
      title: "Command Code Usage",
    });
  });
});
