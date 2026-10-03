import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage, inMemoryAuthStorage } from "../lib/auth.js";
import {
  fetchAnthropicQuotasWithToken,
  fetchCodexQuotasWithToken,
  fetchCommandCodeQuotas,
  fetchGitHubCopilotQuotas,
  fetchGitHubCopilotQuotasWithToken,
  fetchKimiCodingQuotasWithToken,
  fetchOllamaCloudQuotasWithToken,
  fetchOpenCodeGoQuotas,
  fetchOpenRouterQuotasWithToken,
  fetchSyntheticQuotas,
  fetchXaiQuotasWithToken,
} from "./fetch.js";
import { resetOpenCodeGoApiKeyCache } from "./opencode-go-config.js";
import { resetCommandCodeApiKeyCache } from "./commandcode-config.js";

const originalFetch = globalThis.fetch;

function authorizationFromCall(call: unknown): string | undefined {
  const [, init] = call as [string, RequestInit];
  return (init?.headers as Record<string, string> | undefined)?.Authorization;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("fetchAnthropicQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchAnthropicQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("skips the OAuth usage call for a direct API key and returns not_applicable", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await fetchAnthropicQuotasWithToken("sk-ant-api03-direct-key");

    expect(result).toMatchObject({
      success: false,
      error: { kind: "not_applicable" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts OAuth tokens and parses quota windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          five_hour: { utilization: 21, resets_at: "2026-04-22T18:30:00Z" },
          seven_day: { utilization: 9, resets_at: "2026-04-25T08:30:00Z" },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchAnthropicQuotasWithToken("sk-ant-oat01-oauth-token");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("anthropic");
      expect(result.data.windows).toHaveLength(2);
    }
  });
});

describe("fetchCodexQuotasWithToken", () => {
  it("returns config error when account id missing", async () => {
    const result = await fetchCodexQuotasWithToken("token", undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses codex windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: 44,
              reset_at: 1776880800,
              limit_window_seconds: 18000,
            },
            secondary_window: {
              used_percent: 12,
              reset_at: 1777485600,
              limit_window_seconds: 604800,
            },
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchCodexQuotasWithToken("token", "acct_123");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("openai-codex");
      expect(result.data.windows).toHaveLength(2);
    }
  });
});

describe("fetchGitHubCopilotQuotasWithToken", () => {
  it("exchanges token then fetches usage on happy path", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "copilot-token" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            quota_reset_date: "2026-05-01T00:00:00Z",
            quota_snapshots: {
              premium_interactions: {
                entitlement: 300,
                remaining: 240,
                percent_remaining: 80,
              },
            },
          }),
          { status: 200 },
        ),
      ) as any;

    const result = await fetchGitHubCopilotQuotasWithToken("gh-token");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("github-copilot");
      expect(result.data.windows).toHaveLength(1);
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to direct token when exchange returns 401", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            quota_reset_date: "2026-05-01T00:00:00Z",
            quota_snapshots: {
              premium_interactions: { entitlement: 300, remaining: 293 },
            },
          }),
          { status: 200 },
        ),
      ) as any;

    const result = await fetchGitHubCopilotQuotasWithToken("gh-token");
    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the stored GitHub OAuth refresh token for Pi 0.74 Copilot quota checks", async () => {
    const auth = inMemoryAuthStorage({
      "github-copilot": {
        type: "oauth",
        refresh: "ghu-refresh-token",
        access: "tid=abc;proxy-ep=proxy.individual.githubcopilot.com;exp=1778611280",
        expires: Date.now() + 60_000,
      },
    });

    globalThis.fetch = vi.fn(async (_url, init) => {
      const authorization = new Headers(init?.headers).get("authorization");
      if (authorization === "Bearer ghu-refresh-token") {
        return new Response(
          JSON.stringify({
            quota_reset_date: "2026-05-01T00:00:00Z",
            quota_snapshots: {
              premium_interactions: { entitlement: 300, remaining: 210 },
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    }) as any;

    const result = await fetchGitHubCopilotQuotas(auth);

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.github.com/copilot_internal/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer ghu-refresh-token" }),
      }),
    );
  });
});

