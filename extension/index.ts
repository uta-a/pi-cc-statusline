/**
 * pi-cc-statusline — replaces pi's footer with a one-line status:
 *
 *   Opus 5.5 medium · Context 95% left · 5h 81% left
 *
 * - Segments: model + thinking level, context left, 5h / weekly plan usage left,
 *   cache hit rate of the session, output speed over the recent responses
 * - /statusline picks the segments and their order; saved to pi-cc-statusline.json
 * - Plan usage comes from the anthropic-ratelimit-unified-{5h,7d}-* response headers,
 *   which both the built-in Anthropic provider and pi-claude-bridge supply
 * - Providers without those headers (opencode-go) answer their own usage endpoint
 * - Plan usage is kept per provider, and the line shows only the main model's
 *   provider, so another provider's windows never take over the line
 * - Headers carry no provider, so a response's plan usage is stored once its
 *   message names the provider that answered
 * - The last plan usage is cached on disk so a new session shows it right away
 * - Extension statuses (setStatus) keep showing on a second line
 * - Installs after the other session_start handlers, so it replaces their footers too
 * - Does nothing inside pi-subagents children
 */
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	loadSegments,
	loadUsageCache,
	normalizeSegments,
	saveSegments,
	saveUsageCache,
} from "./config.ts";
import { SegmentEditor } from "./settings.ts";import {
	CacheStats,
	DEFAULT_SEGMENTS,
	parseWindow,
	renderStatus,
	SEGMENT_LABELS,
	SEGMENTS,
	type Segment,
	type StatusInput,
	type ThemeLike,
	SpeedMeter,
	type UsageLike,
	type WindowUsage,
} from "./statusline.ts";
import { fetchPlanUsage, USAGE_ENDPOINTS } from "./usage.ts";

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
	provider?: string;
	usage?: UsageLike;
	durationMs?: number;
}

/** How long plan usage waits for the message that names the provider that reported it. */
const PENDING_TTL_MS = 60_000;

export default function (pi: ExtensionAPI) {
	if (isSubagentChild()) return;

	const agentDir = getAgentDir();
	let segments = loadSegments(agentDir);
	const usage = loadUsageCache(agentDir);
	let cache = new CacheStats();
	let speed = new SpeedMeter();
	let requestRender: (() => void) | undefined;

	const take = (message: AssistantLike) => {
		if (message.role !== "assistant") return;
		cache.add(message.usage);
		speed.add(message.usage, message.durationMs);
	};

	// Cache totals and speed follow the current branch
	const reconstruct = (ctx: ExtensionContext) => {
		cache = new CacheStats();
		speed = new SpeedMeter();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message") take(entry.message as AssistantLike);
		}
	};

	// The main model picks the provider whose plan usage the line shows. A virtual
	// model routes every request to a physical one, and its responses name the real provider.
	const mainProvider = (ctx: ExtensionContext): string | undefined => {
		const model = ctx.model;
		if (!model?.provider) return undefined;
		if (model.api !== "pi-virtual") return model.provider;
		for (const entry of ctx.sessionManager.getBranch().toReversed()) {
			const message = entry.type === "message" ? (entry.message as AssistantLike) : undefined;
			if (message?.role === "assistant" && message.provider) return message.provider;
		}
		return model.provider;
	};

	const statusInput = (ctx: ExtensionContext): StatusInput => {
		const provider = mainProvider(ctx);
		const plan = provider ? usage.providers[provider] : undefined;
		return {
			model: ctx.model,
			thinkingLevel: pi.getThinkingLevel(),
			contextPercent: ctx.getContextUsage()?.percent,
			fiveHour: plan?.fiveHour,
			weekly: plan?.weekly,
			cacheHit: cache.hitRate,
			tokensPerSecond: speed.tokensPerSecond,
		};
	};

	// Providers that publish plan usage on an endpoint (opencode-go) report nothing in
	// their headers, so ask their endpoint on session start, model switch and after a turn.
	const FETCH_INTERVAL_MS = 30_000;
	let fetching = false;
	let fetchedAt = 0;

	const refreshPlanUsage = async (ctx: ExtensionContext) => {
		const provider = mainProvider(ctx);
		if (!provider || !USAGE_ENDPOINTS[provider] || fetching || Date.now() - fetchedAt < FETCH_INTERVAL_MS) return;
		fetching = true;
		fetchedAt = Date.now();
		try {
			const apiKey = await ctx.modelRegistry.getApiKeyForProvider(provider);
			const plan = apiKey ? await fetchPlanUsage(provider, apiKey) : undefined;
			if (!plan) return;
			const entry = (usage.providers[provider] ??= {});
			if (plan.fiveHour) entry.fiveHour = plan.fiveHour;
			if (plan.weekly) entry.weekly = plan.weekly;
			saveUsageCache(agentDir, usage);
			requestRender?.();
		} catch {
			// An unreachable endpoint leaves the last known values in place
		} finally {
			fetching = false;
		}
	};

	// Response headers do not say which provider sent them, so hold them until the
	// message that follows names its provider. A model switch mid-response must not
	// file one provider's windows under another.
	let pending: { fiveHour?: WindowUsage; weekly?: WindowUsage; at: number } | undefined;

	const commitPlan = (message: AssistantLike | undefined) => {
		if (!pending || message?.role !== "assistant" || !message.provider) return;
		if (Date.now() - pending.at > PENDING_TTL_MS) {
			pending = undefined;
			return;
		}
		const { fiveHour, weekly } = pending;
		pending = undefined;
		const entry = (usage.providers[message.provider] ??= {});
		if (fiveHour) entry.fiveHour = fiveHour;
		if (weekly) entry.weekly = weekly;
		saveUsageCache(agentDir, usage);
		requestRender?.();
	};

	pi.on("after_provider_response", async (event) => {
		const fiveHour = parseWindow(event.headers, "5h");
		const weekly = parseWindow(event.headers, "7d");
		if (!fiveHour && !weekly) return;
		pending = { fiveHour, weekly, at: Date.now() };
	});

	pi.on("message_start", async (event) => commitPlan(event.message as AssistantLike));

	pi.on("message_end", async (event, ctx) => {
		take(event.message as AssistantLike);
		// claude-bridge can report held rate limits mid-stream, after message_start
		commitPlan(event.message as AssistantLike);
		requestRender?.();
		void refreshPlanUsage(ctx);
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
		void refreshPlanUsage(ctx);
		setTimeout(() => install(ctx), 0);
	});
	pi.on("session_tree", async (_event, ctx) => {
		reconstruct(ctx);
		requestRender?.();
	});
	// Switching models switches the provider the plan usage comes from
	pi.on("model_select", async (_event, ctx) => {
		fetchedAt = 0;
		requestRender?.();
		void refreshPlanUsage(ctx);
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
