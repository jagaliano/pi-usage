import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import pkg from "../package.json" with { type: "json" };

export type UsageFeatureId =
  | "usageCommand"
  | "providerCommands"
  | "usageStatus"
  | "tokenStatus"
  | "quotaWarnings"
  | "deferToSynthetic"
  | "hideUnconfiguredProviders";

export const USAGE_EXTENSIONS_REQUEST_EVENT =
  "usage:extensions:request" as const;
export const USAGE_EXTENSIONS_REGISTER_EVENT =
  "usage:extensions:register" as const;
export const USAGE_CONFIG_UPDATED_EVENT = "usage:config:updated" as const;

export interface UsageExtensionsRegisterPayload {
  feature: UsageFeatureId;
}

export interface UsageConfig {
  configVersion?: string;
  usageCommand?: boolean;
  providerCommands?: boolean;
  usageStatus?: boolean;
  tokenStatus?: boolean;
  quotaWarnings?: boolean;
  /** When true and pi-synthetic's usage footer is active, hide pi-usage's Synthetic footer. */
  deferToSynthetic?: boolean;
  /** When true, only register `/provider:usage` commands for providers with credentials. */
  hideUnconfiguredProviders?: boolean;
}

export interface ResolvedUsageConfig {
  configVersion: string;
  usageCommand: boolean;
  providerCommands: boolean;
  usageStatus: boolean;
  tokenStatus: boolean;
  quotaWarnings: boolean;
  deferToSynthetic: boolean;
  hideUnconfiguredProviders: boolean;
}

const DEFAULT_CONFIG: ResolvedUsageConfig = {
  configVersion: pkg.version,
  usageCommand: true,
  providerCommands: true,
  usageStatus: true,
  tokenStatus: true,
  quotaWarnings: true,
  deferToSynthetic: true,
  hideUnconfiguredProviders: true,
};

let pendingMigrationNotice = false;

function markMigrationNoticePending(): void {
  pendingMigrationNotice = true;
}

export function hasPendingMigrationNotice(): boolean {
  return pendingMigrationNotice;
}

export function clearPendingMigrationNotice(): void {
  pendingMigrationNotice = false;
}

class UsageConfigStore {
  private config: ResolvedUsageConfig = DEFAULT_CONFIG;
  private cwd = process.cwd();

  private globalPath(): string {
    return join(homedir(), ".pi", "agent", "extensions", "usage.json");
  }

  private localPath(): string {
    return join(this.cwd, ".pi", "usage.json");
  }

  private resolve(input?: UsageConfig): ResolvedUsageConfig {
    return {
      configVersion: input?.configVersion ?? DEFAULT_CONFIG.configVersion,
      usageCommand: input?.usageCommand ?? DEFAULT_CONFIG.usageCommand,
      providerCommands:
        input?.providerCommands ?? DEFAULT_CONFIG.providerCommands,
      usageStatus: input?.usageStatus ?? DEFAULT_CONFIG.usageStatus,
      tokenStatus: input?.tokenStatus ?? DEFAULT_CONFIG.tokenStatus,
      quotaWarnings: input?.quotaWarnings ?? DEFAULT_CONFIG.quotaWarnings,
      deferToSynthetic:
        input?.deferToSynthetic ?? DEFAULT_CONFIG.deferToSynthetic,
      hideUnconfiguredProviders:
        input?.hideUnconfiguredProviders ??
        DEFAULT_CONFIG.hideUnconfiguredProviders,
    };
  }

  private async readConfig(path: string): Promise<UsageConfig | undefined> {
    try {
      const data = JSON.parse(await readFile(path, "utf8")) as UsageConfig;
      return data;
    } catch {
      return undefined;
    }
  }

  async load(cwd = process.cwd()): Promise<void> {
    this.cwd = cwd;
    const global = await this.readConfig(this.globalPath());
    const local = await this.readConfig(this.localPath());
    const merged = { ...global, ...local };
    if (!global && !local) markMigrationNoticePending();
    this.config = this.resolve(merged);
  }

  getConfig(): ResolvedUsageConfig {
    return this.config;
  }

  hasConfig(scope: "global" | "local"): boolean {
    const path = scope === "global" ? this.globalPath() : this.localPath();
    return existsSync(path);
  }

  async save(scope: "global" | "local", config: UsageConfig): Promise<void> {
    const path = scope === "global" ? this.globalPath() : this.localPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      JSON.stringify(this.resolve(config), null, 2) + "\n",
      "utf8",
    );
    await this.load(this.cwd);
  }
}

