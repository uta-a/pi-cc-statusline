/**
 * Files under the pi agent dir:
 *   pi-cc-statusline-settings.json  { "segments": [...] }  — what to show, in order
 *   pi-cc-statusline-cache.json     { "fiveHour", "weekly" } — last plan usage seen
 *
 * v0.1.0 kept the 5h cache in pi-cc-statusline.json; that file is no longer read.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_SEGMENTS, isSegment, type Segment, type WindowUsage } from "./statusline.ts";

const SETTINGS_FILE = "pi-cc-statusline-settings.json";
const CACHE_FILE = "pi-cc-statusline-cache.json";

export interface UsageCache {
	fiveHour?: WindowUsage;
	weekly?: WindowUsage;
}

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

export function loadUsageCache(agentDir: string): UsageCache {
	const data = readJson(join(agentDir, CACHE_FILE));
	return { fiveHour: asWindow(data?.fiveHour), weekly: asWindow(data?.weekly) };
}

export function saveUsageCache(agentDir: string, cache: UsageCache): void {
	try {
		writeJson(join(agentDir, CACHE_FILE), cache);
	} catch {
		// The cache only saves a request's wait on startup; losing it is harmless
	}
}
