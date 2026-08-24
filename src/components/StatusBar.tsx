/**
 * The bottom status line.
 *
 * Three regions competing for one row: state on the left, a transient message in
 * the middle, key hints on the right. Width is finite, so the priority order is
 * explicit — state first, then hints, then the message — rather than whichever
 * happens to be rendered first winning.
 */

import { StyledText } from "@opentui/core";
import type { Tab } from "../app/state/tabs";
import { isDirty } from "../app/state/tabs";
import type { DetectedLanguage } from "../core/languages/detect";
import { chunk, fit } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface StatusBarProps {
	readonly tab?: Tab;
	/** Detection result for the active tab's language, if known. */
	readonly detected?: DetectedLanguage;
	/** Whether a language server is running for the active language. */
	readonly lspActive: boolean;
	/** Transient message, e.g. "saved" or an error. */
	readonly message?: string;
	readonly width: number;
	readonly theme: EditorTheme;
}

const HINTS = "^R run  ^S save  ^P lang  ^O folder  ^/ help";

export function StatusBar({
	tab,
	detected,
	lspActive,
	message,
	width,
	theme,
}: StatusBarProps) {
	const chunks = [];

	// Left: language, toolchain, and whether the machine can actually run it.
	const runnable = detected?.toolchain !== undefined;
	const languageLabel = tab
		? ` ${tab.language.name}${runnable ? "" : " (no toolchain)"} `
		: " no buffer ";
	chunks.push(
		chunk(
			languageLabel,
			runnable ? theme.inverse : theme.warning,
			runnable ? theme.accent : theme.elevated,
		),
	);

	// Then the run result, coloured by outcome so it reads at a glance.
	if (tab?.runSummary) {
		chunks.push(
			chunk(
				` ${tab.runSummary} `,
				tab.runStatus === "success" ? theme.success : theme.error,
				theme.surface,
			),
		);
	} else if (tab?.running) {
		chunks.push(chunk(" running… ", theme.info, theme.surface));
	}

	if (tab && isDirty(tab)) {
		chunks.push(chunk(" ● unsaved ", theme.tabDirty, theme.surface));
	}
	if (lspActive) {
		chunks.push(chunk(" lsp ", theme.info, theme.surface));
	}

	const used = chunks.reduce((sum, c) => sum + c.text.length, 0);

	// Hints are dropped before the message is: a message is usually the answer to
	// something you just did, while hints are always the same.
	const hintWidth = HINTS.length + 2;
	const showHints = width - used >= hintWidth + 4;
	const middleWidth = Math.max(0, width - used - (showHints ? hintWidth : 0));

	chunks.push(
		chunk(
			fit(message ? ` ${message}` : "", middleWidth),
			messageColour(message, theme),
			theme.surface,
		),
	);
	if (showHints) {
		chunks.push(chunk(` ${HINTS} `, theme.muted, theme.surface));
	}

	return (
		<text content={new StyledText(chunks)} wrapMode="none" selectable={false} />
	);
}

/**
 * Colour a transient message by whether it reads as a failure. Cheap heuristic,
 * but the alternative is threading a severity through every call site that sets
 * a status string.
 */
function messageColour(
	message: string | undefined,
	theme: EditorTheme,
): string {
	if (!message) return theme.muted;
	return /\b(cannot|could not|failed|no |error)/i.test(message)
		? theme.error
		: theme.text;
}
