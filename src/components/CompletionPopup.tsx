/**
 * The completion list that floats over the editor.
 *
 * Purely presentational: it renders items and reports a choice. Requesting
 * completions, deciding when to show the popup, and inserting the accepted text
 * all belong to the editor, which is the only thing that knows where the cursor
 * is.
 *
 * Positioning is the caller's job too — the popup does not know the editor's
 * geometry. It only reports how tall it wants to be, so the caller can decide
 * whether it fits below the cursor or has to go above.
 */

import { StyledText } from "@opentui/core";
import type { CompletionItem } from "../core/lsp/protocol";
import { completionSigil } from "../core/lsp/protocol";
import { chunk, fit } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface CompletionPopupProps {
	readonly items: readonly CompletionItem[];
	readonly selected: number;
	readonly width: number;
	/** Maximum rows; the popup uses fewer when there are fewer items. */
	readonly maxRows: number;
	readonly theme: EditorTheme;
	readonly onChoose: (index: number) => void;
}

/** Rows the popup will occupy for a given item count. */
export function popupHeight(itemCount: number, maxRows: number): number {
	return Math.min(itemCount, maxRows);
}

export function CompletionPopup({
	items,
	selected,
	width,
	maxRows,
	theme,
	onChoose,
}: CompletionPopupProps) {
	const rows = popupHeight(items.length, maxRows);
	// Keep the selection visible by scrolling the window, not the selection.
	const first = Math.max(
		0,
		Math.min(selected - Math.floor(rows / 2), items.length - rows),
	);
	const visible = items.slice(first, first + rows);

	return (
		<box
			width={width}
			height={rows}
			backgroundColor={theme.elevated}
			flexDirection="column"
			zIndex={30}
		>
			{visible.map((item, offset) => (
				<text
					// The list is replaced wholesale on every request and never
					// reordered in place, and overloads legitimately share a label, so
					// position is the only stable identity available here.
					// biome-ignore lint/suspicious/noArrayIndexKey: see above
					key={first + offset}
					content={itemChunks(item, first + offset === selected, width, theme)}
					wrapMode="none"
					selectable={false}
					onMouseDown={() => onChoose(first + offset)}
				/>
			))}
		</box>
	);
}

/** One row: kind sigil, label, and as much of the detail as fits. */
function itemChunks(
	item: CompletionItem,
	selected: boolean,
	width: number,
	theme: EditorTheme,
): StyledText {
	const bg = selected ? theme.treeSelected : theme.elevated;
	const fg = selected ? theme.treeSelectedText : theme.text;

	const sigil = ` ${completionSigil(item.kind)} `;
	const label = item.label;
	// The label must survive whole; the detail gives up space first, because a
	// truncated signature is still useful and a truncated name is not.
	const labelWidth = Math.min(label.length, Math.max(0, width - sigil.length));
	const detailWidth = Math.max(0, width - sigil.length - labelWidth);

	return new StyledText([
		chunk(sigil, theme.accent, bg),
		chunk(fit(label, labelWidth), fg, bg),
		chunk(
			fit(item.detail ? ` ${item.detail}` : "", detailWidth),
			theme.muted,
			bg,
		),
	]);
}
