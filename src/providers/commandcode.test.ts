import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeResetAt,
  queryCommandCodeQuota,
  redactCommandCodeSecrets,
  windowLimitsFromCredits,
} from "./commandcode.js";
import {
  commandCodeApiKeyFromConfigData,
  normalizeCommandCodeApiKey,
} from "./commandcode-config.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function authorizationFromCall(call: unknown): string | undefined {
  const [, init] = call as [string, RequestInit];
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

const BASE = "https://api.commandcode.ai";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Route responses by path so each endpoint can be asserted independently. */
function routedFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.slice(BASE.length).split("?")[0];
    const handler = routes[path];
    if (!handler) return new Response("not found", { status: 404 });
    return handler();
  });
}

const WHOAMI = { org: { id: "org_1", login: "acme" }, user: { userName: "jagaliano", keyName: "prod-key" } };
const CREDITS = {
  credits: { monthlyCredits: 20, purchasedCredits: 5, freeCredits: 0 },
  windowLimits: {
    fiveHour: { used: 1.5, cap: 10, resetAt: 1_790_913_204 },
    weekly: { used: 6, cap: 40, resetAt: 1_790_913_600 },
  },
};
const SUBSCRIPTION = {
  data: {
    planId: "pro",
    status: "active",
    currentPeriodStart: "2026-09-01T00:00:00.000Z",
    currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  },
};
const SUMMARY = { totalCost: 3.25, totalCount: 42, totalTokens: 123_456 };

describe("queryCommandCodeQuota", () => {
  it("reads whoami, credits, subscription, and summary with a bearer key", async () => {
    const fetchSpy = routedFetch({
      "/alpha/whoami": () => jsonResponse(WHOAMI),
      "/alpha/billing/credits": () => jsonResponse(CREDITS),
      "/alpha/billing/subscriptions": () => jsonResponse(SUBSCRIPTION),
      "/alpha/usage/summary": () => jsonResponse(SUMMARY),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "sk-test" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.quota.account).toEqual({
      login: "acme",
      orgId: "org_1",
      keyName: "prod-key",
    });
    expect(result.quota.credits).toMatchObject({ remainingCredits: 25 });
    expect(result.quota.credits?.windowLimits).toEqual([
      { window: "fiveHour", used: 1.5, cap: 10, resetAt: 1_790_913_204 },
      { window: "weekly", used: 6, cap: 40, resetAt: 1_790_913_600 },
    ]);
    expect(result.quota.subscription).toMatchObject({ planId: "pro", status: "active" });
    expect(result.quota.summary).toMatchObject({ totalCost: 3.25, totalCount: 42 });
    expect(result.quota.unavailable).toBeUndefined();

    for (const call of fetchSpy.mock.calls) {
      expect(authorizationFromCall(call)).toBe("Bearer sk-test");
    }
    const urls = (fetchSpy.mock.calls as Array<[string]>).map(([url]) => url);
    expect(urls[0]).toBe(`${BASE}/alpha/whoami`);
    expect(urls.some((url) => url.startsWith(`${BASE}/alpha/billing/credits?orgId=org_1`))).toBe(
      true,
    );
    expect(urls.some((url) => url.includes("since=2026-09-01T00%3A00%3A00.000Z"))).toBe(true);
  });

  it("keeps partial accounts by listing unavailable sections", async () => {
    globalThis.fetch = routedFetch({
      "/alpha/whoami": () => jsonResponse(WHOAMI),
      "/alpha/billing/credits": () => jsonResponse(CREDITS),
      "/alpha/billing/subscriptions": () => new Response("nope", { status: 500 }),
      "/alpha/usage/summary": () => new Response("nope", { status: 500 }),
    }) as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "sk-test" });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected success");
    expect(result.quota.credits).not.toBeNull();
    expect(result.quota.subscription).toBeNull();
    expect(result.quota.summary).toBeNull();
    expect(result.quota.unavailable).toEqual(["subscription", "usage"]);
  });

  it("explains how to fix a rejected key", async () => {
    globalThis.fetch = routedFetch({
      "/alpha/whoami": () => new Response("{}", { status: 401 }),
    }) as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "bad" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("pi /login");
  });

  it("reports a missing subscription", async () => {
    globalThis.fetch = routedFetch({
      "/alpha/whoami": () => new Response("{}", { status: 403 }),
    }) as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "sk-test" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("subscription required");
  });

  it("fails an unrecognized account response", async () => {
    globalThis.fetch = routedFetch({
      "/alpha/whoami": () => jsonResponse({ nothing: true }),
    }) as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "sk-test" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("unrecognized account");
  });

  it("fails when nothing recognized is returned", async () => {
    globalThis.fetch = routedFetch({
      "/alpha/whoami": () => jsonResponse(WHOAMI),
      "/alpha/billing/credits": () => jsonResponse({}),
      "/alpha/billing/subscriptions": () => jsonResponse({}),
      "/alpha/usage/summary": () => jsonResponse({}),
    }) as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "sk-test" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("no recognized usage data");
  });

  it("surfaces network failures without leaking the key", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("socket hang up sk-secret-token")) as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "sk-secret-token" });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).toContain("Failed to reach Command Code");
    expect(result.error).not.toContain("sk-secret-token");
  });

  it("redacts a key that straddles the error-body truncation boundary", async () => {
    const secret = "sk-secret-token";
    const body = "x".repeat(195) + secret + "tail";
    globalThis.fetch = routedFetch({
      "/alpha/whoami": () => new Response(body, { status: 500 }),
    }) as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: secret });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");
    expect(result.error).not.toContain("sk-secret");
    expect(result.error).not.toContain("sk-se");
  });

  it("maps a caller abort to a cancellation message", async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;

    const result = await queryCommandCodeQuota({ apiKey: "sk-test" }, controller.signal);

    expect(result).toMatchObject({ success: false, error: "Command Code quota request cancelled" });
  });

  it("maps the overall deadline to a timeout message", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    ) as unknown as typeof fetch;

    const pending = queryCommandCodeQuota({ apiKey: "sk-test" });
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(result).toMatchObject({ success: false, error: "Command Code quota request timed out" });
  });
});

