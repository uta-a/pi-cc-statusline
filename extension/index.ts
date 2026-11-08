/**
 * pi-cc-statusline — replaces pi's footer with a one-line status:
 *
 *   Opus 5.5 medium · Context 95% left · 5h 81% left
 *
 * - Segments: model + thinking level, context left, 5h / weekly plan usage left,
 *   cache hit rate of the session, output speed of the last response
 * - /statusline picks the segments and their order; saved to pi-cc-statusline.json
 * - Plan usage comes from the anthropic-ratelimit-unified-{5h,7d}-* response headers,
 *   which both the built-in Anthropic provider and pi-claude-bridge supply
 * - The last plan usage is cached on disk so a new session shows it right away
 * - Extension statuses (setStatus) keep showing on a second line
 * - Installs after the other session_start handlers, so it replaces their footers too
 * - Does nothing inside pi-subagents children
 */
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { loadSegments, loadUsageCache, normalizeSegments, saveSegments, saveUsageCache } from "./config.ts";
import { SegmentEditor } from "./settings.ts";
import {
	CacheStats,
	DEFAULT_SEGMENTS,
	parseWindow,
	renderStatus,
	SEGMENT_LABELS,
	SEGMENTS,
	type Segment,
	type StatusInput,
	type ThemeLike,
	tokensPerSecond,
	type UsageLike,
} from "./statusline.ts";

const isSubagentChild = () => process.env.PI_SUBAGENT_CHILD === "1" || Boolean(process.env.PI_SUBAGENT_PARENT_SESSION);

// Statuses are free text from other extensions; keep them on one line
const sanitize = (text: string) => text.replace(/[\r\n\t]+/g, " ").trim();

// Stand-ins so the /statusline preview shows segments that have no data yet
const PREVIEW_SAMPLE: StatusInput = {
	contextPercent: 5,
	fiveHour: { utilization: 0.19 },
	weekly: { utilization: 0.37 },
	cacheHit: 0.97,
	tokensPerSecond: 56,
};

interface AssistantLike {
	role: string;
	usage?: UsageLike;
	durationMs?: number;
}

