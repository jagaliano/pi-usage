/**
 * Command Code client.
 *
 * Reads account usage from the Command Code API (commandcode.ai). The
 * request/parse logic mirrors `pi-commandcode-provider` (src/quota.ts) so the
 * two packages agree on endpoints and window semantics:
 *
 *   GET https://api.commandcode.ai/alpha/whoami
 *   GET /alpha/billing/credits?orgId=<org>
 *   GET /alpha/billing/subscriptions?orgId=<org>
 *   GET /alpha/usage/summary?orgId=<org>&since=<periodStart>
 *   Authorization: Bearer <Command Code API key>
 *
 * Configuration:
 * - Pi auth entry: `pi /login` → Command Code (preferred)
 * - Environment: COMMAND_CODE_API_KEY or COMMANDCODE_API_KEY
 * - Auth files: ~/.commandcode/auth.json, ~/.omp/agent/auth.json
 */

const DEFAULT_API_BASE = "https://api.commandcode.ai";
const QUOTA_TIMEOUT_MS = 15_000;

export interface CommandCodeWindowLimit {
  window: "fiveHour" | "weekly";
  used: number;
  cap: number;
  resetAt: number | null;
}

export interface CommandCodeCredits {
  monthlyCredits: number;
  purchasedCredits: number;
  freeCredits: number;
  remainingCredits: number;
  windowLimits: CommandCodeWindowLimit[];
}

export interface CommandCodeSubscription {
  planId: string | null;
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}

export interface CommandCodeUsageSummary {
  totalCost: number;
  totalCount: number;
  totalTokens?: number;
}

export type CommandCodeQuotaSection = "credits" | "subscription" | "usage";

export interface CommandCodeQuota {
  account: { login: string; orgId: string | null; keyName?: string };
  credits: CommandCodeCredits | null;
  subscription: CommandCodeSubscription | null;
  summary: CommandCodeUsageSummary | null;
  unavailable?: CommandCodeQuotaSection[];
}

export interface CommandCodeQueryConfig {
  apiKey: string;
  baseUrl?: string;
}

export type CommandCodeResult =
  | { success: true; quota: CommandCodeQuota }
  | { success: false; error: string };

type RequestOutcome =
  | { kind: "ok"; data: unknown }
  | { kind: "http"; status: number; body: string }
  | { kind: "network"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timestampValue(value: unknown): string | undefined {
  const text = stringValue(value);
  if (text) return text;
  const number = numberValue(value);
  return number === undefined ? undefined : String(number);
}

/** Strip bearer tokens, credential-looking JSON values, and known secrets. */
export function redactCommandCodeSecrets(text: string, secret?: string): string {
  let redacted = text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(
      /("\s*(?:api[-_ ]?key|apikey|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|authorization)\s*"\s*:\s*")([^"]{8,})/gi,
      "$1[redacted]",
    );
  // Replace the caller's known key whatever its length: a short key would
  // otherwise survive network-error text and appear in the UI.
  if (secret) {
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted.trim();
}

/**
 * Normalize a reset timestamp to epoch seconds.
 *
 * Command Code returns epoch seconds, epoch milliseconds, or an ISO string
 * depending on the endpoint; `normalizeResetAt` folds all three into seconds.
 */
export function normalizeResetAt(value: unknown): number | null {
  let timestamp: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) timestamp = value;
  if (typeof value === "string" && value.length > 0) {
    const trimmed = value.trim();
    timestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0) {
    return null;
  }
  return timestamp >= 1e12 ? Math.round(timestamp / 1000) : timestamp;
}

export function windowLimitsFromCredits(value: unknown): CommandCodeWindowLimit[] {
  if (!isRecord(value)) return [];
  const limits: CommandCodeWindowLimit[] = [];
  for (const [window, entry] of [
    ["fiveHour", value.fiveHour],
    ["weekly", value.weekly],
  ] as const) {
    if (!isRecord(entry)) continue;
    const used = numberValue(entry.used);
    const cap = numberValue(entry.cap);
    if (used === undefined || cap === undefined || (used === 0 && cap === 0)) continue;
    limits.push({ window, used, cap, resetAt: normalizeResetAt(entry.resetAt) });
  }
  return limits;
}

