/**
 * /statusline editor: pick the segments to show and their order.
 * Shown segments come first in their current order, hidden ones follow.
 */
import { DEFAULT_SEGMENTS, SEGMENT_LABELS, SEGMENTS, type Segment, type ThemeLike } from "./statusline.ts";

export interface EditorItem {
	segment: Segment;
	enabled: boolean;
}

export class SegmentEditor {
	items: EditorItem[];
	cursor = 0;

	constructor(segments: readonly Segment[]) {
		this.items = SegmentEditor.itemsFor(segments);
	}

	private static itemsFor(segments: readonly Segment[]): EditorItem[] {
		return [
			...segments.map((segment) => ({ segment, enabled: true })),
			...SEGMENTS.filter((s) => !segments.includes(s)).map((segment) => ({ segment, enabled: false })),
		];
	}

	up(): void {
		this.cursor = (this.cursor - 1 + this.items.length) % this.items.length;
	}

	down(): void {
		this.cursor = (this.cursor + 1) % this.items.length;
	}

	toggle(): void {
		const item = this.items[this.cursor]!;
		item.enabled = !item.enabled;
	}

	/** Moves the selected item by one; the cursor follows it. */
	move(delta: -1 | 1): void {
		const to = this.cursor + delta;
		if (to < 0 || to >= this.items.length) return;
		const [item] = this.items.splice(this.cursor, 1);
		this.items.splice(to, 0, item!);
		this.cursor = to;
	}

	reset(): void {
		const current = this.items[this.cursor]!.segment;
		this.items = SegmentEditor.itemsFor(DEFAULT_SEGMENTS);
		this.cursor = this.items.findIndex((i) => i.segment === current);
	}

	get segments(): Segment[] {
		return this.items.filter((i) => i.enabled).map((i) => i.segment);
	}

	render(theme: ThemeLike & { bold(text: string): string }, preview: (segments: Segment[]) => string): string[] {
		const nameWidth = Math.max(...SEGMENTS.map((s) => s.length));
		let order = 0;
		const rows = this.items.map((item, index) => {
			const selected = index === this.cursor;
			const pointer = selected ? theme.fg("accent", "❯") : " ";
			const box = item.enabled ? theme.fg("success", "☑") : theme.fg("dim", "☐");
			const num = item.enabled ? String(++order) : " ";
			const name = item.segment.padEnd(nameWidth);
			const label = `${num} ${name}  ${SEGMENT_LABELS[item.segment]}`;
			return ` ${pointer} ${box} ${selected ? theme.bold(label) : item.enabled ? label : theme.fg("dim", label)}`;
		});
		const line = preview(this.segments);
		return [
			theme.fg("accent", theme.bold(" Status line")),
			"",
			...rows,
			"",
			` ${theme.fg("dim", "Preview")} ${line || theme.fg("dim", "(なし)")}`,
			"",
			theme.fg("dim", " ↑↓ 選択 · space 表示切替 · shift+↑↓ / [ ] 並べ替え · r 初期値 · enter 保存 · esc キャンセル"),
		];
	}
}