describe("redactCommandCodeSecrets", () => {
  it("strips bearer tokens and credential JSON values", () => {
    expect(redactCommandCodeSecrets("Authorization: Bearer sk-abc123")).toBe(
      "Authorization: Bearer [redacted]",
    );
    expect(redactCommandCodeSecrets('{"apiKey":"supersecretvalue"}')).toBe(
      '{"apiKey":"[redacted]"}',
    );
  });

  it("strips an explicitly supplied secret wherever it appears", () => {
    expect(
      redactCommandCodeSecrets("socket hang up sk-secret-token", "sk-secret-token"),
    ).toBe("socket hang up [redacted]");
  });

  it("strips short supplied secrets too", () => {
    expect(redactCommandCodeSecrets("boom abc", "abc")).toBe("boom [redacted]");
  });
});

describe("windowLimitsFromCredits", () => {
  it("normalizes epoch seconds, milliseconds, ISO, and skips empty windows", () => {
    const limits = windowLimitsFromCredits({
      fiveHour: { used: 1, cap: 10, resetAt: 1_790_913_204 },
      weekly: { used: 2, cap: 20, resetAt: 1_790_913_204_000 },
      monthly: { used: 0, cap: 0, resetAt: 0 },
    });
    expect(limits).toEqual([
      { window: "fiveHour", used: 1, cap: 10, resetAt: 1_790_913_204 },
      { window: "weekly", used: 2, cap: 20, resetAt: 1_790_913_204 },
    ]);
  });

  it("returns an empty list for non-objects", () => {
    expect(windowLimitsFromCredits(null)).toEqual([]);
    expect(windowLimitsFromCredits("x")).toEqual([]);
  });
});

describe("normalizeResetAt", () => {
  it("handles seconds, milliseconds, and ISO strings", () => {
    expect(normalizeResetAt(1_790_913_204)).toBe(1_790_913_204);
    expect(normalizeResetAt(1_790_913_204_000)).toBe(1_790_913_204);
    expect(normalizeResetAt("2026-09-17T19:29:31.391Z")).toBe(1_789_673_371);
  });

  it("rejects invalid values", () => {
    expect(normalizeResetAt(undefined)).toBeNull();
    expect(normalizeResetAt(-1)).toBeNull();
    expect(normalizeResetAt("not a date")).toBeNull();
  });
});

describe("commandcode API key resolution", () => {
  it("reads apiKey and nested provider credentials", () => {
    expect(commandCodeApiKeyFromConfigData({ apiKey: "sk-a" })).toBe("sk-a");
    expect(commandCodeApiKeyFromConfigData({ commandcode: "sk-b" })).toBe("sk-b");
    expect(
      commandCodeApiKeyFromConfigData({ commandcode: { type: "oauth", access: "sk-c" } }),
    ).toBe("sk-c");
    expect(
      commandCodeApiKeyFromConfigData({ "command-code": { type: "api", key: "sk-d" } }),
    ).toBe("sk-d");
  });

  it("returns undefined when no key is present", () => {
    expect(commandCodeApiKeyFromConfigData({})).toBeUndefined();
    expect(commandCodeApiKeyFromConfigData({ commandcode: { type: "oauth" } })).toBeUndefined();
  });

  it("drops host-provided env-var placeholders", () => {
    expect(normalizeCommandCodeApiKey("COMMAND_CODE_API_KEY")).toBeUndefined();
    expect(normalizeCommandCodeApiKey("$COMMANDCODE_API_KEY")).toBeUndefined();
    expect(normalizeCommandCodeApiKey("  sk-real  ")).toBe("sk-real");
    expect(normalizeCommandCodeApiKey(undefined)).toBeUndefined();
  });
});