describe("fetchKimiCodingQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchKimiCodingQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses Kimi Code subscription windows", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            limit: "100",
            used: "20",
            remaining: "80",
            resetTime: "2026-08-10T10:01:47.875212Z",
          },
          limits: [
            {
              window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
              detail: {
                limit: "100",
                used: "45",
                resetTime: "2026-08-03T15:01:47.875212Z",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchKimiCodingQuotasWithToken("kimi-token");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("kimi-coding");
      expect(result.data.windows).toHaveLength(2);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.kimi.com/coding/v1/usages",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer kimi-token",
        }),
      }),
    );
  });
});

describe("fetchOpenRouterQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchOpenRouterQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses OpenRouter key info with budget", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            label: "Test Key",
            limit: 50,
            limit_remaining: 35,
            limit_reset: "monthly",
            usage: 15,
            usage_daily: 2.5,
            usage_weekly: 12,
            usage_monthly: 15,
            byok_usage: 0,
            byok_usage_daily: 0,
            byok_usage_weekly: 0,
            byok_usage_monthly: 0,
            is_free_tier: false,
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchOpenRouterQuotasWithToken("sk-or-test");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("openrouter");
      expect(result.data.windows).toHaveLength(4);
      expect(result.data.windows[0]).toMatchObject({
        label: "Monthly Budget",
        usedValue: 15,
        limitValue: 50,
      });
    }
  });

  it("handles HTTP error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Unauthorized", { status: 401 }),
    ) as any;

    const result = await fetchOpenRouterQuotasWithToken("bad-key");
    expect(result).toMatchObject({
      success: false,
      error: { kind: "http" },
    });
  });

  it("extracts a clean message from a JSON error body instead of raw JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { type: "authentication_error", message: "invalid x-api-key" },
        }),
        { status: 401 },
      ),
    ) as any;

    const result = await fetchOpenRouterQuotasWithToken("bad-key");
    expect(result).toMatchObject({ success: false, error: { kind: "http" } });
    if (!result.success) {
      expect(result.error.message).toBe("invalid x-api-key");
      expect(result.error.message).not.toContain("{");
    }
  });
});

describe("fetchSyntheticQuotas", () => {
  const authStorageWithKey = (key: string | undefined) =>
    ({
      getApiKey: vi.fn().mockResolvedValue(key),
    }) as unknown as AuthStorage;

  const quotasResponse = () =>
    new Response(
      JSON.stringify({
        weeklyTokenLimit: {
          nextRegenAt: "2026-01-08T00:00:00.000Z",
          percentRemaining: 90,
          maxCredits: "$24.00",
          remainingCredits: "$21.60",
          nextRegenCredits: "$0.48",
        },
        rollingFiveHourLimit: {
          nextTickAt: "2026-01-01T01:00:00.000Z",
          tickPercent: 0.05,
          remaining: 490,
          max: 500,
          limited: false,
        },
      }),
      { status: 200 },
    );

  afterEach(() => {
    delete process.env.SYNTHETIC_API_KEY;
  });

  it("prefers the auth.json key over SYNTHETIC_API_KEY", async () => {
    process.env.SYNTHETIC_API_KEY = "env-key";
    const fetchSpy = vi.fn().mockResolvedValue(quotasResponse());
    globalThis.fetch = fetchSpy as any;

    const result = await fetchSyntheticQuotas(authStorageWithKey("syn_stored"));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("synthetic");
      expect(result.data.windows.length).toBeGreaterThan(0);
    }
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer syn_stored",
    );
  });

  it("falls back to SYNTHETIC_API_KEY when no stored credential exists", async () => {
    process.env.SYNTHETIC_API_KEY = "env-key";
    const fetchSpy = vi.fn().mockResolvedValue(quotasResponse());
    globalThis.fetch = fetchSpy as any;

    const result = await fetchSyntheticQuotas(authStorageWithKey(undefined));
    expect(result.success).toBe(true);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer env-key",
    );
  });

  it("returns config error when neither auth.json nor env var provides a key", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as any;

    const result = await fetchSyntheticQuotas(authStorageWithKey(undefined));
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("fetchOllamaCloudQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchOllamaCloudQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses Ollama Cloud usage", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          limits: {
            session: { usage: 0.34, models: [] },
            weekly: { usage: 0.45, models: [] },
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchOllamaCloudQuotasWithToken("ollama-key");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("ollama-cloud");
      expect(result.data.windows).toHaveLength(2);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://ollama.com/api/usage",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer ollama-key",
        }),
      }),
    );
  });
});

