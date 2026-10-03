import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import quotaWarningsExtension from "./index.js";
import { fetchProviderQuotas } from "../../lib/quotas.js";
import type { QuotaWindow } from "../../types/quotas.js";

vi.mock("../../config.js", () => ({
  USAGE_CONFIG_UPDATED_EVENT: "usage:config:updated",
  USAGE_EXTENSIONS_REGISTER_EVENT: "usage:extensions:register",
  USAGE_EXTENSIONS_REQUEST_EVENT: "usage:extensions:request",
  configLoader: {
    load: vi.fn(async () => undefined),
    getConfig: vi.fn(() => ({ quotaWarnings: true })),
  },
}));

vi.mock("../../lib/quotas.js", () => ({
  isSupportedProvider: (provider: string | undefined) => provider === "minimax",
  PROVIDER_LABELS: { minimax: "MiniMax" },
  fetchProviderQuotas: vi.fn(),
}));

type EventHandler = (event: unknown, ctx: ExtensionContext) => unknown;

function createFakePi() {
  const handlers = new Map<string, EventHandler[]>();
  const pi = {
    on(event: string, handler: EventHandler) {
      const current = handlers.get(event) ?? [];
      current.push(handler);
      handlers.set(event, current);
    },
    events: {
      on: vi.fn(),
      emit: vi.fn(),
    },
  } as unknown as ExtensionAPI;

  return {
    pi,
    async emit(event: string, ctx: ExtensionContext) {
      for (const handler of handlers.get(event) ?? []) {
        await handler({ type: event }, ctx);
      }
      // Warning checks deliberately run in the background. Flush the promise
      // continuation after the mocked quota request resolves.
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function createContext() {
  const notify = vi.fn();
  const ctx = {
    hasUI: true,
    model: { provider: "minimax" },
    modelRegistry: {
      authStorage: {
        get: vi.fn(),
        getApiKey: vi.fn(),
      },
    },
    ui: { notify },
  } as unknown as ExtensionContext;
  return { ctx, notify };
}

function makeWindow(overrides: Partial<QuotaWindow> = {}): QuotaWindow {
  return {
    provider: "minimax",
    label: "general",
    usedPercent: 100,
    resetsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
    windowSeconds: 5 * 60 * 60,
    usedValue: 100,
    limitValue: 100,
    showPace: true,
    limited: true,
    ...overrides,
  };
}

function mockWindows(windows: QuotaWindow[]): void {
  vi.mocked(fetchProviderQuotas).mockResolvedValue({
    success: true,
    data: { provider: "minimax", windows },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("quota warning UX", () => {
  it("presents an exhausted quota as a warning rather than an error", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    mockWindows([makeWindow()]);
    const { pi, emit } = createFakePi();
    const { ctx, notify } = createContext();

    await quotaWarningsExtension(pi);
    await emit("session_start", ctx);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      "MiniMax quota warning:\n- general: limit reached; resets in 4h",
      "warning",
    );
  });

  it("never claims an unknown reset time is now", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    // A zero resetsAt means "reset time unknown" (e.g. an exhausted balance
    // with no billing period end), not "resets immediately".
    mockWindows([makeWindow({ resetsAt: new Date(0) })]);
    const { pi, emit } = createFakePi();
    const { ctx, notify } = createContext();

    await quotaWarningsExtension(pi);
    await emit("session_start", ctx);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(
      "MiniMax quota warning:\n- general: limit reached",
      "warning",
    );
  });

  it("does not repeat critical warnings on every turn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    mockWindows([makeWindow()]);
    const { pi, emit } = createFakePi();
    const { ctx, notify } = createContext();

    await quotaWarningsExtension(pi);
    await emit("session_start", ctx);
    await vi.advanceTimersByTimeAsync(31_000);
    await emit("turn_end", ctx);
    expect(notify).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await emit("turn_end", ctx);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("notifies immediately when risk severity increases", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
    mockWindows([
      makeWindow({
        usedPercent: 80,
        usedValue: 80,
        showPace: false,
        limited: false,
      }),
    ]);
    const { pi, emit } = createFakePi();
    const { ctx, notify } = createContext();

    await quotaWarningsExtension(pi);
    await emit("session_start", ctx);

    mockWindows([makeWindow()]);
    await vi.advanceTimersByTimeAsync(31_000);
    await emit("turn_end", ctx);

    expect(notify).toHaveBeenCalledTimes(2);
  });
});
