import type { TokenKind } from "./highlight";

export interface EditorTheme {
	background: string;
	surface: string;
	border: string;
	borderFocused: string;
	text: string;
	muted: string;
	gutter: string;
	gutterActive: string;
	currentLine: string;
	cursor: string;
	cursorText: string;
	token: Record<TokenKind, string>;
}

/** A calm dark theme; every colour is a plain hex string OpenTUI can parse. */
export const darkTheme: EditorTheme = {
	background: "#11131a",
	surface: "#171a23",
	border: "#2a2f3d",
	borderFocused: "#5aa9e6",
	text: "#c8d0e0",
	muted: "#6b7488",
	gutter: "#3d4557",
	gutterActive: "#8ea0c0",
	currentLine: "#1a1e29",
	cursor: "#5aa9e6",
	cursorText: "#11131a",
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
