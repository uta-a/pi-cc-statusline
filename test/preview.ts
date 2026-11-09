/**
 * Prints sample status lines with an ANSI theme close to claude-code-dark:
 *   node test/preview.ts [--plain]
 */
import { renderStatus, SEGMENTS, type Segment, type StatusInput, type ThemeLike } from "../extension/statusline.ts";

const plain = process.argv.includes("--plain");

const COLORS: Record<string, string> = {
	dim: "\x1b[38;2;153;153;153m",
	warning: "\x1b[38;2;255;193;7m",
	error: "\x1b[38;2;255;107;128m",
};

const theme: ThemeLike = { fg: (c, t) => `${COLORS[c] ?? ""}${t}\x1b[39m` };

const opus = { id: "claude-opus-5-5", name: "Claude Opus 5.5 1M", reasoning: true };

const full: StatusInput = {
	model: opus,
	thinkingLevel: "medium",
	branch: "main",
	contextPercent: 5,
	fiveHour: { utilization: 0.19 },
	weekly: { utilization: 0.37 },
	cacheHit: 0.966,
	tokensPerSecond: 56,
};

const samples: Record<string, [StatusInput, Segment[]?]> = {
	reference: [full],
	"uncommitted changes": [{ ...full, gitDirty: true }],
	"all segments": [full, [...SEGMENTS]],
	reordered: [full, ["model", "speed", "cache", "weekly"]],
	"before first response": [{ model: opus, thinkingLevel: "high", contextPercent: 0 }, [...SEGMENTS]],
	"running low": [{ ...full, thinkingLevel: "xhigh", contextPercent: 84, fiveHour: { utilization: 0.93 } }],
};

for (const [name, [input, segments]] of Object.entries(samples)) {
	const line = renderStatus(input, theme, segments);
	console.log(`\x1b[2m── ${name} ──\x1b[0m`);
	console.log(` ${plain ? line.replace(/\x1b\[[0-9;]*m/g, "") : line}\n`);
}
