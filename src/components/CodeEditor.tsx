import {
	parseColor,
	StyledText,
	TextAttributes,
	type TextChunk,
} from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CompletionItem, Diagnostic } from "../core/lsp/protocol";
import { DiagnosticSeverity } from "../core/lsp/protocol";
import {
	languageFor,
	sliceTokens,
	type Token,
	tokenize,
} from "../lib/highlight";
import { darkTheme, type EditorTheme } from "../lib/theme";
import { CompletionPopup, popupHeight } from "./CompletionPopup";

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
	/**
	 * Diagnostics for this buffer, in LSP coordinates. Rendered as a gutter mark
	 * and an underline; the message for the cursor's line shows in the footer.
	 */
	diagnostics?: readonly Diagnostic[];
	/**
	 * Ask for completions at a position. The editor owns the popup and the
	 * insertion; the caller owns where the items come from.
	 *
	 * Returning `[]` — which is what a machine with no language server does — is
	 * indistinguishable from having nothing to suggest, and no popup appears.
	 */
	completionProvider?: (
		line: number,
		column: number,
	) => Promise<readonly CompletionItem[]>;
	onChange?: (text: string) => void;
	onSave?: (text: string) => void;
	/** Reports cursor moves, so a host can drive hover or a status readout. */
	onCursorChange?: (line: number, column: number) => void;
}

interface Cursor {
	line: number;
	col: number;
}

interface Doc {
	lines: string[];
	cursor: Cursor;
}

/** An open completion popup and where it was anchored. */
interface CompletionState {
	readonly items: readonly CompletionItem[];
	readonly selected: number;
	/** Line the popup was opened on. */
	readonly anchorLine: number;
	/** Column the partial word starts at; accepting replaces from here. */
	readonly anchorCol: number;
}

