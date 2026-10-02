import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUsageSettings } from "./config.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pi-usage-config-"));
  // Keep the config loader away from the developer's real usage.json.
  vi.stubEnv("HOME", home);
  vi.stubEnv("PI_CODING_AGENT_DIR", join(home, ".pi", "agent"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe("usage settings", () => {
  it("does not mark behaviour switches as (not loaded)", async () => {
    const commands = new Map<string, any>();
    registerUsageSettings(
      {
        registerCommand(name: string, command: any) {
          commands.set(name, command);
        },
      } as any,
      () => new Set(),
    );

    const seen: string[][] = [];
    let call = 0;
    const ctx = {
      cwd: home,
      ui: {
        select: async (_title: string, choices: string[]) => {
          seen.push(choices);
          call += 1;
          return call === 1 ? "global" : "Cancel";
        },
        notify: () => {},
      },
    };

    await commands.get("usage:settings").handler("", ctx);

    const list = seen[1];
    expect(list).toBeDefined();
    // Non-loadable switches are active and toggleable, so they must not be
    // annotated.
    expect(list.find((c) => c.startsWith("Hide unconfigured providers"))).toBe(
      "Hide unconfigured providers: enabled",
    );
    expect(list.find((c) => c.startsWith("Defer to Synthetic"))).toBe(
      "Defer to Synthetic: enabled",
    );
    // Loadable features still get the annotation.
    expect(list.find((c) => c.startsWith("Combined usage command"))).toBe(
      "Combined usage command: enabled (not loaded)",
    );
  });
});
