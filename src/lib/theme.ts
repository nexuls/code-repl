import type { TokenKind } from "./highlight";

/**
 * Every colour the UI can use.
 *
 * Components reference tokens, never hex literals, so a theme swap is one object
 * and nothing has to be hunted down. Adding a colour means adding a token here
 * first — see AGENTS.md.
 */
export interface EditorTheme {
	// Surfaces
	background: string;
	surface: string;
	/** Slightly raised surface: tab bar, popup bodies. */
	elevated: string;
	border: string;
	borderFocused: string;

	// Text
	text: string;
	muted: string;
	/** Foreground on an accent-coloured background. */
	inverse: string;

	// Editor chrome
	gutter: string;
	gutterActive: string;
	currentLine: string;
	cursor: string;
	cursorText: string;
	selection: string;

	// Accents
	accent: string;
	success: string;
	warning: string;
	error: string;
	info: string;

	// Tabs
	tabActive: string;
	tabActiveText: string;
	tabInactive: string;
	tabInactiveText: string;
	/** Dot marking an unsaved buffer. */
	tabDirty: string;

	// File tree
	treeDirectory: string;
	treeFile: string;
	treeSelected: string;
	treeSelectedText: string;

	// Output pane
	outputStdout: string;
	outputStderr: string;
	/** Runner's own messages: timeouts, spawn failures. */
	outputSystem: string;

	/** Greyed-out entry: a language with no toolchain installed. */
	disabled: string;

	token: Record<TokenKind, string>;
}

/** A calm dark theme; every colour is a plain hex string OpenTUI can parse. */
export const darkTheme: EditorTheme = {
	background: "#11131a",
	surface: "#171a23",
	elevated: "#1d2130",
	border: "#2a2f3d",
	borderFocused: "#5aa9e6",

	text: "#c8d0e0",
	muted: "#6b7488",
	inverse: "#11131a",

	gutter: "#3d4557",
	gutterActive: "#8ea0c0",
	currentLine: "#1a1e29",
	cursor: "#5aa9e6",
	cursorText: "#11131a",
	selection: "#2c3852",

	accent: "#5aa9e6",
	success: "#98c379",
	warning: "#e5c07b",
	error: "#e06c75",
	info: "#56b6c2",

	tabActive: "#1d2130",
	tabActiveText: "#e2e8f5",
	tabInactive: "#151821",
	tabInactiveText: "#6b7488",
	tabDirty: "#e5c07b",

	treeDirectory: "#89b9e8",
	treeFile: "#c8d0e0",
	treeSelected: "#2c3852",
	treeSelectedText: "#e2e8f5",

	outputStdout: "#c8d0e0",
	outputStderr: "#e06c75",
	outputSystem: "#e5c07b",

	disabled: "#464e60",

	token: {
		plain: "#c8d0e0",
		comment: "#5c6478",
		string: "#98c379",
		template: "#98c379",
		regex: "#56b6c2",
		number: "#d19a66",
		keyword: "#c678dd",
		control: "#e06c75",
		literal: "#d19a66",
		type: "#e5c07b",
		function: "#61afef",
		property: "#89b9e8",
		operator: "#89929f",
		punctuation: "#7d8799",
	},
};
