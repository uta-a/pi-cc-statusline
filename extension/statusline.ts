/**
 * Pure formatting for the status line:
 *   Opus 5.5 medium · Context 95% left · 5h 81% left
 */

export interface ThemeLike {
	fg(color: string, text: string): string;
}

/** Plan usage for the 5-hour window, as reported by the unified rate-limit headers. */
export interface FiveHourUsage {
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
	fiveHour?: FiveHourUsage;
	/** Milliseconds; injectable for tests */
	now?: number;
}

const HEADER_PREFIX = "anthropic-ratelimit-unified-5h-";

// Sampled from the reference screenshot; the model part uses the theme's dim
const CONTEXT_RGB = [0x83, 0xbe, 0xb2] as const;
const FIVE_HOUR_RGB = [0xbc, 0x99, 0xd4] as const;

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

/** Reads the 5h window from response headers (case-insensitive). */
export function parseFiveHour(headers: Record<string, string>): FiveHourUsage | undefined {
	let utilization: number | undefined;
	let resetsAt: number | undefined;
	for (const [key, value] of Object.entries(headers)) {
		const k = key.toLowerCase();
		if (!k.startsWith(HEADER_PREFIX)) continue;
		const n = Number(value);
		if (!Number.isFinite(n)) continue;
		if (k === `${HEADER_PREFIX}utilization`) utilization = n;
		else if (k === `${HEADER_PREFIX}reset`) resetsAt = n;
	}
	if (utilization === undefined) return undefined;
	return resetsAt === undefined ? { utilization } : { utilization, resetsAt };
}

/** Percent of the 5h window left; a window whose reset time has passed is full again. */
export function fiveHourLeft(usage: FiveHourUsage, now = Date.now()): number {
	if (usage.resetsAt !== undefined && usage.resetsAt * 1000 <= now) return 100;
	return clampPercent(100 - usage.utilization * 100);
}

export function contextLeft(percent: number): number {
	return clampPercent(100 - percent);
}

function clampPercent(n: number): number {
	return Math.min(100, Math.max(0, Math.round(n)));
}

/** Low values switch to the theme's warning/error colors. */
function colorLeft(theme: ThemeLike, left: number, base: readonly number[], text: string): string {
	if (left <= 10) return theme.fg("error", text);
	if (left <= 20) return theme.fg("warning", text);
	return rgb(base, text);
}

export function renderStatus(input: StatusInput, theme: ThemeLike): string {
	const parts: string[] = [];

	if (input.model) {
		let label = displayModelName(input.model);
		if (input.model.reasoning !== false && input.thinkingLevel) label += ` ${input.thinkingLevel}`;
		parts.push(theme.fg("dim", label));
	}

	if (typeof input.contextPercent === "number") {
		const left = contextLeft(input.contextPercent);
		parts.push(colorLeft(theme, left, CONTEXT_RGB, `Context ${left}% left`));
	}

	if (input.fiveHour) {
		const left = fiveHourLeft(input.fiveHour, input.now);
		parts.push(colorLeft(theme, left, FIVE_HOUR_RGB, `5h ${left}% left`));
	}

	return parts.join(theme.fg("dim", " · "));
}