describe("fetchXaiQuotasWithToken", () => {
  it("returns config error when token missing", async () => {
    const result = await fetchXaiQuotasWithToken(undefined);
    expect(result).toMatchObject({
      success: false,
      error: { kind: "config" },
    });
  });

  it("fetches and parses Grok subscription quotas", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          config: {
            currentPeriod: {
              type: "USAGE_PERIOD_TYPE_WEEKLY",
              start: "2026-08-25T17:13:55Z",
              end: "2026-09-01T17:13:55Z",
            },
            creditUsagePercent: 17,
            productUsage: [{ product: "GrokBuild", usagePercent: 10 }],
          },
        }),
        { status: 200 },
      ),
    ) as any;

    const result = await fetchXaiQuotasWithToken("xai-token");

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.provider).toBe("xai");
      expect(result.data.windows).toHaveLength(2);
    }
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer xai-token",
        }),
      }),
    );
  });

  it("reports Grok billing HTTP failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "token rejected" }), {
        status: 401,
      }),
    ) as any;

    const result = await fetchXaiQuotasWithToken("bad-token");

    expect(result).toMatchObject({
      success: false,
      error: { kind: "http", message: "token rejected" },
    });
  });
});

describe("fetchCommandCodeQuotas", () => {
  let homeDir = "";

  beforeEach(() => {
    // Hermetic: a real exported Command Code key would otherwise satisfy the
    // "no key exists anywhere" test and make a live call.
    vi.stubEnv("COMMAND_CODE_API_KEY", "");
    vi.stubEnv("COMMANDCODE_API_KEY", "");
    resetCommandCodeApiKeyCache();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetCommandCodeApiKeyCache();
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = "";
    }
  });

  async function stubEmptyHome() {
    homeDir = await mkdtemp(join(tmpdir(), "pi-usage-commandcode-home-"));
    vi.stubEnv("HOME", homeDir);
    resetCommandCodeApiKeyCache();
    return homeDir;
  }

  function mockAccountFetch() {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/alpha/whoami")) {
        return new Response(
          JSON.stringify({ org: { id: "org_1", login: "acme" } }),
          { status: 200 },
        );
      }
      if (url.includes("/alpha/billing/credits")) {
        return new Response(
          JSON.stringify({
            credits: { monthlyCredits: 20, purchasedCredits: 5, freeCredits: 0 },
            windowLimits: {
              fiveHour: { used: 2.5, cap: 10, resetAt: 1_790_913_204 },
              weekly: { used: 10, cap: 40, resetAt: 1_790_999_999 },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/alpha/billing/subscriptions")) {
        return new Response(
          JSON.stringify({ data: { planId: "pro", status: "active" } }),
          { status: 200 },
        );
      }
      if (url.includes("/alpha/usage/summary")) {
        return new Response(JSON.stringify({ totalCost: 5, totalCount: 10 }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    return fetchSpy;
  }

  it("uses the stored auth key and converts Command Code windows", async () => {
    await stubEmptyHome();
    const fetchSpy = mockAccountFetch();

    const result = await fetchCommandCodeQuotas(
      inMemoryAuthStorage({ commandcode: { apiKey: "sk-stored" } }),
    );

    expect(result).toMatchObject({ success: true });
    if (!result.success) throw new Error("expected success");
    expect(result.data.provider).toBe("commandcode");
    expect(result.data.windows.map((w) => w.label)).toEqual([
      "5h Rolling",
      "Weekly",
      "Monthly Budget",
    ]);
    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-stored");
  });

  it("reports a config error when no key exists anywhere", async () => {
    await stubEmptyHome();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchCommandCodeQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: false, error: { kind: "config" } });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toContain("pi /login");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prefers COMMAND_CODE_API_KEY over credential files", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".commandcode"), { recursive: true });
    await writeFile(
      join(home, ".commandcode", "auth.json"),
      JSON.stringify({ apiKey: "sk-from-file" }),
    );
    vi.stubEnv("COMMAND_CODE_API_KEY", "sk-from-env");
    const fetchSpy = mockAccountFetch();

    await fetchCommandCodeQuotas(inMemoryAuthStorage());

    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-from-env");
  });

  it("reads the Command Code CLI auth.json as a fallback", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".commandcode"), { recursive: true });
    await writeFile(
      join(home, ".commandcode", "auth.json"),
      JSON.stringify({ commandcode: { type: "oauth", access: "sk-cli" } }),
    );
    const fetchSpy = mockAccountFetch();

    const result = await fetchCommandCodeQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: true });
    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-cli");
  });

  it("reports HTTP failures as http errors", async () => {
    await stubEmptyHome();
    globalThis.fetch = vi.fn(
      async () => new Response("nope", { status: 500 }),
    ) as unknown as typeof fetch;

    const result = await fetchCommandCodeQuotas(
      inMemoryAuthStorage({ commandcode: { apiKey: "sk-stored" } }),
    );

    expect(result).toMatchObject({ success: false, error: { kind: "http" } });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toContain("Command Code");
  });

  it("ignores a placeholder stored key and falls back to the environment", async () => {
    await stubEmptyHome();
    vi.stubEnv("COMMAND_CODE_API_KEY", "sk-env");
    const fetchSpy = mockAccountFetch();

    const result = await fetchCommandCodeQuotas(
      inMemoryAuthStorage({ commandcode: { apiKey: "COMMAND_CODE_API_KEY" } }),
    );

    expect(result).toMatchObject({ success: true });
    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-env");
  });

  it("continues past a malformed auth file to a valid one", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".commandcode"), { recursive: true });
    await mkdir(join(home, ".omp", "agent"), { recursive: true });
    await writeFile(join(home, ".commandcode", "auth.json"), "{ not json sk-secret-leak");
    await writeFile(
      join(home, ".omp", "agent", "auth.json"),
      JSON.stringify({ commandcode: { type: "api", key: "sk-omp" } }),
    );
    const fetchSpy = mockAccountFetch();

    const result = await fetchCommandCodeQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: true });
    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-omp");
  });

  it("does not leak auth-file contents in a config error", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".commandcode"), { recursive: true });
    await writeFile(join(home, ".commandcode", "auth.json"), "{ not json sk-secret-leak");

    const result = await fetchCommandCodeQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: false, error: { kind: "config" } });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).not.toContain("sk-secret-leak");
    expect(result.error.message).toContain("not valid JSON");
  });
});

