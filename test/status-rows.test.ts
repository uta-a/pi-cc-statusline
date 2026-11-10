import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionStatusRows } from "../extension/status-rows.ts";

test("agent labels occupy individual rows underneath other statuses", () => {
  assert.deepEqual(extensionStatusRows(new Map([
    ["cc-subagent", "● explore\n● worker\n● explore-2"],
    ["other", "one\ntwo"],
  ])), ["one two", "", "● explore", "● worker", "● explore-2"]);
});
test("main agent list is separated from the statusline even without other statuses", () => {
  assert.deepEqual(extensionStatusRows(new Map([["cc-subagent", "● main\n○ Explore\n○ worker"]])), ["", "● main", "○ Explore", "○ worker"]);
});
test("agent stats align at the actual render width and descriptions truncate first", () => {
  const layout = { width: 60, measure: (text: string) => text.length, truncate: (text: string, width: number) => text.slice(0, width) };
  const rows = extensionStatusRows(new Map([["cc-subagent", "● main\n○ Explore  inspect repos\t6s · ↓ 26.4k tokens"]]), layout);
  assert.equal(rows[2].length, 60);
  assert.ok(rows[2].startsWith("○ Explore  inspect repos"));
  assert.ok(rows[2].endsWith("6s · ↓ 26.4k tokens"));
  const narrow = extensionStatusRows(new Map([["cc-subagent", "○ Explore  inspect repos\t6s · ↓ 26.4k tokens"]]), { ...layout, width: 15 });
  assert.equal(narrow[1], "○ Explore  insp");
});
test("ordinary statuses keep their original sorted single-line layout", () => {
  assert.deepEqual(extensionStatusRows(new Map([["z", " last\tvalue "], ["a", "first"], ["empty", "\n"]])), ["first last value"]);
  assert.deepEqual(extensionStatusRows(new Map()), []);
});
test("agent rows are bounded and tolerate CRLF and blank rows", () => {
  assert.deepEqual(extensionStatusRows(new Map([["cc-subagent", "● explore\r\n\n● worker"]])), ["", "● explore", "● worker"]);
  assert.equal(extensionStatusRows(new Map([["cc-subagent", Array(20).fill("● worker").join("\n")]])).length, 11);
});
