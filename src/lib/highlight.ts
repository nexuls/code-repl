/**
 * A small, dependency-free incremental tokenizer used for live highlighting.
 *
 * It scans the whole document in one pass so that multi-line constructs
 * (block comments, template literals) stay correct, then buckets the tokens
 * per line so the editor can render only the lines it can see.
 */

export type TokenKind =
	| "plain"
	| "comment"
	| "string"
	| "template"
	| "regex"
	| "number"
	| "keyword"
	| "control"
	| "literal"
	| "type"
	| "function"
	| "property"
	| "operator"
	| "punctuation";

export interface Token {
	/** Column of the first character, inclusive. */
	start: number;
	/** Column just past the last character. */
	end: number;
	kind: TokenKind;
}

export interface LanguageSpec {
	name: string;
	lineComment?: string;
	blockComment?: [string, string];
	/** Backtick template literals with `${}` interpolation. */
	templates: boolean;
	/** `/regex/` literals in expression position. */
	regex: boolean;
	keywords: Set<string>;
	control: Set<string>;
	literals: Set<string>;
	types: Set<string>;
}

const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

const typescript: LanguageSpec = {
	name: "typescript",
	lineComment: "//",
	blockComment: ["/*", "*/"],
	templates: true,
	regex: true,
	keywords: set(`
		abstract as async await class const declare default delete enum export extends
		from function get implements import in infer instanceof interface is keyof let
		namespace new of override package private protected public readonly require satisfies
		set static super this type typeof var void yield
	`),
	control: set(`
		break case catch continue do else finally for if return switch throw try while with
	`),
	literals: set("true false null undefined NaN Infinity"),
	types: set(`
		any bigint boolean never number object string symbol unknown
		Array Promise Record Map Set Date RegExp Error JSON Math
	`),
};

const python: LanguageSpec = {
	name: "python",
	lineComment: "#",
	templates: false,
	regex: false,
	keywords: set(`
		and as assert async await class def del from global import in is lambda nonlocal
		not or pass with yield self
	`),
	control: set("break continue elif else except finally for if raise return try while"),
	literals: set("True False None"),
	types: set("int float str bool bytes list dict tuple set frozenset object type"),
};

const json: LanguageSpec = {
	name: "json",
	templates: false,
	regex: false,
	keywords: new Set<string>(),
	control: new Set<string>(),
	literals: set("true false null"),
	types: new Set<string>(),
};

export const LANGUAGES: Record<string, LanguageSpec> = {
	typescript,
	tsx: typescript,
	javascript: typescript,
	jsx: typescript,
	ts: typescript,
	js: typescript,
	python,
	py: python,
	json,
};

export function languageFor(name: string): LanguageSpec {
	return LANGUAGES[name.toLowerCase()] ?? typescript;
}

const isIdentStart = (c: string) => /[A-Za-z_$À-￿]/.test(c);
const isIdent = (c: string) => /[A-Za-z0-9_$À-￿]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";
const PUNCTUATION = "{}()[];,.:";
const OPERATORS = "+-*/%=<>!&|^~?";

/** Tokens after which a `/` starts a regex literal rather than a division. */
function regexAllowed(prev: Token | undefined, src: string): boolean {
	if (!prev) return true;
	if (prev.kind === "operator") return true;
	if (prev.kind === "control" || prev.kind === "keyword") return true;
	if (prev.kind === "punctuation") {
		const text = src.slice(prev.start, prev.end);
		return text !== ")" && text !== "]";
	}
	return false;
}

/**
 * Tokenize `source` and return one token array per line. Lines are split on
 * "\n"; a token never spans a line break, so the editor can slice by column.
 */
