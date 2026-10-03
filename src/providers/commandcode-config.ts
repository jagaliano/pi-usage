import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type ResolvedCommandCodeApiKey =
  | { state: "configured"; apiKey: string; source: string }
  | { state: "none" }
  | { state: "invalid"; source: string; error: string };

/**
 * Some hosts pass a literal env-var name as the "resolved" key instead of the
 * credential itself. Treat those as unresolved, matching
 * `pi-commandcode-provider`.
 */
const PLACEHOLDER_KEYS = new Set([
  "$COMMAND_CODE_API_KEY",
  "COMMAND_CODE_API_KEY",
  "$COMMANDCODE_API_KEY",
  "COMMANDCODE_API_KEY",
]);

function getApiKeyCandidatePaths(): string[] {
  const home = homedir();
  return [
    join(home, ".commandcode", "auth.json"),
    join(home, ".omp", "agent", "auth.json"),
  ];
}

/** Trim a candidate key and drop host-provided env-var placeholders. */
export function normalizeCommandCodeApiKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || PLACEHOLDER_KEYS.has(trimmed)) return undefined;
  return trimmed;
}

function credentialKey(value: unknown): string | undefined {
  if (typeof value === "string") return normalizeCommandCodeApiKey(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  // pi stores OAuth credentials as {"commandcode": {"type":"oauth","access":"..."}}.
  return normalizeCommandCodeApiKey(record.access) ?? normalizeCommandCodeApiKey(record.key);
}

/** Extract a Command Code API key from an auth.json document. */
export function commandCodeApiKeyFromConfigData(
  data: Record<string, unknown>,
): string | undefined {
  const direct =
    normalizeCommandCodeApiKey(data.apiKey) ??
    credentialKey(data.commandcode) ??
    credentialKey(data["command-code"]);
  return direct;
}

export function resolveCommandCodeApiKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Extract<ResolvedCommandCodeApiKey, { state: "configured" }> | null {
  const apiKey =
    normalizeCommandCodeApiKey(env.COMMAND_CODE_API_KEY) ??
    normalizeCommandCodeApiKey(env.COMMANDCODE_API_KEY);
  if (!apiKey) return null;
  return { state: "configured", apiKey, source: "env" };
}

async function readJson(
  path: string,
): Promise<
  | { state: "missing" }
  | { state: "loaded"; data: Record<string, unknown> }
  | { state: "invalid"; error: string }
> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return { state: "missing" };
    }
    // Never surface raw parser/OS diagnostics: JSON.parse errors quote the
    // offending input, which for an auth file is the credential itself.
    return { state: "invalid", error: "Failed to read config file" };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { state: "invalid", error: "Config file must contain a JSON object" };
    }
    return { state: "loaded", data: parsed as Record<string, unknown> };
  } catch {
    return { state: "invalid", error: "Config file is not valid JSON" };
  }
}

export async function resolveCommandCodeApiKeyFromFiles(): Promise<ResolvedCommandCodeApiKey> {
  // A malformed file should not hide a usable credential in a later file
  // (matching pi-commandcode-provider): remember it and only report it if
  // nothing else works.
  let firstInvalid: { source: string; error: string } | null = null;
  for (const path of getApiKeyCandidatePaths()) {
    const fileResult = await readJson(path);
    if (fileResult.state === "missing") continue;
    if (fileResult.state === "invalid") {
      firstInvalid ??= { source: path, error: fileResult.error };
      continue;
    }
    const apiKey = commandCodeApiKeyFromConfigData(fileResult.data);
    if (apiKey) return { state: "configured", apiKey, source: path };
  }
  if (firstInvalid) {
    return { state: "invalid", source: firstInvalid.source, error: firstInvalid.error };
  }
  return { state: "none" };
}

let cached: ResolvedCommandCodeApiKey | null = null;
let cachedAt = 0;

const CACHE_MAX_AGE_MS = 30_000;

/** Test hook: drop the memoized file-resolution result. */
export function resetCommandCodeApiKeyCache(): void {
  cached = null;
  cachedAt = 0;
}

export async function resolveCommandCodeApiKeyFromFilesCached(params?: {
  maxAgeMs?: number;
}): Promise<ResolvedCommandCodeApiKey> {
  const maxAgeMs = Math.max(0, params?.maxAgeMs ?? CACHE_MAX_AGE_MS);
  const now = Date.now();
  if (cached && now - cachedAt < maxAgeMs) return cached;
  cached = await resolveCommandCodeApiKeyFromFiles();
  cachedAt = now;
  return cached;
}
