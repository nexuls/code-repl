/**
 * Shared helpers for building styled terminal text.
 *
 * Every component needs the same two things: make a `TextChunk` with theme
 * colours, and fit a string into a fixed number of cells. Duplicating either one
 * is how column arithmetic drifts between panes.
 */

import { parseColor, type TextChunk } from "@opentui/core";

/** A styled run of text. `attributes` is OpenTUI's bold/italic/underline mask. */
export function chunk(
	text: string,
	fg: string,
	bg?: string,
	attributes = 0,
): TextChunk {
	return {
		__isChunk: true,
		text,
		fg: parseColor(fg),
		bg: bg ? parseColor(bg) : undefined,
		attributes,
	};
}

/**
 * Fit `text` to exactly `width` cells, padding with spaces or truncating with an
 * ellipsis. Returns `""` for a non-positive width so callers never have to guard
 * a collapsed pane.
 */
export function fit(text: string, width: number): string {
	if (width <= 0) return "";
	if (text.length === width) return text;
	if (text.length < width) return text.padEnd(width, " ");
	// One cell of ellipsis is worth more than one cell of content: it tells the
	// reader something was cut.
	return width <= 1 ? text.slice(0, width) : `${text.slice(0, width - 1)}…`;
}

/**
 * Truncate to `width` cells without padding, keeping the **end** of the string.
 * Paths are far more identifiable by their tail than their head.
 */
export function fitEnd(text: string, width: number): string {
	if (width <= 0) return "";
	if (text.length <= width) return text;
	return width <= 1 ? text.slice(-width) : `…${text.slice(-(width - 1))}`;
}

/**
 * Split text into display lines, hard-wrapping at `width`.
 *
 * Used by the output pane, where the content is process output: it can contain
 * very long lines with no spaces, so wrapping is by cell, not by word.
 */
export function hardWrap(text: string, width: number): string[] {
	if (width <= 0) return [];
	const out: string[] = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) {
			out.push("");
			continue;
		}
		for (let i = 0; i < line.length; i += width) {
			out.push(line.slice(i, i + width));
		}
	}
	return out;
}

/**
 * Strip ANSI escape sequences.
 *
 * Programs run by code-repl usually detect a pipe and disable colour, but not
 * all of them do, and a raw escape sequence rendered as literal cells is worse
 * than no colour at all.
 */
export function stripAnsi(text: string): string {
	// The rule guards against typing an ESC by accident; here matching it is the job.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberate
	return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/**
 * Expand tabs to spaces.
 *
 * OpenTUI renders cells, not pixels, so a column index is only a display
 * position when every character occupies one cell. A literal tab breaks that,
 * and the cursor drifts from where the text appears.
 */
export function expandTabs(text: string, width: number): string {
	return text.replace(/\t/g, " ".repeat(width));
}
