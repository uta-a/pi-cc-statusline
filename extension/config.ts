/**
 * Files under the pi agent dir:
 *   pi-cc-statusline-settings.json  { "segments": [...] }  — what to show, in order
 *   pi-cc-statusline-cache.json     { "providers": { "<provider>": { fiveHour, weekly } } }
 *
 * Plan usage is kept per provider, so the line only shows the windows of the
 * main model's provider. v0.2.1 stored a single pair without a provider; that
 * shape is read as UNKNOWN_PROVIDER and adopted at startup.
 * v0.1.0 kept the 5h cache in pi-cc-statusline.json; that file is no longer read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SEGMENTS, isSegment, type Segment, type WindowUsage } from "./statusline.ts";

const SETTINGS_FILE = "pi-cc-statusline-settings.json";
const CACHE_FILE = "pi-cc-statusline-cache.json";

/** Plan usage of one provider. */
export interface ProviderUsage {
	fiveHour?: WindowUsage;
	weekly?: WindowUsage;
}

export interface UsageCache {
	/** Provider id → the last plan usage seen from that provider */
	providers: Record<string, ProviderUsage>;
}

/** Key for the provider-less pair that v0.2.x wrote; see adoptLegacyUsage. */
export const UNKNOWN_PROVIDER = "";

const readJson = (path: string): Record<string, unknown> | undefined => {
	try {
		const data = JSON.parse(readFileSync(path, "utf8"));
		return data && typeof data === "object" ? data : undefined;
	} catch {
		return undefined;
	}
};

const writeJson = (path: string, data: unknown) => {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, "\t")}\n`);
};

/** Unknown names are dropped and duplicates keep their first position. */
export function normalizeSegments(value: unknown): Segment[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return [...new Set(value.filter(isSegment))];
}

export function loadSegments(agentDir: string): Segment[] {
	return normalizeSegments(readJson(join(agentDir, SETTINGS_FILE))?.segments) ?? [...DEFAULT_SEGMENTS];
}

export function saveSegments(agentDir: string, segments: readonly Segment[]): void {
	writeJson(join(agentDir, SETTINGS_FILE), { segments });
}

const asWindow = (value: unknown): WindowUsage | undefined =>
	typeof (value as WindowUsage | undefined)?.utilization === "number" ? (value as WindowUsage) : undefined;

const asProviderUsage = (value: unknown): ProviderUsage | undefined => {
	const fiveHour = asWindow((value as ProviderUsage | undefined)?.fiveHour);
	const weekly = asWindow((value as ProviderUsage | undefined)?.weekly);
	if (!fiveHour && !weekly) return undefined;
	return { ...(fiveHour ? { fiveHour } : {}), ...(weekly ? { weekly } : {}) };
};

export function loadUsageCache(agentDir: string): UsageCache {
	const data = readJson(join(agentDir, CACHE_FILE));
	const providers: Record<string, ProviderUsage> = {};
	const stored = data?.providers;
	if (stored && typeof stored === "object") {
		for (const [provider, value] of Object.entries(stored as Record<string, unknown>)) {
			const usage = asProviderUsage(value);
			if (usage) providers[provider] = usage;
		}
	} else {
		const legacy = asProviderUsage(data);
		if (legacy) providers[UNKNOWN_PROVIDER] = legacy;
	}
	return { providers };
}

export function saveUsageCache(agentDir: string, cache: UsageCache): void {
	try {
		writeJson(join(agentDir, CACHE_FILE), cache);
	} catch {
		// The cache only saves a request's wait on startup; losing it is harmless
	}
}

/**
 * v0.2.x could not tell providers apart, so give its pair to the provider of the
 * model the session starts with. Returns whether the cache changed.
 */
export function adoptLegacyUsage(cache: UsageCache, provider: string | undefined): boolean {
	const legacy = cache.providers[UNKNOWN_PROVIDER];
	if (!legacy || !provider) return false;
	delete cache.providers[UNKNOWN_PROVIDER];
	cache.providers[provider] = { ...legacy, ...cache.providers[provider] };
	return true;
}
