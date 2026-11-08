import assert from "node:assert/strict";
import { test } from "node:test";
import { displayModelName, fiveHourLeft, parseFiveHour, renderStatus, type ThemeLike } from "../extension/statusline.ts";

const tagged: ThemeLike = { fg: (c, t) => `<${c}>${t}</${c}>` };
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/<\/?[a-z]+>/g, "");

const opus = { id: "claude-opus-5-5", name: "Claude Opus 5.5 1M", reasoning: true };

test("draws the reference line", () => {
	const line = renderStatus({ model: opus, thinkingLevel: "medium", contextPercent: 5.2, fiveHour: { utilization: 0.19 } }, tagged);
	assert.equal(strip(line), "Opus 5.5 medium · Context 95% left · 5h 81% left");
	assert.ok(line.startsWith("<dim>Opus 5.5 medium</dim>"));
	assert.ok(line.includes("\x1b[38;2;131;190;178mContext 95% left"));
	assert.ok(line.includes("\x1b[38;2;188;153;212m5h 81% left"));
});

test("unknown parts are left out", () => {
	assert.equal(strip(renderStatus({ model: opus, thinkingLevel: "high", contextPercent: null }, tagged)), "Opus 5.5 high");
	assert.equal(strip(renderStatus({ model: { id: "gpt-x", reasoning: false }, thinkingLevel: "off", contextPercent: 0 }, tagged)), "gpt-x · Context 100% left");
});

test("low values switch to warning and error", () => {
	assert.ok(renderStatus({ contextPercent: 85 }, tagged).includes("<warning>Context 15% left</warning>"));
	assert.ok(renderStatus({ fiveHour: { utilization: 0.95 } }, tagged).includes("<error>5h 5% left</error>"));
});

test("model names", () => {
	assert.equal(displayModelName({ id: "claude-opus-5-5", name: "Claude Opus 5.5" }), "Opus 5.5");
	assert.equal(displayModelName({ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (1M)" }), "Sonnet 4.6");
	assert.equal(displayModelName({ id: "claude-fable-5-1", name: "claude-fable-5-1" }), "Fable 5.1");
	assert.equal(displayModelName({ id: "claude-opus-5" }), "Opus 5");
	assert.equal(displayModelName({ id: "claude-haiku-4-5-20251001" }), "Haiku 4.5");
	assert.equal(displayModelName({ id: "gpt-5", name: "GPT-5" }), "GPT-5");
});

test("reads the 5h headers case-insensitively", () => {
	assert.deepEqual(
		parseFiveHour({
			"Anthropic-Ratelimit-Unified-5h-Utilization": "0.42",
			"anthropic-ratelimit-unified-5h-reset": "1794200000",
			"anthropic-ratelimit-unified-7d-utilization": "0.9",
		}),
		{ utilization: 0.42, resetsAt: 1794200000 },
	);
	assert.equal(parseFiveHour({ "anthropic-ratelimit-unified-status": "allowed" }), undefined);
	assert.equal(parseFiveHour({ "anthropic-ratelimit-unified-5h-utilization": "n/a" }), undefined);
});

test("a window past its reset is full again", () => {
	const now = 1_000_000_000_000;
	assert.equal(fiveHourLeft({ utilization: 0.7, resetsAt: now / 1000 - 1 }, now), 100);
	assert.equal(fiveHourLeft({ utilization: 0.7, resetsAt: now / 1000 + 60 }, now), 30);
	assert.equal(fiveHourLeft({ utilization: 1.3 }, now), 0);
});