function parseCredits(value: unknown): CommandCodeCredits | null {
  if (!isRecord(value) || !isRecord(value.credits)) return null;
  const credits = value.credits;
  const monthlyCredits = numberValue(credits.monthlyCredits);
  const purchasedCredits = numberValue(credits.purchasedCredits);
  const freeCredits = numberValue(credits.freeCredits);
  if (
    monthlyCredits === undefined &&
    purchasedCredits === undefined &&
    freeCredits === undefined
  ) {
    return null;
  }
  const monthly = monthlyCredits ?? 0;
  const purchased = purchasedCredits ?? 0;
  const free = freeCredits ?? 0;
  return {
    monthlyCredits: monthly,
    purchasedCredits: purchased,
    freeCredits: free,
    remainingCredits: monthly + purchased + free,
    windowLimits: windowLimitsFromCredits(value.windowLimits),
  };
}

function parseSubscription(value: unknown): CommandCodeSubscription | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const data = value.data;
  const planId = stringValue(data.planId);
  const status = stringValue(data.status);
  const currentPeriodStart = timestampValue(data.currentPeriodStart);
  const currentPeriodEnd = timestampValue(data.currentPeriodEnd);
  if (!planId && !status && !currentPeriodStart && !currentPeriodEnd) return null;
  return {
    planId: planId ?? null,
    status: status ?? null,
    currentPeriodStart: currentPeriodStart ?? null,
    currentPeriodEnd: currentPeriodEnd ?? null,
  };
}

function parseSummary(value: unknown): CommandCodeUsageSummary | null {
  if (!isRecord(value)) return null;
  const totalCost = numberValue(value.totalCost);
  const totalCount = numberValue(value.totalCount);
  if (totalCost === undefined || totalCount === undefined) return null;
  const totalTokens = numberValue(value.totalTokens) ?? numberValue(value.tokens);
  return { totalCost, totalCount, ...(totalTokens === undefined ? {} : { totalTokens }) };
}

function parseWhoami(
  value: unknown,
): { login: string; orgId: string | null; keyName?: string } | null {
  if (!isRecord(value)) return null;
  const org = isRecord(value.org) ? value.org : undefined;
  const user = isRecord(value.user) ? value.user : undefined;
  const login =
    (org ? stringValue(org.login) : undefined) ??
    (user ? (stringValue(user.userName) ?? stringValue(user.name)) : undefined);
  if (!login) return null;
  const orgId = org ? stringValue(org.id) : undefined;
  const keyName = user ? (stringValue(user.keyName) ?? stringValue(user.displayName)) : undefined;
  return { login, orgId: orgId ?? null, ...(keyName ? { keyName } : {}) };
}