export default function (pi: ExtensionAPI) {
	if (isSubagentChild()) return;

	const agentDir = getAgentDir();
	let segments = loadSegments(agentDir);
	const usage = loadUsageCache(agentDir);
	let cache = new CacheStats();
	let speed: number | undefined;
	let requestRender: (() => void) | undefined;

	// History only has durationMs, which includes the wait for the first token
	const take = (message: AssistantLike, streamMs?: number) => {
		if (message.role !== "assistant") return;
		cache.add(message.usage);
		speed = tokensPerSecond(message.usage, streamMs ?? message.durationMs) ?? speed;
	};

	// Cache totals and speed follow the current branch
	const reconstruct = (ctx: ExtensionContext) => {
		cache = new CacheStats();
		speed = undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message") take(entry.message as AssistantLike);
		}
	};

	const statusInput = (ctx: ExtensionContext): StatusInput => ({
		model: ctx.model,
		thinkingLevel: pi.getThinkingLevel(),
		contextPercent: ctx.getContextUsage()?.percent,
		fiveHour: usage.fiveHour,
		weekly: usage.weekly,
		cacheHit: cache.hitRate,
		tokensPerSecond: speed,
	});

	pi.on("after_provider_response", async (event) => {
		const fiveHour = parseWindow(event.headers, "5h");
		const weekly = parseWindow(event.headers, "7d");
		if (!fiveHour && !weekly) return;
		if (fiveHour) usage.fiveHour = fiveHour;
		if (weekly) usage.weekly = weekly;
		saveUsageCache(agentDir, usage);
		requestRender?.();
	});

	// Live responses are timed from the first streamed delta, so speed excludes time to first token
	let firstDeltaAt: number | undefined;
	pi.on("message_start", async () => {
		firstDeltaAt = undefined;
	});
	pi.on("message_update", async (event) => {
		if (firstDeltaAt === undefined && event.assistantMessageEvent.type.endsWith("_delta")) firstDeltaAt = performance.now();
	});
	pi.on("message_end", async (event) => {
		const streamMs = firstDeltaAt === undefined ? undefined : performance.now() - firstDeltaAt;
		firstDeltaAt = undefined;
		take(event.message as AssistantLike, streamMs);
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
					const line = renderStatus(statusInput(ctx), theme as ThemeLike, segments);
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
		reconstruct(ctx);
		setTimeout(() => install(ctx), 0);
	});
	pi.on("session_tree", async (_event, ctx) => {
		reconstruct(ctx);
		requestRender?.();
	});

	const apply = (next: Segment[]) => {
		segments = next;
		saveSegments(agentDir, segments);
		requestRender?.();
	};

	const describe = (list: readonly Segment[]) => (list.length > 0 ? list.join(" → ") : "(なし)");

	pi.registerCommand("statusline", {
		description: "ステータスラインに出す項目と順番を設定する（引数: 項目名を順に / reset）",
		getArgumentCompletions(prefix) {
			const words = prefix.split(/\s+/);
			const last = words.pop() ?? "";
			const head = words.length > 0 ? `${words.join(" ")} ` : "";
			const candidates = [...SEGMENTS.filter((s) => !words.includes(s)), ...(words.length === 0 ? ["reset"] : [])];
			return candidates
				.filter((c) => c.startsWith(last))
				.map((c) => ({
					value: `${head}${c}`,
					label: c,
					description: c === "reset" ? `初期値に戻す（${DEFAULT_SEGMENTS.join(" ")}）` : SEGMENT_LABELS[c as Segment],
				}));
		},
		handler: async (args, ctx) => {
			const words = args.trim().split(/\s+/).filter(Boolean);

			if (words.length === 1 && words[0] === "reset") {
				apply([...DEFAULT_SEGMENTS]);
				ctx.ui.notify(`ステータスライン: ${describe(segments)}`, "info");
				return;
			}

			if (words.length > 0) {
				const unknown = words.filter((w) => !SEGMENTS.includes(w as Segment));
				if (unknown.length > 0) {
					ctx.ui.notify(`不明な項目: ${unknown.join(", ")}（使える項目: ${SEGMENTS.join(", ")}）`, "error");
					return;
				}
				apply(normalizeSegments(words)!);
				ctx.ui.notify(`ステータスライン: ${describe(segments)}`, "info");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify(`ステータスライン: ${describe(segments)}（変更は /statusline <項目...>）`, "info");
				return;
			}

			const result = await ctx.ui.custom<Segment[] | undefined>(
				(tui, theme, keybindings, done) => {
					const editor = new SegmentEditor(segments);
					const preview = (list: Segment[]) =>
						renderStatus({ ...PREVIEW_SAMPLE, ...definedOnly(statusInput(ctx)) }, theme as ThemeLike, list);
					return {
						render: (width: number) =>
							editor.render(theme as unknown as ThemeLike & { bold(t: string): string }, preview).map((l) => truncateToWidth(l, width)),
						invalidate() {},
						handleInput(data: string) {
							if (matchesKey(data, "shift+up") || data === "[") editor.move(-1);
							else if (matchesKey(data, "shift+down") || data === "]") editor.move(1);
							else if (keybindings.matches(data, "tui.select.up")) editor.up();
							else if (keybindings.matches(data, "tui.select.down")) editor.down();
							else if (matchesKey(data, "space")) editor.toggle();
							else if (data === "r") editor.reset();
							else if (keybindings.matches(data, "tui.select.confirm")) return done(editor.segments);
							else if (keybindings.matches(data, "tui.select.cancel")) return done(undefined);
							else return;
							tui.requestRender();
						},
					};
				},
				{ blocked: { kind: "question", message: "ステータスラインの設定" } },
			);

			if (!result) return;
			apply(result);
			ctx.ui.notify(`ステータスライン: ${describe(segments)}`, "info");
		},
	});
}

function definedOnly<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}