export const configLoader = new UsageConfigStore();

export async function seedUsageConfigIfMissing(): Promise<void> {
  if (configLoader.hasConfig("global") || configLoader.hasConfig("local"))
    return;
  markMigrationNoticePending();
  try {
    await configLoader.save("global", DEFAULT_CONFIG);
  } catch {
    // ignore
  }
}

export interface UsageConfigUpdatedPayload {
  config: ResolvedUsageConfig;
}

export function emitUsageConfigUpdated(pi: ExtensionAPI): void {
  pi.events.emit(USAGE_CONFIG_UPDATED_EVENT, {
    config: configLoader.getConfig(),
  });
}

const FEATURE_META: Array<{
  id: UsageFeatureId;
  label: string;
  description: string;
}> = [
  {
    id: "usageCommand",
    label: "Combined usage command",
    description: "Toggle the `/usage` command",
  },
  {
    id: "providerCommands",
    label: "Provider usage commands",
    description:
      "Toggle `/anthropic:usage`, `/codex:usage`, `/github:usage`, `/openrouter:usage`, and `/synthetic:usage`",
  },
  {
    id: "usageStatus",
    label: "Usage status",
    description: "Toggle footer quota status for the active provider",
  },
  {
    id: "tokenStatus",
    label: "Token usage status",
    description: "Toggle the footer token-usage status and /tokens command",
  },
  {
    id: "quotaWarnings",
    label: "Quota warnings",
    description: "Toggle projected-usage warning notifications",
  },
  {
    id: "deferToSynthetic",
    label: "Defer to Synthetic",
    description:
      "When pi-synthetic is loaded, hide pi-usage's Synthetic footer to avoid duplicates",
  },
  {
    id: "hideUnconfiguredProviders",
    label: "Hide unconfigured providers",
    description:
      "Only register `/provider:usage` commands for providers that have credentials",
  },
];

/**
 * Behaviour switches rather than loadable sub-extensions. The settings UI must
 * not require these to be registered by a sub-extension.
 */
const NON_LOADABLE_FEATURES = new Set<UsageFeatureId>([
  "deferToSynthetic",
  "hideUnconfiguredProviders",
]);

export function registerUsageSettings(
  pi: ExtensionAPI,
  getLoadedFeatures: () => Set<UsageFeatureId>,
): void {
  pi.registerCommand("usage:settings", {
    description: "Configure quota extension settings",
    handler: async (_args, ctx) => {
      await configLoader.load(ctx.cwd);
      const scopeChoice = await ctx.ui.select("Save settings to", [
        "global",
        "local",
        "cancel",
      ]);
      if (!scopeChoice || scopeChoice === "cancel") return;
      const scope = scopeChoice as "global" | "local";
      const draft: ResolvedUsageConfig = { ...configLoader.getConfig() };

      while (true) {
        const choices = FEATURE_META.map((feature) => {
          // Behaviour switches are never registered by a sub-extension, so
          // they must not be annotated as unloaded.
          const registered =
            NON_LOADABLE_FEATURES.has(feature.id) ||
            getLoadedFeatures().has(feature.id);
          const loaded = registered ? "" : " (not loaded)";
          const enabled = draft[feature.id] ? "enabled" : "disabled";
          return `${feature.label}: ${enabled}${loaded}`;
        });
        choices.push("Save and exit", "Cancel");

        const selected = await ctx.ui.select("Usage Settings", choices);
        if (!selected || selected === "Cancel") return;
        if (selected === "Save and exit") {
          await configLoader.save(scope, draft);
          emitUsageConfigUpdated(pi);
          ctx.ui.notify(
            "Quota settings saved. Run /reload to fully apply command visibility changes.",
            "info",
          );
          return;
        }

        const feature = FEATURE_META.find((item) =>
          selected.startsWith(item.label),
        );
        if (!feature) continue;
        if (
          !NON_LOADABLE_FEATURES.has(feature.id) &&
          !getLoadedFeatures().has(feature.id)
        ) {
          ctx.ui.notify(
            `${feature.label} is not loaded by Pi in this session.`,
            "warning",
          );
          continue;
        }
        (draft as unknown as Record<string, boolean>)[feature.id] = !(
          draft as unknown as Record<string, boolean>
        )[feature.id];
      }
    },
  });
}