function buildUrl(path: string, params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function isBlockingStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function errorForStatus(status: number, body: string, context: string, secret?: string): string {
  if (status === 401) {
    return (
      "Command Code API key rejected (401). Run `pi /login` and select Command Code," +
      " or set COMMAND_CODE_API_KEY"
    );
  }
  if (status === 403) {
    return "Command Code subscription required (403). Subscribe to Command Code first.";
  }
  // Redact the *whole* body before truncating: truncating first could clip a
  // known key in half, leaving an unmatched fragment in the message.
  const detail = redactCommandCodeSecrets(body.trim(), secret).slice(0, 200);
  return `Command Code ${context} request failed (${status}): ${
    detail || "unexpected response"
  }`;
}

/**
 * Fetch Command Code usage and quota.
 *
 * `whoami` is required (it supplies the org id used by the other calls);
 * credits, subscription, and summary are best-effort, so a partially
 * configured account still reports whatever it can.
 */
export async function queryCommandCodeQuota(
  config: CommandCodeQueryConfig,
  signal?: AbortSignal,
): Promise<CommandCodeResult> {
  const baseUrl = config.baseUrl ?? DEFAULT_API_BASE;

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), QUOTA_TIMEOUT_MS);
  const signals: AbortSignal[] = [timeoutController.signal];
  if (signal) signals.push(signal);
  const combined = AbortSignal.any(signals);
  const timedOut = () => timeoutController.signal.aborted;

  const headers = {
    accept: "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  async function request(path: string): Promise<RequestOutcome> {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "GET",
        headers,
        signal: combined,
      });
      if (!response.ok) {
        return {
          kind: "http",
          status: response.status,
          body: await response.text().catch(() => ""),
        };
      }
      return { kind: "ok", data: await response.json().catch(() => null) };
    } catch (error) {
      if (timedOut()) return { kind: "network", message: "__timeout__" };
      if (signal?.aborted) return { kind: "network", message: "__cancelled__" };
      return {
        kind: "network",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    const whoami = await request("/alpha/whoami");
    if (whoami.kind === "network") {
      if (whoami.message === "__timeout__") {
        return { success: false, error: "Command Code quota request timed out" };
      }
      if (whoami.message === "__cancelled__") {
        return { success: false, error: "Command Code quota request cancelled" };
      }
      return {
        success: false,
        error: redactCommandCodeSecrets(
          `Failed to reach Command Code: ${whoami.message}`,
          config.apiKey,
        ),
      };
    }
    if (whoami.kind === "http") {
      return {
        success: false,
        error: errorForStatus(whoami.status, whoami.body, "whoami", config.apiKey),
      };
    }

    const account = parseWhoami(whoami.data);
    if (!account) {
      return {
        success: false,
        error: "Command Code returned an unrecognized account response",
      };
    }

    const orgId = account.orgId ?? undefined;
    const [creditsOutcome, subscriptionOutcome] = await Promise.all([
      request(buildUrl("/alpha/billing/credits", { orgId })),
      request(buildUrl("/alpha/billing/subscriptions", { orgId })),
    ]);

    for (const outcome of [creditsOutcome, subscriptionOutcome]) {
      if (outcome.kind === "http" && isBlockingStatus(outcome.status)) {
        return {
          success: false,
          error: errorForStatus(outcome.status, outcome.body, "billing", config.apiKey),
        };
      }
    }

    const credits = creditsOutcome.kind === "ok" ? parseCredits(creditsOutcome.data) : null;
    const subscription =
      subscriptionOutcome.kind === "ok" ? parseSubscription(subscriptionOutcome.data) : null;

    const summaryOutcome = await request(
      buildUrl("/alpha/usage/summary", {
        orgId,
        since: subscription?.currentPeriodStart ?? undefined,
      }),
    );
    if (summaryOutcome.kind === "http" && isBlockingStatus(summaryOutcome.status)) {
      return {
        success: false,
        error: errorForStatus(
          summaryOutcome.status,
          summaryOutcome.body,
          "usage summary",
          config.apiKey,
        ),
      };
    }
    const summary = summaryOutcome.kind === "ok" ? parseSummary(summaryOutcome.data) : null;

    if (!credits && !subscription && !summary) {
      if (timedOut()) {
        return { success: false, error: "Command Code quota request timed out" };
      }
      return {
        success: false,
        error: "Command Code returned no recognized usage data for the account",
      };
    }

    const unavailable: CommandCodeQuotaSection[] = [];
    if (!credits) unavailable.push("credits");
    if (!subscription) unavailable.push("subscription");
    if (!summary) unavailable.push("usage");

    return {
      success: true,
      quota: {
        account,
        credits,
        subscription,
        summary,
        ...(unavailable.length > 0 ? { unavailable } : {}),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
