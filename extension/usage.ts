/**
 * Plan usage for providers that publish it on an endpoint instead of in
 * response headers (opencode-go). Called only when the main model's provider
 * has an endpoint and no headers have reported a window yet, so a header-based
 * provider never costs a request.
 */
import type { ProviderUsage } from "./config.ts";
import type { WindowUsage } from "./statusline.ts";

const TIMEOUT_MS = 5_000;

/** Provider id → authenticated, read-only endpoint that returns the plan windows. */
export const USAGE_ENDPOINTS: Readonly<Record<string, string>> = {
	"opencode-go": "https://opencode.ai/zen/go/v1/usage",
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

export async function fetchPlanUsage(provider: string, apiKey: string): Promise<ProviderUsage | undefined> {
	const url = USAGE_ENDPOINTS[provider];
	if (!url) return undefined;
	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${apiKey}` },
		redirect: "error",
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) return undefined;
	return parseOpenCodeGoUsage(await response.json());
}
