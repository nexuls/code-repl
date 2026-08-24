/**
 * Filename prompt for saving a buffer that has no path yet.
 *
 * `ctrl+s` is advertised in the status bar and the help overlay, but most
 * buffers in a REPL are scratch buffers with nowhere to go. An advertised key
 * that silently does nothing is a defect, so this asks where to put it.
 *
 * Deliberately a plain line editor rather than a file browser: the tree is right
 * there for picking a directory, and what is missing at this moment is a name.
 */

import { StyledText } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { chunk, fit, fitEnd } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface SavePromptProps {
	/** Directory the name will be resolved against. */
	readonly directory: string;
	/** Name to start with, normally the buffer's current title. */
	readonly initialName: string;
	readonly width: number;
	readonly theme: EditorTheme;
	/** Called with the name; the caller joins it to `directory`. */
	readonly onSubmit: (name: string) => void;
	readonly onCancel: () => void;
}

export function SavePrompt({
	directory,
	initialName,
	width,
	theme,
	onSubmit,
	onCancel,
}: SavePromptProps) {
	const [name, setName] = useState(initialName);

	useKeyboard((key) => {
		if (key.name === "escape") {
			onCancel();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const trimmed = name.trim();
			// An empty name would resolve to the directory itself.
			if (trimmed.length > 0) onSubmit(trimmed);
			return;
		}
		if (key.name === "backspace") {
			setName((prev) => prev.slice(0, -1));
			return;
		}
		const seq = key.sequence ?? "";
		if (!key.ctrl && !key.meta && seq.length === 1 && seq >= " ") {
			setName((prev) => prev + seq);
		}
	});

	const innerWidth = Math.max(1, width - 2);
	return (
		<box
			width={width}
			height={5}
			border
			borderColor={theme.borderFocused}
			backgroundColor={theme.elevated}
			title=" save as — enter to confirm, esc to cancel "
			titleAlignment="left"
			flexDirection="column"
			zIndex={20}
		>
			<text
				content={
					new StyledText([
						// The directory is truncated from the left: its tail is the
						// identifying part.
						chunk(
							fit(
								` in ${fitEnd(directory, Math.max(0, innerWidth - 4))}`,
								innerWidth,
							),
							theme.muted,
							theme.elevated,
						),
					])
				}
				wrapMode="none"
				selectable={false}
			/>
			<text
				content={
					new StyledText([
						chunk(" › ", theme.accent, theme.elevated),
						chunk(
							fit(name, Math.max(0, innerWidth - 4)),
							theme.text,
							theme.elevated,
						),
						// A block marks the insertion point; the real cursor is elsewhere.
						chunk(" ", theme.inverse, theme.cursor),
					])
				}
				wrapMode="none"
				selectable={false}
			/>
		</box>
	);
}