const HISTORY_LIMIT = 200;
const POPUP_WIDTH = 44;

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
	diagnostics,
	completionProvider,
	onChange,
	onSave,
	onCursorChange,
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

	// Diagnostics keyed by line, so rendering a row is a map lookup rather than a
	// scan of the whole list for every visible row.
	const diagnosticsByLine = useMemo(
		() => indexDiagnostics(diagnostics ?? []),
		[diagnostics],
	);

	const [completion, setCompletion] = useState<CompletionState | undefined>(
		undefined,
	);
	// Identifies the in-flight request. A slow response for a position the cursor
	// has already left must be discarded, or the popup reopens under a stale
	// prefix while you keep typing.
	const completionRequest = useRef(0);

	const closeCompletion = useCallback(() => {
		completionRequest.current += 1;
		setCompletion(undefined);
	}, []);

	const requestCompletion = useCallback(
		async (line: number, col: number, lineText: string) => {
			if (!completionProvider) return;
			const token = ++completionRequest.current;
			const items = await completionProvider(line, col);
			if (token !== completionRequest.current) return; // Superseded.
			if (items.length === 0) {
				setCompletion(undefined);
				return;
			}
			const preselected = items.findIndex((item) => item.preselect);
			setCompletion({
				items,
				selected: preselected >= 0 ? preselected : 0,
				anchorLine: line,
				anchorCol: wordStart(lineText, col),
			});
		},
		[completionProvider],
	);

	// An unstable onChange identity would re-fire this effect on every render
	// and loop through the parent's state update, so it stays out of the deps.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		onChange?.(lines.join("\n"));
	}, [lines]);

	// An unstable onCursorChange identity would re-fire on every render; only the
	// position matters here.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(() => {
		onCursorChange?.(cursor.line, cursor.col);
	}, [cursor.line, cursor.col]);

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
			if (next.line === prev.cursor.line && next.col === prev.cursor.col)
				return prev;
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
				return {
					lines: next,
					cursor: { line: cursor.line, col: cursor.col + inserted[0]!.length },
				};
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

	/**
	 * Insert the chosen completion, replacing the partial word the popup was
	 * anchored to. Replacing from the anchor rather than inserting at the cursor
	 * is what stops "co" + "console" becoming "coconsole".
	 */
	function acceptCompletion(index: number) {
		const state = completion;
		const item = state?.items[index];
		if (!state || !item) return;

		const text = item.textEdit?.newText ?? item.insertText ?? item.label;
		closeCompletion();
		edit(({ lines, cursor }) => {
			const line = lines[cursor.line] ?? "";
			const from =
				cursor.line === state.anchorLine ? state.anchorCol : cursor.col;
			const next = lines.slice();
			next[cursor.line] = line.slice(0, from) + text + line.slice(cursor.col);
			return {
				lines: next,
				cursor: { line: cursor.line, col: from + text.length },
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

		// The popup takes the keys it needs before the editor sees them, so arrows
		// move through suggestions rather than the buffer while it is open.
		if (completion) {
			if (name === "escape") {
				closeCompletion();
				return;
			}
			if (name === "up" || name === "down") {
				const delta = name === "down" ? 1 : -1;
				setCompletion((prev) =>
					prev
						? {
								...prev,
								selected:
									(prev.selected + delta + prev.items.length) %
									prev.items.length,
							}
						: prev,
				);
				return;
			}
			if (name === "return" || name === "enter" || name === "tab") {
				acceptCompletion(completion.selected);
				return;
			}
			// Anything that moves off the line, or any other navigation, dismisses
			// rather than leaving a popup anchored to a position you have left.
			if (
				name === "left" ||
				name === "right" ||
				name === "home" ||
				name === "end"
			) {
				closeCompletion();
			}
		}

		// Ctrl+Space explicitly asks for completions.
		if (key.ctrl && (name === "space" || key.sequence === "\u0000")) {
			void requestCompletion(cursor.line, cursor.col, lineText);
			return;
		}

		// Navigation
		if (
			name === "left" ||
			name === "right" ||
			name === "up" ||
			name === "down"
		) {
			moveCursor(({ lines, cursor }) => {
				if (name === "left") {
					if (cursor.col > 0) {
						const col = key.ctrl
							? wordLeft(lines[cursor.line] ?? "", cursor.col)
							: cursor.col - 1;
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
				const line = clamp(
					cursor.line + (name === "up" ? -1 : 1),
					0,
					lines.length - 1,
				);
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
			moveCursor(({ cursor, lines }) => ({
				line: cursor.line,
				col: (lines[cursor.line] ?? "").length,
			}));
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
				if (lines.length === 1)
					return { lines: [""], cursor: { line: 0, col: 0 } };
				const next = lines.slice();
				next.splice(cursor.line, 1);
				const line = Math.min(cursor.line, next.length - 1);
				return {
					lines: next,
					cursor: { line, col: Math.min(cursor.col, next[line]!.length) },
				};
			});
			return;
		}
		if (key.ctrl && name === "d") {
			edit(({ lines, cursor }) => {
				const next = lines.slice();
				next.splice(cursor.line + 1, 0, lines[cursor.line] ?? "");
				return {
					lines: next,
					cursor: { line: cursor.line + 1, col: cursor.col },
				};
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
				return {
					lines: next,
					cursor: { line: cursor.line + 1, col: lead.length + extra.length },
				};
			});
			desiredCol.current = 0;
			return;
		}

		if (name === "tab") {
			if (key.shift) {
				edit(({ lines, cursor }) => {
					const text = lines[cursor.line] ?? "";
					const removed = Math.min(
						indentWidth,
						text.length - text.trimStart().length,
					);
					if (removed === 0) return { lines, cursor };
					const next = lines.slice();
					next[cursor.line] = text.slice(removed);
					return {
						lines: next,
						cursor: {
							line: cursor.line,
							col: Math.max(0, cursor.col - removed),
						},
					};
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
					const step =
						lead.trim() === "" && cursor.col % indentWidth === 0
							? indentWidth
							: 1;
					const next = lines.slice();
					next[cursor.line] =
						text.slice(0, cursor.col - step) + text.slice(cursor.col);
					return {
						lines: next,
						cursor: { line: cursor.line, col: cursor.col - step },
					};
				}
				if (cursor.line === 0) return { lines, cursor };
				const prevText = lines[cursor.line - 1] ?? "";
				const next = lines.slice();
				next.splice(cursor.line - 1, 2, prevText + text);
				return {
					lines: next,
					cursor: { line: cursor.line - 1, col: prevText.length },
				};
			});
			return;
		}

		if (name === "delete") {
			edit(({ lines, cursor }) => {
				const text = lines[cursor.line] ?? "";
				if (cursor.col < text.length) {
					const next = lines.slice();
					next[cursor.line] =
						text.slice(0, cursor.col) + text.slice(cursor.col + 1);
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
		if (
			!key.ctrl &&
			!key.meta &&
			seq.length === 1 &&
			seq >= " " &&
			seq !== "\x7f"
		) {
			insertText(seq);
			desiredCol.current = cursor.col + 1;

			if (completion) {
				// A word character keeps the popup and re-queries with the longer
				// prefix; anything else has ended the word being completed.
				if (/[A-Za-z0-9_$]/.test(seq)) {
					void requestCompletion(cursor.line, cursor.col + 1, lineText + seq);
				} else {
					closeCompletion();
				}
			} else if (seq === "." && completionProvider) {
				// A member access is the one place worth opening the popup unasked:
				// it is the case where nobody remembers the whole list.
				void requestCompletion(cursor.line, cursor.col + 1, lineText + seq);
			}
		}
	});

	/** Map a mouse cell inside the editor box to a document position. */
	function positionAt(localX: number, localY: number): Cursor | undefined {
		// One row and one column of border, then the gutter.
		const row = localY - 1;
		const col = localX - 1 - gutterWidth;
		if (row < 0 || row >= viewRows) return undefined;
		const line = Math.min(scroll.top + row, lines.length - 1);
		if (line < 0) return undefined;
		// Clicking past the end of a line puts the cursor at its end, which is what
		// every editor does and what people expect when they click empty space.
		return {
			line,
			col: clamp(scroll.left + Math.max(0, col), 0, (lines[line] ?? "").length),
		};
	}

	// Render the visible window only.
	const firstLine = scroll.top;
	const lastLine = Math.min(lines.length, firstLine + viewRows);
	const rows = [];
	for (let i = firstLine; i < lastLine; i++) {
		const isCursorLine = i === cursor.line;
		rows.push(
			<box key={i} flexDirection="row" height={1}>
				<text
					content={gutterChunks(
						i + 1,
						gutterWidth,
						isCursorLine,
						diagnosticsByLine.get(i),
						theme,
					)}
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
						diagnosticsByLine.get(i),
						theme,
					)}
					wrapMode="none"
					selectable={false}
				/>
			</box>,
		);
	}

	// The diagnostic under the cursor, shown in the footer. Only one fits, so the
	// most severe wins — a type error matters more than a style hint on the same
	// line.
	const cursorDiagnostic =
		mostSevere(
			(diagnosticsByLine.get(cursor.line) ?? []).filter((d) =>
				containsColumn(d, cursor.line, cursor.col),
			),
		) ?? mostSevere(diagnosticsByLine.get(cursor.line) ?? []);

	// The popup opens below the cursor, or above it when there is no room —
	// otherwise completing on the last visible line shows nothing.
	const popupRows = completion ? popupHeight(completion.items.length, 8) : 0;
	const cursorRow = cursor.line - scroll.top + 1;
	const popupBelow = cursorRow + 1 + popupRows <= viewRows;
	const popupTop = popupBelow
		? cursorRow + 1
		: Math.max(1, cursorRow - popupRows);

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
			onMouseDown={(event) => {
				const target = event.currentTarget;
				if (!target) return;
				const position = positionAt(event.x - target.x, event.y - target.y);
				if (!position) return;
				closeCompletion();
				desiredCol.current = position.col;
				setDoc((prev) => ({ ...prev, cursor: position }));
			}}
			onMouseDrag={(event) => {
				// Dragging moves the caret with the pointer. Full range selection is
				// not modelled yet; following the pointer is still better than a
				// caret that freezes mid-gesture.
				const target = event.currentTarget;
				if (!target) return;
				const position = positionAt(event.x - target.x, event.y - target.y);
				if (position) setDoc((prev) => ({ ...prev, cursor: position }));
			}}
			onMouseScroll={(event) => {
				const delta = event.scroll?.direction === "up" ? -3 : 3;
				setScroll((prev) => ({
					...prev,
					top: clamp(prev.top + delta, 0, Math.max(0, lines.length - viewRows)),
				}));
			}}
		>
			<box flexDirection="column" flexGrow={1} overflow="hidden">
				{rows}
			</box>
			<text
				content={
					cursorDiagnostic
						? diagnosticChunks(cursorDiagnostic, width - 2, theme)
						: statusChunks(
								lang.name,
								cursor,
								lines.length,
								readOnly,
								width - 2,
								theme,
							)
				}
				wrapMode="none"
				selectable={false}
			/>
			{completion ? (
				<box
					position="absolute"
					left={Math.min(
						gutterWidth + 1 + Math.max(0, completion.anchorCol - scroll.left),
						Math.max(1, width - POPUP_WIDTH - 1),
					)}
					top={popupTop}
				>
					<CompletionPopup
						items={completion.items}
						selected={completion.selected}
						width={Math.min(POPUP_WIDTH, Math.max(10, width - 4))}
						maxRows={8}
						theme={theme}
						onChoose={acceptCompletion}
					/>
				</box>
			) : null}
		</box>
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}

function splitLines(text: string, indentWidth: number): string[] {
	// Tabs are expanded so that a column index always equals a display cell.
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/\t/g, " ".repeat(indentWidth))
		.split("\n");
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

function chunk(
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

function gutterChunks(
	lineNumber: number,
	width: number,
	active: boolean,
	lineDiagnostics: readonly Diagnostic[] | undefined,
	theme: EditorTheme,
): StyledText {
	const bg = active ? theme.currentLine : theme.background;
	const worst = mostSevere(lineDiagnostics ?? []);
	// The mark replaces the trailing space rather than widening the gutter, so a
	// diagnostic appearing does not reflow the whole document sideways.
	const label = String(lineNumber).padStart(width - 1, " ");
	if (!worst) {
		return new StyledText([
			chunk(`${label} `, active ? theme.gutterActive : theme.gutter, bg),
		]);
	}
	return new StyledText([
		chunk(label, active ? theme.gutterActive : theme.gutter, bg),
		chunk(severityMark(worst), severityColour(worst, theme), bg),
	]);
}

/** Group diagnostics by the line they start on. */
function indexDiagnostics(
	diagnostics: readonly Diagnostic[],
): Map<number, Diagnostic[]> {
	const byLine = new Map<number, Diagnostic[]>();
	for (const diagnostic of diagnostics) {
		// A multi-line diagnostic is attached to every line it covers, so the
		// underline does not silently vanish on the continuation lines.
		for (
			let line = diagnostic.range.start.line;
			line <= diagnostic.range.end.line;
			line++
		) {
			const existing = byLine.get(line);
			if (existing) existing.push(diagnostic);
			else byLine.set(line, [diagnostic]);
		}
	}
	return byLine;
}

/** Lowest severity number wins: Error(1) outranks Hint(4). */
function mostSevere(
	diagnostics: readonly Diagnostic[],
): Diagnostic | undefined {
	let worst: Diagnostic | undefined;
	for (const diagnostic of diagnostics) {
		// An absent severity means the server left it to the client; the spec's
		// guidance is to treat that as an error.
		const rank = diagnostic.severity ?? DiagnosticSeverity.Error;
		const best = worst?.severity ?? DiagnosticSeverity.Error;
		if (!worst || rank < best) worst = diagnostic;
	}
	return worst;
}

/** True when a diagnostic's range covers a given position. */
function containsColumn(
	diagnostic: Diagnostic,
	line: number,
	column: number,
): boolean {
	const { start, end } = diagnostic.range;
	if (line < start.line || line > end.line) return false;
	if (line === start.line && column < start.character) return false;
	if (line === end.line && column > end.character) return false;
	return true;
}

function severityColour(diagnostic: Diagnostic, theme: EditorTheme): string {
	switch (diagnostic.severity ?? DiagnosticSeverity.Error) {
		case DiagnosticSeverity.Error:
			return theme.error;
		case DiagnosticSeverity.Warning:
			return theme.warning;
		case DiagnosticSeverity.Information:
			return theme.info;
		default:
			return theme.muted;
	}
}

function severityMark(diagnostic: Diagnostic): string {
	switch (diagnostic.severity ?? DiagnosticSeverity.Error) {
		case DiagnosticSeverity.Error:
			return "✖";
		case DiagnosticSeverity.Warning:
			return "▲";
		default:
			return "·";
	}
}

/** Footer line showing the diagnostic under the cursor. */
function diagnosticChunks(
	diagnostic: Diagnostic,
	width: number,
	theme: EditorTheme,
): StyledText {
	const source = diagnostic.source ? `${diagnostic.source}: ` : "";
	// Servers send multi-line messages; the footer is one row, so newlines become
	// spaces rather than being silently cut at the first break.
	const message = ` ${source}${diagnostic.message.replace(/\s*\n\s*/g, " ")}`;
	const text =
		message.length > width
			? `${message.slice(0, Math.max(0, width - 1))}…`
			: message.padEnd(width, " ");
	return new StyledText([
		chunk(text, severityColour(diagnostic, theme), theme.surface),
	]);
}

/** Start column of the identifier the cursor sits in the middle of. */
function wordStart(line: string, column: number): number {
	let i = Math.min(column, line.length);
	while (i > 0 && /[A-Za-z0-9_$]/.test(line[i - 1] ?? "")) i--;
	return i;
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
	lineDiagnostics: readonly Diagnostic[] | undefined,
	theme: EditorTheme,
): StyledText {
	const visible = text
		.slice(scrollLeft, scrollLeft + viewCols)
		.padEnd(viewCols, " ");
	const sliced = sliceTokens(tokens, scrollLeft, scrollLeft + viewCols);
	const lineBg = isCursorLine ? theme.currentLine : theme.background;

	// One colour per visible column, then collapse equal neighbours into chunks.
	const colors = new Array<string>(visible.length).fill(theme.token.plain);
	for (const token of sliced) {
		const color = theme.token[token.kind];
		for (let i = token.start; i < token.end && i < colors.length; i++)
			colors[i] = color;
	}

	// A parallel underline mask. Diagnostics keep the syntax colour and add an
	// attribute, so an error inside a string still reads as a string.
	const underlined = new Array<boolean>(visible.length).fill(false);
	if (lineDiagnostics) {
		for (const diagnostic of lineDiagnostics) {
			const [from, to] = diagnosticColumns(diagnostic, text.length);
			for (
				let i = Math.max(0, from - scrollLeft);
				i < Math.min(visible.length, to - scrollLeft);
				i++
			) {
				underlined[i] = true;
			}
		}
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
				: chunk(
						visible.slice(runStart, end),
						colors[runStart]!,
						lineBg,
						underlined[runStart] ? TextAttributes.UNDERLINE : 0,
					),
		);
		runStart = end;
	};
	// A run breaks on a colour change, on an underline change, and around the
	// cursor cell, so the cursor always ends up as a chunk of its own.
	for (let i = 1; i <= visible.length; i++) {
		if (
			i === visible.length ||
			colors[i] !== colors[i - 1] ||
			underlined[i] !== underlined[i - 1] ||
			i === cursorIndex ||
			i - 1 === cursorIndex
		) {
			flush(i);
		}
	}
	return new StyledText(chunks);
}

/**
 * Columns a diagnostic covers on one line, clamped to the line.
 *
 * A zero-width range — which servers emit for "expected X here" — is widened to
 * one cell, since an underline of no cells is invisible.
 */
function diagnosticColumns(
	diagnostic: Diagnostic,
	lineLength: number,
): [number, number] {
	const { start, end } = diagnostic.range;
	// The range may begin on an earlier line and end on a later one; on this line
	// it then covers everything.
	const from = start.line === end.line ? start.character : 0;
	const to = start.line === end.line ? end.character : lineLength;
	return [from, Math.max(to, from + 1)];
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
		chunk(
			right.slice(0, width - left.length - gap),
			theme.muted,
			theme.surface,
		),
	]);
}
