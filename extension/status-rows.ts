// Other extension statuses remain a single line; cc-subagent owns a bounded vertical list.
const sanitize = (text: string) => text.replace(/[\r\n\t]+/g, " ").trim();

export interface StatusLayout {
  width: number;
  measure(text: string): number;
  truncate(text: string, width: number): string;
}

function agentRow(text: string, layout?: StatusLayout): string {
  const [rawLeft, rawRight] = text.split("\t", 2);
  const left = sanitize(rawLeft);
  const right = rawRight ? sanitize(rawRight) : "";
  if (!right) return left;
  if (!layout) return `${left}  ${right}`;
  const width = Math.max(0, layout.width);
  const rightWidth = layout.measure(right);
  const budget = width - rightWidth - 2;
  if (budget < 10) return layout.truncate(left, width);
  const title = layout.truncate(left, budget);
  return title + " ".repeat(Math.max(2, width - layout.measure(title) - rightWidth)) + right;
}

export function extensionStatusRows(statuses: ReadonlyMap<string, string>, layout?: StatusLayout): string[] {
  const ordinary: string[] = [];
  const agents: string[] = [];
  for (const [key, text] of [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (key === "cc-subagent") {
      agents.push(...text.split(/\r?\n/).slice(0, 10).map(row => agentRow(row, layout)).filter(Boolean));
    } else {
      const value = sanitize(text);
      if (value) ordinary.push(value);
    }
  }
  return [...(ordinary.length ? [ordinary.join(" ")] : []), ...(agents.length ? [""] : []), ...agents];
}
