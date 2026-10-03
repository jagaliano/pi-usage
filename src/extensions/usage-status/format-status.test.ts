import { afterEach, describe, expect, it, vi } from "vitest";
import { formatWindowStatus, type WindowStatus } from "./format-status.js";
import type { SupportedQuotaProvider } from "../../types/quotas.js";
import { formatStatus, formatStatusForFooter, toStatusWindows, toWindowStatus } from "./index.js";

// Minimal fake theme that just returns text with markers for color assertions
function fakeTheme() {
  return {
    fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
  };
}

describe("formatWindowStatus", () => {
  const theme = fakeTheme() as any;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows remaining/limit for windows with known limits (GitHub premium)", () => {
    const w: WindowStatus = {
      label: "Premium / month",
      usedPercent: 2.3,
      severity: "none",
      resetsAt: "2026-05-01T00:00:00Z",
      limited: false,
      usedValue: 7,
      limitValue: 300,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("293/300");
    expect(result).toContain("[success]");
  });

  it("shows remaining % for percentage-only windows (Anthropic 5h)", () => {
    const w: WindowStatus = {
      label: "5h",
      usedPercent: 9,
      severity: "none",
      resetsAt: "2026-04-22T18:00:00Z",
      limited: false,
      usedValue: 9,
      limitValue: 100,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("91% left");
    expect(result).toContain("[success]");
  });

  it("shows currency for isCurrency windows (Anthropic extra)", () => {
    const w: WindowStatus = {
      label: "Extra (AUD)",
      usedPercent: 71.8,
      severity: "warning",
      resetsAt: "2026-05-01T00:00:00Z",
      limited: false,
      isCurrency: true,
      usedValue: 215,
      limitValue: 300,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("$215.00/$300.00");
    expect(result).toContain("[warning]");
  });

  it("shows REACHED for spend cap", () => {
    const w: WindowStatus = {
      label: "Spend cap",
      usedPercent: 100,
      severity: "critical",
      resetsAt: null,
      limited: true,
      usedValue: 1,
      limitValue: 1,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("REACHED");
    expect(result).toContain("[error]");
  });

  it("colors label when severity is warning or worse", () => {
    const w: WindowStatus = {
      label: "7d",
      usedPercent: 85,
      severity: "high",
      resetsAt: "2026-04-23T23:00:00Z",
      limited: false,
      usedValue: 85,
      limitValue: 100,
    };
    const result = formatWindowStatus(theme, w);
    // label should be colored with error (high maps to error)
    expect(result).toContain("[error]7d:");
    expect(result).toContain("15% left");
  });

  it("keeps label dim when severity is none", () => {
    const w: WindowStatus = {
      label: "5h",
      usedPercent: 10,
      severity: "none",
      resetsAt: "2026-04-22T18:00:00Z",
      limited: false,
      usedValue: 10,
      limitValue: 100,
    };
    const result = formatWindowStatus(theme, w);
    expect(result).toContain("[dim]5h:");
  });

  it("renders footer reset times with minute precision for every provider", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T05:28:37Z"));

    const providers: Array<{ provider: SupportedQuotaProvider; label: string }> = [
      { provider: "anthropic", label: "5h" },
      { provider: "openai-codex", label: "7d" },
      { provider: "github-copilot", label: "Premium / month" },
      { provider: "openrouter", label: "Monthly Budget" },
      { provider: "synthetic", label: "Subscription" },
    ];

    for (const { provider, label } of providers) {
      const status = toWindowStatus({
        provider,
        label,
        usedPercent: 50,
        resetsAt: new Date("2026-05-06T07:47:37Z"),
        windowSeconds: 5 * 60 * 60,
        usedValue: 50,
        limitValue: 100,
      });

      const result = formatStatus({ ui: { theme } } as any, [status]);

      expect(result).toContain("(↺in 2h 19m)");
      expect(result).not.toContain("(↺in 3h)");
    }
  });

  it("omits footer reset tags for windows without a real reset time", () => {
    const result = formatStatus(
      { ui: { theme } } as any,
      [
        {
          label: "Spend cap",
          usedPercent: 0,
          severity: "none",
          resetsAt: null,
          limited: false,
          usedValue: 0,
          limitValue: 1,
        },
      ],
    );

    expect(result).toContain("cap:");
    expect(result).not.toContain("↺");
    expect(result).not.toContain("soon");
  });

  it("maps sentinel reset dates to null before rendering status for non-reset provider windows", () => {
    const windows: Array<{ provider: SupportedQuotaProvider; label: string; isCurrency?: boolean }> = [
      { provider: "openai-codex", label: "Spend cap" },
      { provider: "openai-codex", label: "Credits", isCurrency: true },
      { provider: "openrouter", label: "Credits Remaining", isCurrency: true },
    ];

    for (const { provider, label, isCurrency } of windows) {
      const status = toWindowStatus({
        provider,
        label,
        usedPercent: 0,
        resetsAt: new Date(0),
        windowSeconds: 0,
        usedValue: 0,
        limitValue: 1,
        limited: false,
        isCurrency,
      });

      expect(status.resetsAt).toBeNull();
    }
  });

  it("clears the footer status when filtering removes all windows", () => {
    expect(formatStatusForFooter({ ui: { theme } } as any, [])).toBeUndefined();
  });

  it("filters Anthropic subscription windows from footer status while keeping extra usage", () => {
    const windows = toStatusWindows([
      {
        provider: "anthropic",
        label: "5h",
        usedPercent: 10,
        resetsAt: new Date("2026-05-06T07:47:37Z"),
        windowSeconds: 5 * 60 * 60,
        usedValue: 10,
        limitValue: 100,
      },
      {
        provider: "anthropic",
        label: "7d Sonnet",
        usedPercent: 20,
        resetsAt: new Date("2026-05-06T07:47:37Z"),
        windowSeconds: 7 * 24 * 60 * 60,
        usedValue: 20,
        limitValue: 100,
      },
      {
        provider: "anthropic",
        label: "Extra (USD)",
        usedPercent: 30,
        resetsAt: new Date("2026-06-01T00:00:00Z"),
        windowSeconds: 30 * 24 * 60 * 60,
        usedValue: 30,
        limitValue: 100,
        isCurrency: true,
      },
    ]);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ label: "Extra (USD)" });
  });

  it("does not prefix elapsed reset times with in", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-06T05:28:37Z"));

    const result = formatStatus(
      { ui: { theme } } as any,
      [
        {
          label: "5h",
          usedPercent: 100,
          severity: "critical",
          resetsAt: "2026-05-06T05:28:37Z",
          limited: false,
          usedValue: 100,
          limitValue: 100,
        },
      ],
    );

    expect(result).toContain("(↺now)");
    expect(result).not.toContain("(↺in now)");
  });

  describe("detailed status (dedicated line)", () => {
    const WINDOW_START = "2026-05-06T05:00:00Z";
    // 5h window, 30% elapsed (1.5h in, 3.5h to reset).
    const RESET_30_PCT = "2026-05-06T08:30:00Z";

    it("appends time-to-exhaustion when a window runs out before reset", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      const w: WindowStatus = {
        label: "5h",
        usedPercent: 90,
        severity: "critical",
        resetsAt: RESET_30_PCT,
        limited: false,
        usedValue: 90,
        limitValue: 100,
        windowSeconds: 5 * 60 * 60,
      };
      // 30% elapsed, 90% used => 10 minutes to exhaustion (not 3h 20m).
      expect(formatWindowStatus(theme, w, true)).toContain("runs out ~10m");
    });

    it("omits the hint when usage is not ahead of elapsed time", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      const w: WindowStatus = {
        label: "5h",
        usedPercent: 40,
        severity: "warning",
        // 1h remaining of a 5h window => 80% elapsed, ahead of 40% used.
        resetsAt: "2026-05-06T06:00:00Z",
        limited: false,
        usedValue: 40,
        limitValue: 100,
        windowSeconds: 5 * 60 * 60,
      };
      expect(formatWindowStatus(theme, w, true)).not.toContain("runs out");
    });

    it("omits the hint for healthy windows even when ahead of pace", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      const w: WindowStatus = {
        label: "5h",
        usedPercent: 90,
        severity: "none",
        resetsAt: RESET_30_PCT,
        limited: false,
        usedValue: 90,
        limitValue: 100,
        windowSeconds: 5 * 60 * 60,
      };
      expect(formatWindowStatus(theme, w, true)).not.toContain("runs out");
    });

    it("omits the hint for limited or already-exhausted windows", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      const base: WindowStatus = {
        label: "5h",
        usedPercent: 100,
        severity: "critical",
        resetsAt: RESET_30_PCT,
        limited: false,
        usedValue: 100,
        limitValue: 100,
        windowSeconds: 5 * 60 * 60,
      };
      expect(formatWindowStatus(theme, base, true)).not.toContain("runs out");
      expect(
        formatWindowStatus(
          theme,
          { ...base, usedPercent: 90, limited: true },
          true,
        ),
      ).not.toContain("runs out");
    });

    it("omits the hint when the reset time is unknown", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      const w: WindowStatus = {
        label: "5h",
        usedPercent: 90,
        severity: "critical",
        resetsAt: null,
        limited: false,
        usedValue: 90,
        limitValue: 100,
        windowSeconds: 5 * 60 * 60,
      };
      expect(formatWindowStatus(theme, w, true)).not.toContain("runs out");
    });

    it("omits the hint when the reset time is in the past", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      const w: WindowStatus = {
        label: "5h",
        usedPercent: 90,
        severity: "critical",
        resetsAt: "2026-05-06T04:00:00Z",
        limited: false,
        usedValue: 90,
        limitValue: 100,
        windowSeconds: 5 * 60 * 60,
      };
      expect(formatWindowStatus(theme, w, true)).not.toContain("runs out");
    });

    it("omits the hint when usage exactly matches elapsed time", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      const w: WindowStatus = {
        label: "5h",
        usedPercent: 50,
        severity: "warning",
        // 2.5h remaining of a 5h window => 50% elapsed.
        resetsAt: "2026-05-06T07:30:00Z",
        limited: false,
        usedValue: 50,
        limitValue: 100,
        windowSeconds: 5 * 60 * 60,
      };
      expect(formatWindowStatus(theme, w, true)).not.toContain("runs out");
    });

    it("ignores paceScale when estimating exhaustion", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(WINDOW_START));
      // OpenCode Go-style weekly window: paceScale distorts the assessment
      // pace, but the hint must use physical elapsed time only. 50% elapsed and
      // 50% used must therefore produce no hint.
      const status = toWindowStatus({
        provider: "opencode-go",
        label: "Weekly",
        usedPercent: 50,
        resetsAt: new Date("2026-05-09T17:00:00Z"),
        windowSeconds: 7 * 24 * 60 * 60,
        usedValue: 50,
        limitValue: 100,
        showPace: true,
        paceScale: 1 / 7,
      });
      expect(formatWindowStatus(theme, status, true)).not.toContain("runs out");
    });

    it("prepends a severity glyph only in detailed mode", () => {
      const windows: WindowStatus[] = [
        {
          label: "5h",
          usedPercent: 85,
          severity: "warning",
          resetsAt: null,
          limited: false,
          usedValue: 85,
          limitValue: 100,
        },
      ];
      expect(formatStatus({ ui: { theme } } as any, windows, true)).toContain(
        "[warning]▲",
      );
      expect(formatStatus({ ui: { theme } } as any, windows)).not.toContain("▲");
    });

    it("uses the highest severity across windows for the glyph", () => {
      const windows: WindowStatus[] = [
        {
          label: "5h",
          usedPercent: 10,
          severity: "none",
          resetsAt: null,
          limited: false,
          usedValue: 10,
          limitValue: 100,
        },
        {
          label: "7d",
          usedPercent: 85,
          severity: "high",
          resetsAt: null,
          limited: false,
          usedValue: 85,
          limitValue: 100,
        },
      ];
      expect(formatStatus({ ui: { theme } } as any, windows, true)).toContain(
        "[error]✕",
      );
    });

    it("uses a safe glyph when all windows are healthy", () => {
      const windows: WindowStatus[] = [
        {
          label: "5h",
          usedPercent: 10,
          severity: "none",
          resetsAt: null,
          limited: false,
          usedValue: 10,
          limitValue: 100,
        },
      ];
      expect(formatStatus({ ui: { theme } } as any, windows, true)).toContain(
        "[success]●",
      );
    });
  });
});
