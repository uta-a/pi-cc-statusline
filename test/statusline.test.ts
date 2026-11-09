import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	loadSegments,
	loadUsageCache,
	normalizeSegments,
	saveSegments,
	saveUsageCache,
} from "../extension/config.ts";
import { SegmentEditor } from "../extension/settings.ts";
import { parseOpenCodeGoUsage } from "../extension/usage.ts";
import {
	CacheStats,
	displayModelName,
	parseWindow,
	renderStatus,
	SEGMENTS,
	type ThemeLike,
	SpeedMeter,
	windowLeft,
} from "../extension/statusline.ts";

const tagged: ThemeLike = { fg: (c, t) => `<${c}>${t}</${c}>` };
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/<\/?[a-z]+>/g, "");

const opus = { id: "claude-opus-5-5", name: "Claude Opus 5.5 1M", reasoning: true };
const full = {
	model: opus,
	thinkingLevel: "medium",
	contextPercent: 5.2,
	fiveHour: { utilization: 0.19 },
	weekly: { utilization: 0.37 },
	cacheHit: 0.966,
	tokensPerSecond: 56.4,
};

test("draws the reference line by default", () => {
	const line = renderStatus(full, tagged);
	assert.equal(strip(line), "Opus 5.5 medium · Context 95% left · 5h 81% left");
	assert.ok(line.startsWith("\x1b[38;2;181;181;181mOpus 5.5 medium"));
	assert.ok(line.includes("\x1b[38;2;131;190;178mContext 95% left"));
	assert.ok(line.includes("\x1b[38;2;188;153;212m5h 81% left"));
});

test("segments follow the given order", () => {
	assert.equal(
		strip(renderStatus(full, tagged, [...SEGMENTS])),
		"Opus 5.5 medium · Context 95% left · 5h 81% left · Weekly 63% left · Cache 97% hit · 56 tok/s",
	);
	assert.equal(strip(renderStatus(full, tagged, ["speed", "weekly", "model"])), "56 tok/s · Weekly 63% left · Opus 5.5 medium");
	assert.equal(renderStatus(full, tagged, []), "");
});

test("unknown parts are left out", () => {
	assert.equal(strip(renderStatus({ model: opus, thinkingLevel: "high", contextPercent: null }, tagged, [...SEGMENTS])), "Opus 5.5 high");
	assert.equal(strip(renderStatus({ model: { id: "gpt-x", reasoning: false }, thinkingLevel: "off", contextPercent: 0 }, tagged)), "gpt-x · Context 100% left");
});

test("low values switch to warning and error", () => {
	assert.ok(renderStatus({ contextPercent: 85 }, tagged).includes("<warning>Context 15% left</warning>"));
	assert.ok(renderStatus({ fiveHour: { utilization: 0.95 } }, tagged).includes("<error>5h 5% left</error>"));
	assert.ok(renderStatus({ weekly: { utilization: 0.85 } }, tagged, ["weekly"]).includes("<warning>Weekly 15% left</warning>"));
});

test("branch is blue, marks dirty worktrees and follows segment order", () => {
	const input = { ...full, branch: "main", gitDirty: true };
	const line = renderStatus(input, tagged);
	assert.equal(strip(line), "Opus 5.5 medium · main* · Context 95% left · 5h 81% left");
	assert.ok(line.includes("\x1b[38;2;122;162;214mmain*"));
	assert.equal(strip(renderStatus({ branch: "feature/test", gitDirty: false }, tagged, ["branch"])), "feature/test");
	assert.equal(renderStatus({ gitDirty: true }, tagged, ["branch"]), "");
	assert.equal(strip(renderStatus(input, tagged, ["branch", "model"])), "main* · Opus 5.5 medium");
});