export function tokenize(source: string, lang: LanguageSpec): Token[][] {
	const lineCount = countLines(source);
	const lines: Token[][] = Array.from({ length: lineCount }, () => []);
	const lineStarts = computeLineStarts(source, lineCount);

	// Emits an absolute [from, to) range, splitting it across line boundaries.
	let lineCursor = 0;
	const emit = (from: number, to: number, kind: TokenKind) => {
		if (to <= from) return;
		while (lineCursor < lineCount - 1 && lineStarts[lineCursor + 1]! <= from) lineCursor++;
		let line = lineCursor;
		let pos = from;
		while (pos < to) {
			const lineEnd = line + 1 < lineCount ? lineStarts[line + 1]! - 1 : source.length;
			const chunkEnd = Math.min(to, lineEnd);
			if (chunkEnd > pos) {
				lines[line]!.push({
					start: pos - lineStarts[line]!,
					end: chunkEnd - lineStarts[line]!,
					kind,
				});
			}
			pos = chunkEnd + 1; // skip the newline itself
			line++;
			if (line >= lineCount) break;
		}
	};

	// `prev` tracks the last significant token, used for regex disambiguation
	// and for the `.property` / `name(` identifier heuristics.
	let prev: Token | undefined;
	const push = (from: number, to: number, kind: TokenKind) => {
		emit(from, to, kind);
		prev = { start: from, end: to, kind };
	};

	const templateStack: number[] = [];
	let braceDepth = 0;
	let inTemplate = false;
	let templateStart = 0;
	let i = 0;
	const n = source.length;

	while (i < n) {
		if (inTemplate) {
			const c = source[i]!;
			if (c === "\\") {
				i += 2;
				continue;
			}
			if (c === "`") {
				push(templateStart, i + 1, "template");
				inTemplate = false;
				i++;
				continue;
			}
			if (c === "$" && source[i + 1] === "{") {
				push(templateStart, i, "template");
				push(i, i + 2, "punctuation");
				templateStack.push(braceDepth);
				inTemplate = false;
				i += 2;
				continue;
			}
			i++;
			if (i >= n) push(templateStart, n, "template");
			continue;
		}

		const c = source[i]!;

		if (c === "\n" || c === " " || c === "\t" || c === "\r") {
			i++;
			continue;
		}

		// Comments
		const line = lang.lineComment;
		if (line && source.startsWith(line, i)) {
			const end = source.indexOf("\n", i);
			push(i, end === -1 ? n : end, "comment");
			i = end === -1 ? n : end;
			continue;
		}
		const block = lang.blockComment;
		if (block && source.startsWith(block[0], i)) {
			const close = source.indexOf(block[1], i + block[0].length);
			const end = close === -1 ? n : close + block[1].length;
			push(i, end, "comment");
			i = end;
			continue;
		}

		// Strings
		if (c === '"' || c === "'") {
			const end = scanQuoted(source, i, c);
			push(i, end, "string");
			i = end;
			continue;
		}

		// Template literals
		if (c === "`" && lang.templates) {
			inTemplate = true;
			templateStart = i;
			i++;
			continue;
		}

		// Regex literals
		if (c === "/" && lang.regex && regexAllowed(prev, source)) {
			const end = scanRegex(source, i);
			if (end !== -1) {
				push(i, end, "regex");
				i = end;
				continue;
			}
		}

		// Numbers
		if (isDigit(c) || (c === "." && isDigit(source[i + 1] ?? ""))) {
			let j = i;
			while (j < n && /[0-9a-fA-FxXoObBn_.eE]/.test(source[j]!)) {
				// Stop before an exponent sign only when it is not part of the number.
				if ((source[j] === "e" || source[j] === "E") && /[+-]/.test(source[j + 1] ?? "")) j++;
				j++;
			}
			push(i, j, "number");
			i = j;
			continue;
		}

		// Identifiers and keywords
		if (isIdentStart(c)) {
			let j = i + 1;
			while (j < n && isIdent(source[j]!)) j++;
			const word = source.slice(i, j);
			let kind: TokenKind = "plain";
			if (lang.control.has(word)) kind = "control";
			else if (lang.keywords.has(word)) kind = "keyword";
			else if (lang.literals.has(word)) kind = "literal";
			else if (lang.types.has(word)) kind = "type";
			else if (prev && prev.kind === "punctuation" && source.slice(prev.start, prev.end) === ".")
				kind = "property";
			else if (nextNonSpace(source, j) === "(") kind = "function";
			else if (/^[A-Z]/.test(word)) kind = "type";
			push(i, j, kind);
			i = j;
			continue;
		}

		// Braces, tracking template interpolation boundaries
		if (c === "{") {
			braceDepth++;
			push(i, i + 1, "punctuation");
			i++;
			continue;
		}
		if (c === "}") {
			if (templateStack.length > 0 && braceDepth === templateStack[templateStack.length - 1]) {
				templateStack.pop();
				push(i, i + 1, "punctuation");
				inTemplate = true;
				templateStart = i + 1;
				i++;
				continue;
			}
			braceDepth = Math.max(0, braceDepth - 1);
			push(i, i + 1, "punctuation");
			i++;
			continue;
		}

		if (PUNCTUATION.includes(c)) {
			push(i, i + 1, "punctuation");
			i++;
			continue;
		}
		if (OPERATORS.includes(c)) {
			let j = i;
			while (j < n && OPERATORS.includes(source[j]!)) j++;
			push(i, j, "operator");
			i = j;
			continue;
		}

		push(i, i + 1, "plain");
		i++;
	}

	if (inTemplate) emit(templateStart, n, "template");
	return lines;
}

function countLines(source: string): number {
	let count = 1;
	for (let i = 0; i < source.length; i++) if (source[i] === "\n") count++;
	return count;
}

function computeLineStarts(source: string, lineCount: number): number[] {
	const starts = new Array<number>(lineCount);
	starts[0] = 0;
	let line = 1;
	for (let i = 0; i < source.length; i++) {
		if (source[i] === "\n") starts[line++] = i + 1;
	}
	return starts;
}

function scanQuoted(source: string, from: number, quote: string): number {
	let i = from + 1;
	while (i < source.length) {
		const c = source[i]!;
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "\n") return i; // unterminated string ends at the line break
		i++;
		if (c === quote) return i;
	}
	return source.length;
}

/** Returns the end offset of a regex literal, or -1 when it is a division. */
function scanRegex(source: string, from: number): number {
	let i = from + 1;
	let inClass = false;
	while (i < source.length) {
		const c = source[i]!;
		if (c === "\\") {
			i += 2;
			continue;
		}
		if (c === "\n") return -1;
		if (c === "[") inClass = true;
		else if (c === "]") inClass = false;
		else if (c === "/" && !inClass) {
			i++;
			while (i < source.length && /[a-z]/.test(source[i]!)) i++;
			return i;
		}
		i++;
	}
	return -1;
}

function nextNonSpace(source: string, from: number): string {
	let i = from;
	while (i < source.length && (source[i] === " " || source[i] === "\t")) i++;
	return source[i] ?? "";
}

/** Restrict tokens to the column window `[from, to)`, rebased to `from`. */
export function sliceTokens(tokens: Token[], from: number, to: number): Token[] {
	const out: Token[] = [];
	for (const token of tokens) {
		if (token.end <= from) continue;
		if (token.start >= to) break;
		out.push({
			start: Math.max(token.start, from) - from,
			end: Math.min(token.end, to) - from,
			kind: token.kind,
		});
	}
	return out;
}
