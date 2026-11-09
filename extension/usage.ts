/**
 * Plan usage for providers that publish it on an endpoint instead of in
 * response headers (opencode-go and openai-codex). Only called for providers
 * with a known endpoint.
 */
import type { ProviderUsage } from "./config.ts";
import type { WindowUsage } from "./statusline.ts";

const TIMEOUT_MS = 5_000;

/** Provider id → authenticated, read-only endpoint that returns the plan windows. */
export const USAGE_ENDPOINTS: Readonly<Record<string, string>> = {
	"opencode-go": "https://opencode.ai/zen/go/v1/usage",
	"openai-codex": "https://chatgpt.com/backend-api/wham/usage",
};

/**
 * OpenCode Go publishes percent used (0..100) for its 5h (rolling), weekly and
 * monthly windows. Only the windows the status line shows are read; the monthly
 * allowance has no segment.
 */
export function parseOpenCodeGoUsage(body: unknown): ProviderUsage | undefined {
	const usage = (body as { usage?: Record<string, unknown> } | undefined)?.usage;
	if (!usage || typeof usage !== "object") return undefined;

	const window = (name: string): WindowUsage | undefined => {
		const raw = usage[name] as { percent?: unknown; resetsAt?: unknown } | undefined;
		if (typeof raw?.percent !== "number" || !Number.isFinite(raw.percent)) return undefined;
		const utilization = raw.percent / 100;
		const resetsAt = typeof raw.resetsAt === "string" ? Date.parse(raw.resetsAt) : Number.NaN;
		return Number.isFinite(resetsAt) ? { utilization, resetsAt: Math.floor(resetsAt / 1000) } : { utilization };
	};

	const fiveHour = window("rolling");
	const weekly = window("weekly");
	if (!fiveHour && !weekly) return undefined;
	return { ...(fiveHour ? { fiveHour } : {}), ...(weekly ? { weekly } : {}) };
}

/** Codex can return a weekly primary window and no secondary window. */
export function parseCodexUsage(body: unknown): ProviderUsage | undefined {
	const rate = (body as { rate_limit?: Record<string, unknown> } | null)?.rate_limit;
	if (!rate || typeof rate !== "object") return undefined;
	const plan: ProviderUsage = {};
	for (const name of ["primary_window", "secondary_window"]) {
		const raw = rate[name] as {
			used_percent?: unknown;
			limit_window_seconds?: unknown;
			reset_at?: unknown;
		} | null;
		if (typeof raw?.used_percent !== "number" || !Number.isFinite(raw.used_percent)) continue;
		const window: WindowUsage = { utilization: raw.used_percent / 100 };
		if (typeof raw.reset_at === "number" && Number.isFinite(raw.reset_at)) window.resetsAt = raw.reset_at;
		if (raw.limit_window_seconds === 18_000) plan.fiveHour = window;
		else if (raw.limit_window_seconds === 604_800) plan.weekly = window;
	}
	return plan.fiveHour || plan.weekly ? plan : undefined;
}

/** Use the account claim in the runtime's refreshed OAuth access token. */
function codexAccountId(token: string): string | undefined {
	try {
		const payload = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8"));
		const id = payload?.["https://api.openai.com/auth"]?.chatgpt_account_id;
		return typeof id === "string" ? id : undefined;
	} catch {
		return undefined;
	}
}

export async function fetchPlanUsage(provider: string, apiKey: string): Promise<ProviderUsage | undefined> {
	const url = USAGE_ENDPOINTS[provider];
	if (!url) return undefined;
	const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
	if (provider === "openai-codex") {
		const accountId = codexAccountId(apiKey);
		if (accountId) headers["ChatGPT-Account-Id"] = accountId;
	}
	const response = await fetch(url, {
		headers,
		redirect: "error",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) return undefined;
	const body = await response.json();
	return provider === "openai-codex" ? parseCodexUsage(body) : parseOpenCodeGoUsage(body);
}
