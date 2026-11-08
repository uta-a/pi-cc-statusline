/**
 * pi-cc-statusline — replaces pi's footer with a one-line status:
 *
 *   Opus 5.5 medium · Context 95% left · 5h 81% left
 *
 * - Model name and thinking level from the session
 * - Context left from ctx.getContextUsage()
 * - 5h plan usage from the anthropic-ratelimit-unified-5h-* response headers,
 *   which both the built-in Anthropic provider and pi-claude-bridge supply
 * - The last 5h reading is cached on disk so a new session shows it right away
 * - Extension statuses (setStatus) keep showing on a second line
 * - Installs after the other session_start handlers, so it replaces their footers too
 * - Does nothing inside pi-subagents children
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { type FiveHourUsage, parseFiveHour, renderStatus, type ThemeLike } from "./statusline.ts";

const CACHE_FILE = "pi-cc-statusline.json";

const isSubagentChild = () => process.env.PI_SUBAGENT_CHILD === "1" || Boolean(process.env.PI_SUBAGENT_PARENT_SESSION);

const cachePath = () => join(getAgentDir(), CACHE_FILE);

function loadCache(): FiveHourUsage | undefined {
	try {
		const data = JSON.parse(readFileSync(cachePath(), "utf8")) as { fiveHour?: FiveHourUsage };
		return typeof data.fiveHour?.utilization === "number" ? data.fiveHour : undefined;
	} catch {
		return undefined;
	}
}

function saveCache(fiveHour: FiveHourUsage): void {
	try {
		mkdirSync(dirname(cachePath()), { recursive: true });
		writeFileSync(cachePath(), `${JSON.stringify({ fiveHour }, null, "\t")}\n`);
	} catch {
		// The cache only saves a request's wait on startup; losing it is harmless
	}
}

// Statuses are free text from other extensions; keep them on one line
const sanitize = (text: string) => text.replace(/[\r\n\t]+/g, " ").trim();

export default function (pi: ExtensionAPI) {
	if (isSubagentChild()) return;

	let fiveHour = loadCache();
	let requestRender: (() => void) | undefined;

	pi.on("after_provider_response", async (event) => {
		const usage = parseFiveHour(event.headers);
		if (!usage) return;
		fiveHour = usage;
		saveCache(usage);
		requestRender?.();
	});

	const install = (ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			return {
				dispose() {
					requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const line = renderStatus(
						{
							model: ctx.model,
							thinkingLevel: pi.getThinkingLevel(),
							contextPercent: ctx.getContextUsage()?.percent,
							fiveHour,
						},
						theme as ThemeLike,
					);
					const lines = [truncateToWidth(` ${line}`, width, "")];

					const statuses = [...footerData.getExtensionStatuses().entries()]
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => sanitize(text))
						.filter(Boolean);
					if (statuses.length > 0) lines.push(truncateToWidth(` ${statuses.join(" ")}`, width, theme.fg("dim", "…")));

					return lines;
				},
			};
		});
	};

	// The last setFooter wins, and other packages (better-claude-code-ui) set theirs in
	// session_start too. Waiting for the next macrotask lets every handler run first.
	pi.on("session_start", async (_event, ctx) => {
		setTimeout(() => install(ctx), 0);
	});
}
