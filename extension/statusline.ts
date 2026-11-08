/**
 * Pure formatting for the status line:
 *   Opus 5.5 medium · Context 95% left · 5h 81% left · Weekly 63% left · Cache 97% hit · 56 tok/s
 */

export interface ThemeLike {
	fg(color: string, text: string): string;
}

export const SEGMENTS = ["model", "context", "5h", "weekly", "cache", "speed"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const DEFAULT_SEGMENTS: readonly Segment[] = ["model", "context", "5h"];

export const SEGMENT_LABELS: Record<Segment, string> = {
	model: "モデルと思考レベル",
	context: "コンテキスト残量",
	"5h": "5 時間枠の残量",
	weekly: "週間枠の残量",
	cache: "キャッシュヒット率",
	speed: "出力速度 (tok/s)",
};

export const isSegment = (value: unknown): value is Segment => SEGMENTS.includes(value as Segment);

/** Plan usage for one rate-limit window, as reported by the unified rate-limit headers. */
export interface WindowUsage {
	/** Fraction used, 0..1 (can exceed 1 while on overage) */
	utilization: number;
	/** Unix seconds when the window resets, if known */
	resetsAt?: number;
}

export interface StatusInput {
	model?: { id: string; name?: string; reasoning?: boolean };
	thinkingLevel?: string;
	/** Context used, 0..100, or null/undefined when unknown */
	contextPercent?: number | null;
	fiveHour?: WindowUsage;
	weekly?: WindowUsage;
	/** Share of prompt tokens read from cache, 0..1 */
	cacheHit?: number;
	/** Output tokens per second of the last response */
	tokensPerSecond?: number;
	/** Milliseconds; injectable for tests */
	now?: number;
}

// Sampled from the reference screenshot; the model part uses the theme's dim
const COLORS: Record<Exclude<Segment, "model">, readonly number[]> = {
	context: [0x83, 0xbe, 0xb2],
	"5h": [0xbc, 0x99, 0xd4],
	weekly: [0xd4, 0x9f, 0xb6],
	cache: [0x9d, 0xb8, 0xdc],
	speed: [0xd6, 0xb8, 0x8a],
};

const rgb = ([r, g, b]: readonly number[], text: string) => `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;

/** "Claude Opus 5.5 1M" / "claude-opus-5-5" → "Opus 5.5" */
export function displayModelName(model: { id: string; name?: string }): string {
	const name = model.name?.trim();
	if (name && name !== model.id) {
		return name
			.replace(/^claude\s+/i, "")
			.replace(/\s*\(?\b1M\b\)?(\s+context)?$/i, "")
			.trim();
	}
	const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/i.exec(model.id);
	if (!m) return model.id;
	const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
	return `${family} ${m[3] ? `${m[2]}.${m[3]}` : m[2]}`;
}

/**
 * Reads one window from response headers (case-insensitive).
 * `name` is the header abbreviation: "5h" or "7d".
 */
export function parseWindow(headers: Record<string, string>, name: string): WindowUsage | undefined {
	const prefix = `anthropic-ratelimit-unified-${name}-`;
	let utilization: number | undefined;
	let resetsAt: number | undefined;
	for (const [key, value] of Object.entries(headers)) {
		const k = key.toLowerCase();
		if (!k.startsWith(prefix)) continue;
		const n = Number(value);
		if (!Number.isFinite(n)) continue;
		if (k === `${prefix}utilization`) utilization = n;
		else if (k === `${prefix}reset`) resetsAt = n;
	}
	if (utilization === undefined) return undefined;
	return resetsAt === undefined ? { utilization } : { utilization, resetsAt };
}

/** Percent of a window left; a window whose reset time has passed is full again. */
export function windowLeft(usage: WindowUsage, now = Date.now()): number {
	if (usage.resetsAt !== undefined && usage.resetsAt * 1000 <= now) return 100;
	return clampPercent(100 - usage.utilization * 100);
}

export function contextLeft(percent: number): number {
	return clampPercent(100 - percent);
}

function clampPercent(n: number): number {
	return Math.min(100, Math.max(0, Math.round(n)));
}

/** Token usage of one response, as stored on assistant messages. */
export interface UsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

/** Running totals for the cache hit rate. */
export class CacheStats {
	read = 0;
	prompt = 0;

	add(usage: UsageLike | undefined): void {
		if (!usage) return;
		const read = usage.cacheRead ?? 0;
		this.read += read;
		this.prompt += (usage.input ?? 0) + read + (usage.cacheWrite ?? 0);
	}

	get hitRate(): number | undefined {
		return this.prompt > 0 ? this.read / this.prompt : undefined;
	}
}

/** Output speed of a response; undefined when it is too short to measure. */
export function tokensPerSecond(usage: UsageLike | undefined, durationMs: number | undefined): number | undefined {
	const output = usage?.output ?? 0;
	if (!durationMs || durationMs < 100 || output <= 0) return undefined;
	return output / (durationMs / 1000);
}

/** Low values switch to the theme's warning/error colors. */
function colorLeft(theme: ThemeLike, left: number, base: readonly number[], text: string): string {
	if (left <= 10) return theme.fg("error", text);
	if (left <= 20) return theme.fg("warning", text);
	return rgb(base, text);
}

function renderSegment(segment: Segment, input: StatusInput, theme: ThemeLike): string | undefined {
	switch (segment) {
		case "model": {
			if (!input.model) return undefined;
			let label = displayModelName(input.model);
			if (input.model.reasoning !== false && input.thinkingLevel) label += ` ${input.thinkingLevel}`;
			return theme.fg("dim", label);
		}
		case "context": {
			if (typeof input.contextPercent !== "number") return undefined;
			const left = contextLeft(input.contextPercent);
			return colorLeft(theme, left, COLORS.context, `Context ${left}% left`);
		}
		case "5h": {
			if (!input.fiveHour) return undefined;
			const left = windowLeft(input.fiveHour, input.now);
			return colorLeft(theme, left, COLORS["5h"], `5h ${left}% left`);
		}
		case "weekly": {
			if (!input.weekly) return undefined;
			const left = windowLeft(input.weekly, input.now);
			return colorLeft(theme, left, COLORS.weekly, `Weekly ${left}% left`);
		}
		case "cache": {
			if (input.cacheHit === undefined) return undefined;
			return rgb(COLORS.cache, `Cache ${Math.round(input.cacheHit * 100)}% hit`);
		}
		case "speed": {
			if (input.tokensPerSecond === undefined) return undefined;
			return rgb(COLORS.speed, `${Math.round(input.tokensPerSecond)} tok/s`);
		}
	}
}

export function renderStatus(input: StatusInput, theme: ThemeLike, segments: readonly Segment[] = DEFAULT_SEGMENTS): string {
	const parts: string[] = [];
	for (const segment of segments) {
		const part = renderSegment(segment, input, theme);
		if (part) parts.push(part);
	}
	return parts.join(theme.fg("dim", " · "));
}
