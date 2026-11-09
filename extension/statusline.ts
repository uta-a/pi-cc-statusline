/**
 * Pure formatting for the status line:
 *   Opus 5.5 medium · Context 95% left · 5h 81% left · Weekly 63% left · Cache 97% hit · 56 tok/s
 */

export interface ThemeLike {
	fg(color: string, text: string): string;
}

export const SEGMENTS = ["model", "context", "5h", "weekly", "cache", "speed", "branch"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const DEFAULT_SEGMENTS: readonly Segment[] = ["model", "branch", "context", "5h"];

export const SEGMENT_LABELS: Record<Segment, string> = {
	model: "モデルと思考レベル",
	branch: "Git ブランチ（未コミット時 *）",
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
	branch?: string;
	gitDirty?: boolean;
	/** Context used, 0..100, or null/undefined when unknown */
	contextPercent?: number | null;
	fiveHour?: WindowUsage;
	weekly?: WindowUsage;
	/** Share of prompt tokens read from cache, 0..1 */
	cacheHit?: number;
	/** Output tokens per second over the recent responses */
	tokensPerSecond?: number;
	/** Milliseconds; injectable for tests */
	now?: number;
}

// Muted colors, with the model slightly brighter than the separators.
const COLORS: Record<Segment, readonly number[]> = {
	model: [0xb5, 0xb5, 0xb5],
	branch: [0x7a, 0xa2, 0xd6],
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

/**
 * Output speed over the last few responses: total output / total duration.
 *
 * Duration runs from the request start to the end of the response, so it includes the
 * wait for the first token. Timing the streamed deltas instead overstates the speed:
 * Claude Code can deliver a whole response's deltas in one burst at the end, and its
 * summarized thinking bills full thinking tokens while streaming only the summary.
 * Summing several responses keeps a one-word reply from dragging the value down.
 */
export class SpeedMeter {
	private readonly size: number;
	private samples: { output: number; durationMs: number }[] = [];

	constructor(size = 5) {
		this.size = size;
	}

	add(usage: UsageLike | undefined, durationMs: number | undefined): void {
		const output = usage?.output ?? 0;
		if (!durationMs || durationMs <= 0 || output <= 0) return;
		this.samples.push({ output, durationMs });
		if (this.samples.length > this.size) this.samples.shift();
	}

	get tokensPerSecond(): number | undefined {
		let output = 0;
		let ms = 0;
		for (const s of this.samples) {
			output += s.output;
			ms += s.durationMs;
		}
		return ms > 0 ? output / (ms / 1000) : undefined;
	}
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
			return rgb(COLORS.model, label);
		}
		case "branch": {
			if (!input.branch) return undefined;
			return rgb(COLORS.branch, `${input.branch}${input.gitDirty ? "*" : ""}`);
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
