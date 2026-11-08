/**
 * Prints sample status lines with an ANSI theme close to claude-code-dark:
 *   node test/preview.ts [--plain]
 */
import { renderStatus, type StatusInput, type ThemeLike } from "../extension/statusline.ts";

const plain = process.argv.includes("--plain");

const COLORS: Record<string, string> = {
	dim: "\x1b[38;2;153;153;153m",
	warning: "\x1b[38;2;255;193;7m",
	error: "\x1b[38;2;255;107;128m",
};

const theme: ThemeLike = { fg: (c, t) => `${COLORS[c] ?? ""}${t}\x1b[39m` };

const opus = { id: "claude-opus-5-5", name: "Claude Opus 5.5 1M", reasoning: true };

const samples: Record<string, StatusInput> = {
	reference: { model: opus, thinkingLevel: "medium", contextPercent: 5, fiveHour: { utilization: 0.19 } },
	"before first response": { model: opus, thinkingLevel: "high", contextPercent: 0 },
	"running low": { model: opus, thinkingLevel: "xhigh", contextPercent: 84, fiveHour: { utilization: 0.93 } },
};

for (const [name, input] of Object.entries(samples)) {
	const line = renderStatus(input, theme);
	console.log(`\x1b[2m── ${name} ──\x1b[0m`);
	console.log(` ${plain ? line.replace(/\x1b\[[0-9;]*m/g, "") : line}\n`);
}