describe("fetchOpenCodeGoQuotas", () => {
  let homeDir = "";

  beforeEach(() => {
    // Hermetic: a real exported OPENCODE_GO_API_KEY would otherwise win over
    // the empty in-memory auth storage and turn these "no credentials" tests
    // into live-credential fetches. vi.unstubAllEnvs restores the original in
    // afterEach.
    vi.stubEnv("OPENCODE_GO_API_KEY", "");
    vi.stubEnv("OPENCODE_API_KEY", "");
    resetOpenCodeGoApiKeyCache();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetOpenCodeGoApiKeyCache();
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = "";
    }
  });

  async function stubEmptyHome() {
    homeDir = await mkdtemp(join(tmpdir(), "pi-usage-go-home-"));
    vi.stubEnv("HOME", homeDir);
    resetOpenCodeGoApiKeyCache();
    return homeDir;
  }

  it("uses the stored auth.json key and converts windows", async () => {
    await stubEmptyHome();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            rolling: { status: "ok", percent: 12, resetsAt: "2026-09-17T19:29:31.391Z" },
            weekly: { status: "ok", percent: 34, resetsAt: "2026-09-21T00:00:00.000Z" },
            monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-10-16T13:49:43.000Z" },
          },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchOpenCodeGoQuotas(
      inMemoryAuthStorage({ "opencode-go": { apiKey: "sk-stored" } }),
    );

    expect(result).toMatchObject({ success: true });
    if (!result.success) throw new Error("expected success");
    expect(result.data.windows.map((w) => w.label)).toEqual([
      "5h Rolling",
      "Weekly",
      "Monthly",
    ]);
    expect(result.data.windows[2]).toMatchObject({ usedPercent: 100, limited: true });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-stored");
  });

  it("reports a config error when no key exists anywhere", async () => {
    await stubEmptyHome();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchOpenCodeGoQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: false, error: { kind: "config" } });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toContain("pi /login opencode-go");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prefers OPENCODE_GO_API_KEY over credential files", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".config", "opencode", "opencode-quota"), { recursive: true });
    await writeFile(
      join(home, ".config", "opencode", "opencode-quota", "opencode-go.json"),
      JSON.stringify({ apiKey: "sk-from-file" }),
    );
    vi.stubEnv("OPENCODE_GO_API_KEY", "sk-from-env");
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ usage: { rolling: { percent: 1 } } }), { status: 200 }),
    ) as unknown as typeof fetch;

    await fetchOpenCodeGoQuotas(inMemoryAuthStorage());
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://opencode.ai/zen/go/v1/usage");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-from-env");
  });

  it("falls back to OPENCODE_API_KEY, the variable Pi's own provider uses", async () => {
    await stubEmptyHome();
    vi.stubEnv("OPENCODE_API_KEY", "sk-pi-env");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ usage: { rolling: { percent: 1 } } }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await fetchOpenCodeGoQuotas(inMemoryAuthStorage());

    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-pi-env");
  });

  it("prefers OPENCODE_GO_API_KEY over Pi's resolved generic key", async () => {
    await stubEmptyHome();
    vi.stubEnv("OPENCODE_GO_API_KEY", "sk-go-env");
    vi.stubEnv("OPENCODE_API_KEY", "sk-pi-env");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ usage: { rolling: { percent: 1 } } }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Pi's resolved lookup returns the generic OPENCODE_API_KEY (its own
    // opencode-go provider auth) while no credential is stored, so the
    // Go-specific variable must still win.
    const resolvedOnlyStorage = {
      get: () => undefined,
      getApiKey: async () => "sk-pi-env",
    };

    await fetchOpenCodeGoQuotas(resolvedOnlyStorage);

    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-go-env");
  });

  it("prefers the stored credential over both environment variables", async () => {
    await stubEmptyHome();
    vi.stubEnv("OPENCODE_GO_API_KEY", "sk-go-env");
    vi.stubEnv("OPENCODE_API_KEY", "sk-pi-env");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ usage: { rolling: { percent: 1 } } }), { status: 200 }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await fetchOpenCodeGoQuotas(
      inMemoryAuthStorage({ "opencode-go": { apiKey: "sk-stored" } }),
    );

    expect(authorizationFromCall(fetchSpy.mock.calls[0])).toBe("Bearer sk-stored");
  });

  it("does not leak OpenCode CLI auth-file contents in a config error", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".local", "share", "opencode"), { recursive: true });
    await writeFile(
      join(home, ".local", "share", "opencode", "auth.json"),
      "{ not json sk-secret-leak",
    );

    const result = await fetchOpenCodeGoQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: false, error: { kind: "config" } });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).not.toContain("sk-secret-leak");
    expect(result.error.message).toContain("not valid JSON");
  });

  it("explains the migration for a legacy workspaceId/authCookie config", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".config", "opencode", "opencode-quota"), { recursive: true });
    await writeFile(
      join(home, ".config", "opencode", "opencode-quota", "opencode-go.json"),
      JSON.stringify({ workspaceId: "wrk_1", authCookie: "Fe26.2**abc" }),
    );

    const result = await fetchOpenCodeGoQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: false, error: { kind: "config" } });
    if (result.success) throw new Error("expected failure");
    expect(result.error.message).toContain("no longer supported");
  });

  it("reads the OpenCode CLI auth.json as a fallback", async () => {
    const home = await stubEmptyHome();
    await mkdir(join(home, ".local", "share", "opencode"), { recursive: true });
    await writeFile(
      join(home, ".local", "share", "opencode", "auth.json"),
      JSON.stringify({ "opencode-go": { type: "api_key", key: "sk-cli" } }),
    );
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ usage: { rolling: { percent: 2 } } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await fetchOpenCodeGoQuotas(inMemoryAuthStorage());

    expect(result).toMatchObject({ success: true });
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-cli");
  });
});