test("model names", () => {
	assert.equal(displayModelName({ id: "claude-opus-5-5", name: "Claude Opus 5.5" }), "Opus 5.5");
	assert.equal(displayModelName({ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (1M)" }), "Sonnet 4.6");
	assert.equal(displayModelName({ id: "claude-fable-5-1", name: "claude-fable-5-1" }), "Fable 5.1");
	assert.equal(displayModelName({ id: "claude-opus-5" }), "Opus 5");
	assert.equal(displayModelName({ id: "claude-haiku-4-5-20251001" }), "Haiku 4.5");
	assert.equal(displayModelName({ id: "gpt-5", name: "GPT-5" }), "GPT-5");
});

test("reads the 5h and 7d headers case-insensitively", () => {
	const headers = {
		"Anthropic-Ratelimit-Unified-5h-Utilization": "0.42",
		"anthropic-ratelimit-unified-5h-reset": "1794200000",
		"anthropic-ratelimit-unified-7d-utilization": "0.9",
	};
	assert.deepEqual(parseWindow(headers, "5h"), { utilization: 0.42, resetsAt: 1794200000 });
	assert.deepEqual(parseWindow(headers, "7d"), { utilization: 0.9 });
	assert.equal(parseWindow({ "anthropic-ratelimit-unified-status": "allowed" }, "5h"), undefined);
	assert.equal(parseWindow({ "anthropic-ratelimit-unified-5h-utilization": "n/a" }, "5h"), undefined);
});

test("a window past its reset is full again", () => {
	const now = 1_000_000_000_000;
	assert.equal(windowLeft({ utilization: 0.7, resetsAt: now / 1000 - 1 }, now), 100);
	assert.equal(windowLeft({ utilization: 0.7, resetsAt: now / 1000 + 60 }, now), 30);
	assert.equal(windowLeft({ utilization: 1.3 }, now), 0);
});

test("cache hit rate and speed", () => {
	const stats = new CacheStats();
	assert.equal(stats.hitRate, undefined);
	stats.add({ input: 2, cacheRead: 0, cacheWrite: 998 });
	stats.add({ input: 0, cacheRead: 9000, cacheWrite: 0 });
	stats.add(undefined);
	assert.equal(stats.hitRate, 0.9);

	const speed = new SpeedMeter(3);
	const rate = () => speed.tokensPerSecond?.toFixed(1);
	assert.equal(rate(), undefined);
	speed.add({ output: 279 }, 4949);
	assert.equal(rate(), "56.4");
	speed.add({ output: 279 }, undefined);
	speed.add({ output: 0 }, 1000);
	assert.equal(rate(), "56.4");
	// A one-word reply barely moves the total
	speed.add({ output: 4 }, 2000);
	assert.equal(rate(), "40.7");
	// Only the last three responses count
	speed.add({ output: 1000 }, 10000);
	speed.add({ output: 1000 }, 10000);
	assert.equal(rate(), "91.1");
});

test("config files", () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-statusline-"));
	assert.deepEqual(loadSegments(dir), ["model", "branch", "context", "5h"]);
	saveSegments(dir, ["cache", "model"]);
	assert.deepEqual(loadSegments(dir), ["cache", "model"]);
	writeFileSync(join(dir, "pi-cc-statusline-settings.json"), "{ broken");
	assert.deepEqual(loadSegments(dir), ["model", "branch", "context", "5h"]);
	assert.deepEqual(normalizeSegments(["5h", "bogus", "5h", "model"]), ["5h", "model"]);

	assert.deepEqual(loadUsageCache(dir), { providers: {} });
	saveUsageCache(dir, {
		providers: {
			"claude-bridge": { fiveHour: { utilization: 0.2, resetsAt: 1 }, weekly: { utilization: 0.5 } },
			anthropic: { fiveHour: { utilization: 0.6 } },
		},
	});
	assert.deepEqual(loadUsageCache(dir), {
		providers: {
			"claude-bridge": { fiveHour: { utilization: 0.2, resetsAt: 1 }, weekly: { utilization: 0.5 } },
			anthropic: { fiveHour: { utilization: 0.6 } },
		},
	});
});

test("plan usage is kept per provider", () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-statusline-"));
	// Entries without any window, and broken windows, are dropped
	writeFileSync(
		join(dir, "pi-cc-statusline-cache.json"),
		JSON.stringify({
			version: 2,
			providers: {
				empty: {},
				broken: { fiveHour: { utilization: "n/a" }, weekly: { utilization: 0.4 } },
				good: { fiveHour: { utilization: 0.3 } },
			},
		}),
	);
	assert.deepEqual(loadUsageCache(dir), {
		providers: { broken: { weekly: { utilization: 0.4 } }, good: { fiveHour: { utilization: 0.3 } } },
	});
});

test("a cache without the current shape is dropped, not guessed", () => {
	const dir = mkdtempSync(join(tmpdir(), "cc-statusline-"));
	const path = join(dir, "pi-cc-statusline-cache.json");
	// v0.2.x: one pair with no provider, so it cannot be attributed
	writeFileSync(path, JSON.stringify({ fiveHour: { utilization: 0.2 }, weekly: { utilization: 0.5 } }));
	assert.deepEqual(loadUsageCache(dir), { providers: {} });
	// Entries without the version are as unattributable as the flat pair
	writeFileSync(path, JSON.stringify({ providers: { "claude-bridge": { fiveHour: { utilization: 0.2 } } } }));
	assert.deepEqual(loadUsageCache(dir), { providers: {} });
	// Saving rewrites the file in the current shape
	saveUsageCache(dir, { providers: { "claude-bridge": { fiveHour: { utilization: 0.2 } } } });
	assert.deepEqual(loadUsageCache(dir), { providers: { "claude-bridge": { fiveHour: { utilization: 0.2 } } } });
});

test("editor toggles and reorders", () => {
	const editor = new SegmentEditor(["model", "context", "5h"]);
	assert.deepEqual(
		editor.items.map((i) => `${i.enabled ? "+" : "-"}${i.segment}`),
		["+model", "+context", "+5h", "-weekly", "-cache", "-speed", "-branch"],
	);
	editor.cursor = 4; // cache
	editor.toggle();
	editor.move(-1);
	editor.move(-1);
	assert.deepEqual(editor.segments, ["model", "context", "cache", "5h"]);
	editor.move(-1);
	assert.deepEqual(editor.segments, ["model", "cache", "context", "5h"]);
	editor.cursor = 0;
	editor.toggle();
	editor.move(-1); // already at the top
	assert.deepEqual(editor.segments, ["cache", "context", "5h"]);
	editor.up();
	assert.equal(editor.cursor, 6);
	editor.reset();
	assert.deepEqual(editor.segments, ["model", "branch", "context", "5h"]);
});

test("editor numbers the shown segments", () => {
	const theme = { ...tagged, bold: (t: string) => t };
	const lines = new SegmentEditor(["5h", "model"]).render(theme, (list) => list.join(",")).map(strip);
	assert.ok(lines.includes(" ❯ ☑ 1 5h       5 時間枠の残量"));
	assert.ok(lines.includes("   ☑ 2 model    モデルと思考レベル"));
	assert.ok(lines.includes("   ☐   context  コンテキスト残量"));
	assert.ok(lines.includes(" Preview 5h,model"));
});

test("opencode-go usage endpoint windows become plan usage", () => {
	const body = {
		usage: {
			rolling: { status: "ok", percent: 1, resetsAt: "2026-11-09T22:17:19.000Z" },
			weekly: { status: "ok", percent: 0, resetsAt: "2026-11-16T00:00:00.000Z" },
			monthly: { status: "ok", percent: 5, resetsAt: "2026-11-27T06:48:36.000Z" },
		},
	};
	assert.deepEqual(parseOpenCodeGoUsage(body), {
		fiveHour: { utilization: 0.01, resetsAt: 1794262639 },
		weekly: { utilization: 0, resetsAt: 1794787200 },
	});
	// A window without a reset time still counts
	assert.deepEqual(parseOpenCodeGoUsage({ usage: { rolling: { percent: 100 } } }), {
		fiveHour: { utilization: 1 },
	});
	// Unknown shapes and non-numbers are ignored
	assert.equal(parseOpenCodeGoUsage({}), undefined);
	assert.equal(parseOpenCodeGoUsage({ usage: { rolling: { percent: "n/a" } } }), undefined);
	assert.equal(parseOpenCodeGoUsage({ usage: { monthly: { percent: 5 } } }), undefined);
});
