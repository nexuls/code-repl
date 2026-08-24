/**
 * The language picker overlay.
 *
 * Lists every language in the registry with its detected toolchain and version.
 * Languages with nothing installed are shown greyed out rather than hidden —
 * that is the point (AGENTS.md rule 1, artifacts/DECISIONS.md D5): the user
 * learns that code-repl supports Rust and that this machine lacks `rustc`,
 * which is actionable. Hiding it would look identical to not supporting it.
 *
 * Unavailable entries are also unselectable, so the list cannot leave you on a
 * language that cannot run.
 */

import { StyledText } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { DetectedLanguage } from "../core/languages/detect";
import { isAvailable } from "../core/languages/detect";
import { chunk, fit } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface LanguagePickerProps {
	readonly languages: readonly DetectedLanguage[];
	readonly width: number;
	readonly height: number;
	readonly theme: EditorTheme;
	readonly onChoose: (detected: DetectedLanguage) => void;
	readonly onCancel: () => void;
}

export function LanguagePicker({
	languages,
	width,
	height,
	theme,
	onChoose,
	onCancel,
}: LanguagePickerProps) {
	const [query, setQuery] = useState("");
	const [index, setIndex] = useState(0);

	const matches = useMemo(() => {
		const needle = query.toLowerCase();
		if (!needle) return languages;
		return languages.filter(
			(d) =>
				d.language.name.toLowerCase().includes(needle) ||
				d.language.id.includes(needle) ||
				d.language.extensions.some((ext) => ext.includes(needle)),
		);
	}, [languages, query]);

	// Typing narrows the list, which can strand the cursor past its end.
	useEffect(() => {
		setIndex((prev) => Math.min(prev, Math.max(0, matches.length - 1)));
	}, [matches.length]);

	const viewRows = Math.max(1, height - 4); // border, query row, border
	const innerWidth = Math.max(1, width - 2);
	const first = Math.max(
		0,
		Math.min(index - Math.floor(viewRows / 2), matches.length - viewRows),
	);
	const visible = matches.slice(
		Math.max(0, first),
		Math.max(0, first) + viewRows,
	);

	/** Step to the next selectable row, skipping languages that cannot run. */
	function move(delta: number) {
		setIndex((prev) => {
			let next = prev;
			for (let i = 0; i < matches.length; i++) {
				next = next + delta;
				if (next < 0 || next >= matches.length) return prev;
				if (isAvailable(matches[next]!)) return next;
			}
			return prev;
		});
	}

	useKeyboard((key) => {
		if (key.name === "escape") {
			onCancel();
			return;
		}
		if (key.name === "up") {
			move(-1);
			return;
		}
		if (key.name === "down") {
			move(1);
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const chosen = matches[index];
			if (chosen && isAvailable(chosen)) onChoose(chosen);
			return;
		}
		if (key.name === "backspace") {
			setQuery((prev) => prev.slice(0, -1));
			return;
		}
		const seq = key.sequence ?? "";
		if (!key.ctrl && !key.meta && seq.length === 1 && seq >= " ") {
			setQuery((prev) => prev + seq);
			setIndex(0);
		}
	});

	return (
		<box
			width={width}
			height={height}
			border
			borderColor={theme.borderFocused}
			backgroundColor={theme.elevated}
			title=" language — type to filter, enter to choose, esc to cancel "
			titleAlignment="left"
			flexDirection="column"
			zIndex={10}
		>
			<text
				content={
					new StyledText([
						chunk(" › ", theme.accent, theme.elevated),
						chunk(
							fit(query || "all languages", innerWidth - 3),
							query ? theme.text : theme.muted,
							theme.elevated,
						),
					])
				}
				wrapMode="none"
				selectable={false}
			/>
			{visible.map((detected, offset) => (
				<text
					key={detected.language.id}
					content={entryChunks(
						detected,
						Math.max(0, first) + offset === index,
						innerWidth,
						theme,
					)}
					wrapMode="none"
					selectable={false}
					onMouseDown={() => {
						if (isAvailable(detected)) onChoose(detected);
					}}
				/>
			))}
		</box>
	);
}

/** One row: name, extension, and either the toolchain version or a hint. */
function entryChunks(
	detected: DetectedLanguage,
	selected: boolean,
	width: number,
	theme: EditorTheme,
): StyledText {
	const available = isAvailable(detected);
	const bg = selected ? theme.treeSelected : theme.elevated;
	const fg = !available
		? theme.disabled
		: selected
			? theme.treeSelectedText
			: theme.text;

	const left = ` ${available ? "●" : "○"} ${detected.language.name}`;
	const right = available
		? `${detected.toolchain?.id ?? ""}  ${detected.version ?? ""}`
		: "not installed";

	// The version is the first thing to give up space; the name must stay whole.
	const rightWidth = Math.max(
		0,
		Math.min(right.length + 2, width - left.length - 2),
	);
	const gap = Math.max(1, width - left.length - rightWidth);

	return new StyledText([
		chunk(
			fit(left, left.length),
			available ? theme.success : theme.disabled,
			bg,
		),
		chunk(" ".repeat(gap), fg, bg),
		chunk(fit(right, rightWidth), available ? theme.muted : theme.disabled, bg),
	]);
}
