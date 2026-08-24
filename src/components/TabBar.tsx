/**
 * The horizontal strip of open buffers.
 *
 * Presentational: it is handed tabs and reports clicks. It does not know how a
 * tab opens or closes.
 *
 * Rendered as a single `<text>` of styled chunks rather than one box per tab.
 * Cell arithmetic is done here anyway to place the click targets, and a row of
 * nested boxes would make the layout engine re-measure the strip on every
 * keystroke that marks a buffer dirty.
 */

import { StyledText } from "@opentui/core";
import { useMemo } from "react";
import type { Tab } from "../app/state/tabs";
import { isDirty } from "../app/state/tabs";
import { chunk, fit } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface TabBarProps {
	readonly tabs: readonly Tab[];
	readonly active: number;
	readonly width: number;
	readonly theme: EditorTheme;
	readonly onSelect: (index: number) => void;
	readonly onClose: (id: string) => void;
}

/** Longest a tab's label may get before its name is elided. */
const MAX_LABEL = 22;

/** Where each tab sits on the strip, so a click can be resolved to a tab. */
interface Slot {
	readonly index: number;
	readonly start: number;
	readonly end: number;
	/** Column of the close affordance, or -1 when the tab is too narrow for one. */
	readonly closeAt: number;
}

export function TabBar({
	tabs,
	active,
	width,
	theme,
	onSelect,
	onClose,
}: TabBarProps) {
	const { content, slots } = useMemo(
		() => layout(tabs, active, width, theme),
		[tabs, active, width, theme],
	);

	return (
		<text
			content={content}
			wrapMode="none"
			selectable={false}
			onMouseDown={(event) => {
				const column = event.x - (event.currentTarget?.x ?? 0);
				const slot = slots.find((s) => column >= s.start && column < s.end);
				if (!slot) return;
				// The close affordance is inside the tab, so it must be tested first
				// or clicking the × would merely select the tab.
				if (slot.closeAt >= 0 && column === slot.closeAt) {
					onClose(tabs[slot.index]!.id);
					return;
				}
				onSelect(slot.index);
			}}
		/>
	);
}

/** Build the strip's chunks and the click map in one pass. */
function layout(
	tabs: readonly Tab[],
	active: number,
	width: number,
	theme: EditorTheme,
): { content: StyledText; slots: Slot[] } {
	if (tabs.length === 0) {
		return {
			content: new StyledText([
				chunk(
					fit("  no buffers — ctrl+n for a new one", width),
					theme.muted,
					theme.surface,
				),
			]),
			slots: [],
		};
	}

	const chunks = [];
	const slots: Slot[] = [];
	let column = 0;

	for (const [index, tab] of tabs.entries()) {
		if (column >= width) break;
		const isActive = index === active;
		const dirty = isDirty(tab);

		// " name • × " — the dot marks unsaved work, the × closes.
		const name =
			tab.title.length > MAX_LABEL
				? `${tab.title.slice(0, MAX_LABEL - 1)}…`
				: tab.title;
		const label = ` ${name} ${dirty ? "•" : " "} `;
		const closeLabel = "× ";
		const full = label + closeLabel;

		// A tab that would overflow is clipped rather than dropped: seeing part of
		// the next tab is the cue that the strip continues.
		const available = width - column;
		const text = full.length <= available ? full : full.slice(0, available);

		const fg = isActive ? theme.tabActiveText : theme.tabInactiveText;
		const bg = isActive ? theme.tabActive : theme.tabInactive;

		// The dirty dot is its own chunk so it can carry the warning colour.
		const dotIndex = label.length - 2;
		if (dirty && text.length > dotIndex) {
			chunks.push(chunk(text.slice(0, dotIndex), fg, bg));
			chunks.push(chunk("•", theme.tabDirty, bg));
			chunks.push(chunk(text.slice(dotIndex + 1), fg, bg));
		} else {
			chunks.push(chunk(text, fg, bg));
		}

		const closeColumn = column + label.length;
		slots.push({
			index,
			start: column,
			end: column + text.length,
			closeAt: closeColumn < column + text.length ? closeColumn : -1,
		});
		column += text.length;
	}

	if (column < width) {
		chunks.push(chunk(" ".repeat(width - column), theme.muted, theme.surface));
	}

	return { content: new StyledText(chunks), slots };
}
