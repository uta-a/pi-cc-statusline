import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchPlanUsage, parseCodexUsage } from "../extension/usage.ts";

const weekly = { used_percent: 7, limit_window_seconds: 604800, reset_at: 1794391760 };
const fiveHour = { used_percent: 25, limit_window_seconds: 18000, reset_at: 1794247800 };

test("Codex weekly-only primary window is not mistaken for 5h", () => {
	assert.deepEqual(parseCodexUsage({ rate_limit: { primary_window: weekly, secondary_window: null } }), {
		weekly: { utilization: 0.07, resetsAt: 1794391760 },
	});
});

test("Codex windows are classified by duration in either order", () => {
	for (const [primary_window, secondary_window] of [[fiveHour, weekly], [weekly, fiveHour]]) {
		assert.deepEqual(parseCodexUsage({ rate_limit: { primary_window, secondary_window } }), {
			fiveHour: { utilization: 0.25, resetsAt: 1794247800 },
			weekly: { utilization: 0.07, resetsAt: 1794391760 },
		});
	}
});

test("Codex ignores missing, malformed and unknown windows", () => {
	for (const body of [null, {}, { rate_limit: null }, { rate_limit: { primary_window: {} } },
		{ rate_limit: { primary_window: { ...weekly, used_percent: NaN } } },
		{ rate_limit: { primary_window: { ...weekly, limit_window_seconds: 60 } } }]) {
		assert.equal(parseCodexUsage(body), undefined);
	}
	assert.deepEqual(parseCodexUsage({ rate_limit: { primary_window: { ...weekly, used_percent: 0, reset_at: null } } }), {
		weekly: { utilization: 0 },
	});
});

test("Codex endpoint uses OAuth token and account claim without redirects", async () => {
	const original = globalThis.fetch;
	const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" } })).toString("base64url");
	const token = `header.${payload}.signature`;
	try {
		globalThis.fetch = async (url, options) => {
			assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
			assert.deepEqual(options?.headers, { Authorization: `Bearer ${token}`, "ChatGPT-Account-Id": "test-account" });
			assert.equal(options?.redirect, "error");
			return Response.json({ rate_limit: { primary_window: weekly } });
		};
		assert.deepEqual(await fetchPlanUsage("openai-codex", token), {
			weekly: { utilization: 0.07, resetsAt: 1794391760 },
		});
		globalThis.fetch = async () => new Response(null, { status: 401 });
		assert.equal(await fetchPlanUsage("openai-codex", token), undefined);
	} finally {
		globalThis.fetch = original;
	}
});
