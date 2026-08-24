import { StyledText, parseColor, type TextChunk } from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { languageFor, sliceTokens, tokenize, type Token } from "../lib/highlight";
import { darkTheme, type EditorTheme } from "../lib/theme";

export interface CodeEditorProps {
	/** Initial document text. The editor owns the text after mount. */
	value?: string;
	/** Grammar used for highlighting: typescript, javascript, python, json. */
	language?: string;
	/** Shown in the border title and the status bar. */
	filename?: string;
	/** Outer size in terminal cells, including border and status bar. */
	width: number;
	height: number;
	focused?: boolean;
	readOnly?: boolean;
	indentWidth?: number;
	theme?: EditorTheme;
	onChange?: (text: string) => void;
	onSave?: (text: string) => void;
}

interface Cursor {
	line: number;
	col: number;
}

interface Doc {
	lines: string[];
	cursor: Cursor;
}

const HISTORY_LIMIT = 200;

export function CodeEditor({
	value = "",
	language = "typescript",
	filename = "untitled",
	width,
	height,
	focused = true,
	readOnly = false,
	indentWidth = 2,
	theme = darkTheme,
	onChange,
	onSave,
}: CodeEditorProps) {
	const indent = " ".repeat(indentWidth);
	const [doc, setDoc] = useState<Doc>(() => ({
		lines: splitLines(value, indentWidth),
		cursor: { line: 0, col: 0 },
	}));
	const [scroll, setScroll] = useState({ top: 0, left: 0 });
	// Column the cursor tries to return to while moving vertically.
	const desiredCol = useRef(0);
	const undoStack = useRef<Doc[]>([]);
	const redoStack = useRef<Doc[]>([]);

	const { lines, cursor } = doc;
	const gutterWidth = String(Math.max(lines.length, 1)).length + 2;
	const viewRows = Math.max(1, height - 3); // borders + status bar
	const viewCols = Math.max(1, width - 2 - gutterWidth);

	const lang = useMemo(() => languageFor(language), [language]);
	const tokens = useMemo(() => tokenize(lines.join("\n"), lang), [lines, lang]);

	useEffect(() => {
		onChange?.(lines.join("\n"));
	}, [lines]);

	// Keep the cursor inside the viewport after every move or edit.
	useEffect(() => {
		setScroll((prev) => {
			let { top, left } = prev;
			if (cursor.line < top) top = cursor.line;
			if (cursor.line >= top + viewRows) top = cursor.line - viewRows + 1;
			if (cursor.col < left) left = cursor.col;
			if (cursor.col >= left + viewCols) left = cursor.col - viewCols + 1;
			top = clamp(top, 0, Math.max(0, lines.length - viewRows));
			left = Math.max(0, left);
			return top === prev.top && left === prev.left ? prev : { top, left };
		});
	}, [cursor, viewRows, viewCols, lines.length]);

	function edit(mutate: (doc: Doc) => Doc, recordHistory = true) {
		if (readOnly) return;
		setDoc((prev) => {
			const next = mutate(prev);
			if (next === prev) return prev;
			if (recordHistory) {
				undoStack.current.push(prev);
				if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
				redoStack.current.length = 0;
			}
			return next;
		});
	}

	function moveCursor(mutate: (doc: Doc) => Cursor) {
		setDoc((prev) => {
			const next = mutate(prev);
			if (next.line === prev.cursor.line && next.col === prev.cursor.col) return prev;
			return { ...prev, cursor: next };
		});
	}

	function insertText(text: string) {
		edit(({ lines, cursor }) => {
			const inserted = splitLines(text, indentWidth);
			const line = lines[cursor.line] ?? "";
			const before = line.slice(0, cursor.col);
			const after = line.slice(cursor.col);
			const next = lines.slice();
			if (inserted.length === 1) {
				next[cursor.line] = before + inserted[0] + after;
				return { lines: next, cursor: { line: cursor.line, col: cursor.col + inserted[0]!.length } };
			}
			const last = inserted[inserted.length - 1]!;
			const block = [
				before + inserted[0],
				...inserted.slice(1, -1),
				last + after,
			];
			next.splice(cursor.line, 1, ...block);
			return {
				lines: next,
				cursor: { line: cursor.line + inserted.length - 1, col: last.length },
			};
		});
	}

	usePaste((event) => {
		if (!focused || readOnly) return;
		insertText(new TextDecoder().decode(event.bytes));
	});

	useKeyboard((key) => {
		if (!focused) return;
		if (key.ctrl && (key.name === "c" || key.name === "q")) return; // owned by the host app

		const name = key.name;
		const lineText = lines[cursor.line] ?? "";

		// Navigation
		if (name === "left" || name === "right" || name === "up" || name === "down") {
			moveCursor(({ lines, cursor }) => {
				if (name === "left") {
					if (cursor.col > 0) {
						const col = key.ctrl ? wordLeft(lines[cursor.line] ?? "", cursor.col) : cursor.col - 1;
						desiredCol.current = col;
						return { line: cursor.line, col };
					}
					if (cursor.line === 0) return cursor;
					const col = (lines[cursor.line - 1] ?? "").length;
					desiredCol.current = col;
					return { line: cursor.line - 1, col };
				}
				if (name === "right") {
					const text = lines[cursor.line] ?? "";
					if (cursor.col < text.length) {
						const col = key.ctrl ? wordRight(text, cursor.col) : cursor.col + 1;
						desiredCol.current = col;
						return { line: cursor.line, col };
					}
					if (cursor.line >= lines.length - 1) return cursor;
					desiredCol.current = 0;
					return { line: cursor.line + 1, col: 0 };
				}
				const line = clamp(cursor.line + (name === "up" ? -1 : 1), 0, lines.length - 1);
				const target = Math.max(desiredCol.current, cursor.col);
				desiredCol.current = target;
				return { line, col: Math.min(target, (lines[line] ?? "").length) };
			});
			return;
		}

		if (name === "home") {
			const firstNonSpace = lineText.length - lineText.trimStart().length;
			const col = cursor.col === firstNonSpace ? 0 : firstNonSpace;
			desiredCol.current = col;
			moveCursor(({ cursor }) => ({ line: cursor.line, col }));
			return;
		}
		if (name === "end") {
			desiredCol.current = lineText.length;
			moveCursor(({ cursor, lines }) => ({ line: cursor.line, col: (lines[cursor.line] ?? "").length }));
			return;
		}
		if (name === "pageup" || name === "pagedown") {
			const delta = name === "pageup" ? -viewRows : viewRows;
			moveCursor(({ lines, cursor }) => {
				const line = clamp(cursor.line + delta, 0, lines.length - 1);
				return { line, col: Math.min(cursor.col, (lines[line] ?? "").length) };
			});
			return;
		}

		if (readOnly) return;

		// History
		if (key.ctrl && name === "z") {
			const prev = undoStack.current.pop();
			if (prev) {
				setDoc((current) => {
					redoStack.current.push(current);
					return prev;
				});
			}
			return;
		}
		if (key.ctrl && (name === "y" || (name === "z" && key.shift))) {
			const next = redoStack.current.pop();
			if (next) {
				setDoc((current) => {
					undoStack.current.push(current);
					return next;
				});
			}
			return;
		}

		if (key.ctrl && name === "s") {
			onSave?.(lines.join("\n"));
			return;
		}

		// Line operations
		if (key.ctrl && name === "k") {
			edit(({ lines, cursor }) => {
				if (lines.length === 1) return { lines: [""], cursor: { line: 0, col: 0 } };
				const next = lines.slice();
				next.splice(cursor.line, 1);
				const line = Math.min(cursor.line, next.length - 1);
				return { lines: next, cursor: { line, col: Math.min(cursor.col, next[line]!.length) } };
			});
			return;
		}
		if (key.ctrl && name === "d") {
			edit(({ lines, cursor }) => {
				const next = lines.slice();
				next.splice(cursor.line + 1, 0, lines[cursor.line] ?? "");
				return { lines: next, cursor: { line: cursor.line + 1, col: cursor.col } };
			});
			return;
		}

		if (name === "return" || name === "enter") {
			edit(({ lines, cursor }) => {
				const text = lines[cursor.line] ?? "";
				const before = text.slice(0, cursor.col);
				const after = text.slice(cursor.col);
				const lead = before.slice(0, before.length - before.trimStart().length);
				const extra = /[([{:]$/.test(before.trimEnd()) ? indent : "";
				const next = lines.slice();
				next.splice(cursor.line, 1, before, lead + extra + after);
				return { lines: next, cursor: { line: cursor.line + 1, col: lead.length + extra.length } };
			});
			desiredCol.current = 0;
			return;
		}

		if (name === "tab") {
			if (key.shift) {
				edit(({ lines, cursor }) => {
					const text = lines[cursor.line] ?? "";
					const removed = Math.min(indentWidth, text.length - text.trimStart().length);
					if (removed === 0) return { lines, cursor };
					const next = lines.slice();
					next[cursor.line] = text.slice(removed);
					return { lines: next, cursor: { line: cursor.line, col: Math.max(0, cursor.col - removed) } };
				});
			} else {
				insertText(indent);
			}
			return;
		}

		if (name === "backspace") {
			edit(({ lines, cursor }) => {
				const text = lines[cursor.line] ?? "";
				if (cursor.col > 0) {
					// Delete a whole indent step when only whitespace precedes the cursor.
					const lead = text.slice(0, cursor.col);
					const step = lead.trim() === "" && cursor.col % indentWidth === 0 ? indentWidth : 1;
					const next = lines.slice();
					next[cursor.line] = text.slice(0, cursor.col - step) + text.slice(cursor.col);
					return { lines: next, cursor: { line: cursor.line, col: cursor.col - step } };
				}
				if (cursor.line === 0) return { lines, cursor };
				const prevText = lines[cursor.line - 1] ?? "";
				const next = lines.slice();
				next.splice(cursor.line - 1, 2, prevText + text);
				return { lines: next, cursor: { line: cursor.line - 1, col: prevText.length } };
			});
			return;
		}

		if (name === "delete") {
			edit(({ lines, cursor }) => {
				const text = lines[cursor.line] ?? "";
				if (cursor.col < text.length) {
					const next = lines.slice();
					next[cursor.line] = text.slice(0, cursor.col) + text.slice(cursor.col + 1);
					return { lines: next, cursor };
				}
				if (cursor.line >= lines.length - 1) return { lines, cursor };
				const next = lines.slice();
				next.splice(cursor.line, 2, text + (lines[cursor.line + 1] ?? ""));
				return { lines: next, cursor };
			});
			return;
		}

		// Printable characters
		const seq = key.sequence ?? "";
		if (!key.ctrl && !key.meta && seq.length === 1 && seq >= " " && seq !== "\x7f") {
			insertText(seq);
			desiredCol.current = cursor.col + 1;
		}
	});

	// Render the visible window only.
	const firstLine = scroll.top;
	const lastLine = Math.min(lines.length, firstLine + viewRows);
	const rows = [];
	for (let i = firstLine; i < lastLine; i++) {
		const isCursorLine = i === cursor.line;
		rows.push(
			<box key={i} flexDirection="row" height={1}>
				<text
					content={gutterChunks(i + 1, gutterWidth, isCursorLine, theme)}
					wrapMode="none"
					selectable={false}
				/>
				<text
					content={codeChunks(
						lines[i] ?? "",
						tokens[i] ?? [],
						scroll.left,
						viewCols,
						isCursorLine,
						isCursorLine && focused ? cursor.col : -1,
						theme,
					)}
					wrapMode="none"
					selectable={false}
				/>
			</box>,
		);
	}

	return (
		<box
			width={width}
			height={height}
			border
			borderColor={focused ? theme.borderFocused : theme.border}
			backgroundColor={theme.background}
			title={` ${filename} `}
			titleAlignment="left"
			flexDirection="column"
		>
			<box flexDirection="column" flexGrow={1} overflow="hidden">
				{rows}
			</box>
			<text
				content={statusChunks(lang.name, cursor, lines.length, readOnly, width - 2, theme)}
				wrapMode="none"
				selectable={false}
			/>
		</box>
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

function splitLines(text: string, indentWidth: number): string[] {
	// Tabs are expanded so that a column index always equals a display cell.
	return text.replace(/\r\n?/g, "\n").replace(/\t/g, " ".repeat(indentWidth)).split("\n");
}

function wordLeft(text: string, col: number): number {
	let i = col - 1;
	while (i > 0 && /\s/.test(text[i]!)) i--;
	while (i > 0 && !/\s/.test(text[i - 1]!)) i--;
	return i;
}

function wordRight(text: string, col: number): number {
	let i = col;
	while (i < text.length && /\s/.test(text[i]!)) i++;
	while (i < text.length && !/\s/.test(text[i]!)) i++;
	return i;
}

function chunk(text: string, fg: string, bg?: string, attributes = 0): TextChunk {
	return {
		__isChunk: true,
		text,
		fg: parseColor(fg),
		bg: bg ? parseColor(bg) : undefined,
		attributes,
	};
}

function gutterChunks(lineNumber: number, width: number, active: boolean, theme: EditorTheme): StyledText {
	const label = String(lineNumber).padStart(width - 1, " ") + " ";
	return new StyledText([
		chunk(label, active ? theme.gutterActive : theme.gutter, active ? theme.currentLine : theme.background),
	]);
}

/**
 * Turn one source line plus its tokens into styled chunks, clipped to the
 * horizontal scroll window and with the cursor cell inverted.
 */
function codeChunks(
	text: string,
	tokens: Token[],
	scrollLeft: number,
	viewCols: number,
	isCursorLine: boolean,
	cursorCol: number,
	theme: EditorTheme,
): StyledText {
	const visible = text.slice(scrollLeft, scrollLeft + viewCols).padEnd(viewCols, " ");
	const sliced = sliceTokens(tokens, scrollLeft, scrollLeft + viewCols);
	const lineBg = isCursorLine ? theme.currentLine : theme.background;

	// One colour per visible column, then collapse equal neighbours into chunks.
	const colors = new Array<string>(visible.length).fill(theme.token.plain);
	for (const token of sliced) {
		const color = theme.token[token.kind];
		for (let i = token.start; i < token.end && i < colors.length; i++) colors[i] = color;
	}

	const cursorIndex = cursorCol >= 0 ? cursorCol - scrollLeft : -1;
	const chunks: TextChunk[] = [];
	let runStart = 0;
	const flush = (end: number) => {
		if (end <= runStart) return;
		const isCursor = runStart === cursorIndex;
		chunks.push(
			isCursor
				? chunk(visible.slice(runStart, end), theme.cursorText, theme.cursor)
				: chunk(visible.slice(runStart, end), colors[runStart]!, lineBg),
		);
		runStart = end;
	};
	// A run breaks on a colour change and around the cursor cell, so the cursor
	// always ends up as a chunk of its own.
	for (let i = 1; i <= visible.length; i++) {
		if (i === visible.length || colors[i] !== colors[i - 1] || i === cursorIndex || i - 1 === cursorIndex) {
			flush(i);
		}
	}
	return new StyledText(chunks);
}

function statusChunks(
	language: string,
	cursor: Cursor,
	lineCount: number,
	readOnly: boolean,
	width: number,
	theme: EditorTheme,
): StyledText {
	const right = `Ln ${cursor.line + 1}/${lineCount}, Col ${cursor.col + 1} `;
	// The position is what matters most, so the mode label gives up space first.
	const left = ` ${readOnly ? "READ-ONLY" : "INSERT"}  ${language}`.slice(
		0,
		Math.max(0, width - right.length - 1),
	);
	const gap = Math.max(0, width - left.length - right.length);
	return new StyledText([
		chunk(left, readOnly ? theme.muted : theme.cursor, theme.surface),
		chunk(" ".repeat(gap), theme.muted, theme.surface),
		chunk(right.slice(0, width - left.length - gap), theme.muted, theme.surface),
	]);
}
