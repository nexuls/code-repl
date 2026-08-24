/**
 * The slice of the Language Server Protocol code-repl actually consumes.
 *
 * Hand-written rather than pulled from `vscode-languageserver-types` so that
 * `core/` stays dependency-free, and so the shapes are visibly limited to what
 * the UI can render. Anything a server sends beyond these fields is ignored.
 *
 * Spec: https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/
 */

/** Zero-based line, and a UTF-16 code-unit offset within it. */
export interface Position {
	line: number;
	character: number;
}

/** A half-open span of a document, `start` inclusive and `end` exclusive. */
export interface Range {
	start: Position;
	end: Position;
}

/** LSP severity numbers, in the spec's order. */
export enum DiagnosticSeverity {
	Error = 1,
	Warning = 2,
	Information = 3,
	Hint = 4,
}

/** One problem the server found, anchored to a range of the document. */
export interface Diagnostic {
	range: Range;
	/** Absent means the server left severity to the client; treat as Error. */
	severity?: DiagnosticSeverity;
	message: string;
	/** The producing tool, e.g. "ts" or "ruff". */
	source?: string;
	code?: string | number;
}

/** LSP completion kinds. Mapped to a single-character sigil for display. */
export enum CompletionItemKind {
	Text = 1,
	Method = 2,
	Function = 3,
	Constructor = 4,
	Field = 5,
	Variable = 6,
	Class = 7,
	Interface = 8,
	Module = 9,
	Property = 10,
	Unit = 11,
	Value = 12,
	Enum = 13,
	Keyword = 14,
	Snippet = 15,
	Color = 16,
	File = 17,
	Reference = 18,
	Folder = 19,
	EnumMember = 20,
	Constant = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25,
}

/**
 * A replacement of an exact range.
 *
 * The **range is authoritative**: servers routinely return an edit spanning
 * more than the word being completed — tsserver's member edits cover the
 * preceding dot — with that text reinstated in `newText`. Applying `newText`
 * anywhere but its own range duplicates whatever the range covered.
 */
export interface TextEdit {
	range: Range;
	newText: string;
}

/** One suggestion. Only the fields code-repl can act on are modelled. */
export interface CompletionItem {
	label: string;
	kind?: CompletionItemKind;
	/** Type signature or similar, shown to the right of the label. */
	detail?: string;
	documentation?: string | { kind: string; value: string };
	/** Text to insert; falls back to `label`. */
	insertText?: string;
	/** Preferred over `insertText`: it also says what range to replace. */
	textEdit?: TextEdit;
	/** Overrides `label` for filtering, e.g. when the label is decorated. */
	filterText?: string;
	/** Overrides `label` for ordering. Servers rely on this heavily. */
	sortText?: string;
	/** Marks the item the server would pick by default. */
	preselect?: boolean;
}

/**
 * A completion response. Servers may return this *or* a bare `CompletionItem[]`
 * — both are in the spec, so both must be handled.
 */
export interface CompletionList {
	isIncomplete: boolean;
	items: CompletionItem[];
}

/** Text with a declared format, used by hover and documentation fields. */
export interface MarkupContent {
	kind: "plaintext" | "markdown";
	value: string;
}

/** Hover information. `contents` has three legal shapes; see `hoverText`. */
export interface Hover {
	contents: string | MarkupContent | (string | MarkupContent)[];
	range?: Range;
}

/** A range within a specific document. */
export interface Location {
	uri: string;
	range: Range;
}

/** A `textDocument/publishDiagnostics` notification payload. */
export interface PublishDiagnosticsParams {
	uri: string;
	version?: number;
	diagnostics: Diagnostic[];
}

/** How a server wants document changes delivered. */
export enum TextDocumentSyncKind {
	None = 0,
	Full = 1,
	Incremental = 2,
}

/** Convert an absolute path to the `file://` URI servers expect. */
export function pathToUri(path: string): string {
	// Each segment is encoded separately so that separators survive, and `:` is
	// restored because a Windows drive letter must stay `c:` in the URI.
	const encoded = path
		.split("/")
		.map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ":"))
		.join("/");
	return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

/** Convert a `file://` URI back to an absolute path. Non-file URIs pass through. */
export function uriToPath(uri: string): string {
	if (!uri.startsWith("file://")) return uri;
	return decodeURIComponent(uri.slice("file://".length));
}

/** Single-character sigil for a completion kind, for the popup's left column. */
export function completionSigil(kind: CompletionItemKind | undefined): string {
	switch (kind) {
		case CompletionItemKind.Method:
		case CompletionItemKind.Function:
		case CompletionItemKind.Constructor:
			return "ƒ";
		case CompletionItemKind.Field:
		case CompletionItemKind.Property:
			return "•";
		case CompletionItemKind.Variable:
		case CompletionItemKind.Constant:
			return "=";
		case CompletionItemKind.Class:
		case CompletionItemKind.Struct:
			return "◇";
		case CompletionItemKind.Interface:
		case CompletionItemKind.TypeParameter:
			return "◈";
		case CompletionItemKind.Module:
			return "▪";
		case CompletionItemKind.Enum:
		case CompletionItemKind.EnumMember:
			return "∈";
		case CompletionItemKind.Keyword:
			return "◆";
		case CompletionItemKind.Snippet:
			return "▸";
		case CompletionItemKind.File:
			return "▤";
		case CompletionItemKind.Folder:
			return "▣";
		default:
			return "·";
	}
}

/** Flatten hover contents — string, markup, or an array — into plain text. */
export function hoverText(hover: Hover): string {
	const parts = Array.isArray(hover.contents)
		? hover.contents
		: [hover.contents];
	return parts
		.map((part) => (typeof part === "string" ? part : part.value))
		.join("\n")
		.trim();
}
