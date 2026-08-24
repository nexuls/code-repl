/**
 * The keybinding reference.
 *
 * A terminal app with no menu bar has nowhere else to put this, and a key map
 * you cannot discover is a key map nobody uses. The list is the single source of
 * truth for what the app claims to support — if a binding is added to
 * `App`'s keymap it belongs here too.
 */

import { StyledText } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { chunk, fit } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface HelpOverlayProps {
	readonly width: number;
	readonly height: number;
	readonly theme: EditorTheme;
	readonly onClose: () => void;
}

/** `[key, description]`, or `[heading]` for a section break. */
type Row = readonly [string, string] | readonly [string];

const ROWS: readonly Row[] = [
	["running"],
	["ctrl+r", "run the buffer"],
	["ctrl+e", "cancel the running program"],
	["ctrl+l", "clear the output pane"],
	["buffers"],
	["ctrl+n", "new scratch buffer"],
	["ctrl+w", "close buffer"],
	["ctrl+s", "save"],
	["alt+← / →", "previous / next buffer"],
	["ctrl+p", "change language"],
	["panes"],
	["shift+tab", "cycle focus"],
	["ctrl+b", "toggle file tree"],
	["ctrl+j", "toggle output"],
	["editing"],
	["ctrl+z / ctrl+y", "undo / redo"],
	["ctrl+k", "delete line"],
	["ctrl+d", "duplicate line"],
	["tab / shift+tab", "indent / outdent"],
	["exit"],
	["ctrl+q", "quit"],
];

export function HelpOverlay({
	width,
	height,
	theme,
	onClose,
}: HelpOverlayProps) {
	useKeyboard((key) => {
		// Any key dismisses: this is a reference, not a dialog to navigate.
		if (
			key.name === "escape" ||
			key.name === "return" ||
			key.sequence === "?"
		) {
			onClose();
		} else {
			onClose();
		}
	});

	const innerWidth = Math.max(1, width - 2);
	const visible = ROWS.slice(0, Math.max(0, height - 2));

	return (
		<box
			width={width}
			height={height}
			border
			borderColor={theme.borderFocused}
			backgroundColor={theme.elevated}
			title=" keys — any key to close "
			titleAlignment="left"
			flexDirection="column"
			zIndex={10}
		>
			{visible.map((row) => (
				<text
					key={row[0]}
					content={rowChunks(row, innerWidth, theme)}
					wrapMode="none"
					selectable={false}
				/>
			))}
		</box>
	);
}

function rowChunks(row: Row, width: number, theme: EditorTheme): StyledText {
	if (row.length === 1) {
		return new StyledText([
			chunk(fit(` ${row[0]}`, width), theme.accent, theme.elevated),
		]);
	}
	const [keys, description] = row as readonly [string, string];
	const keyWidth = Math.min(18, width);
	return new StyledText([
		chunk(fit(`  ${keys}`, keyWidth), theme.text, theme.elevated),
		chunk(
			fit(description, Math.max(0, width - keyWidth)),
			theme.muted,
			theme.elevated,
		),
	]);
}
