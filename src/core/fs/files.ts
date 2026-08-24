/**
 * Reading and writing editor buffers.
 *
 * The editor holds text, so anything that is not text must be refused *before*
 * it reaches a buffer. Loading a 200 MB binary into an array of lines would
 * freeze the terminal and produce nothing readable, so both size and content are
 * checked up front and the caller gets a typed refusal rather than a crash.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Files larger than this are refused. Well beyond any hand-written source file. */
export const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** How many bytes to inspect when deciding whether a file is binary. */
const SNIFF_BYTES = 4096;

/**
 * The outcome of reading a file: its text, or a typed refusal. Binary and
 * oversized files are ordinary things to click on, not errors.
 */
export type LoadResult =
	| { readonly ok: true; readonly text: string; readonly bytes: number }
	| {
			readonly ok: false;
			readonly reason: "too-large" | "binary" | "unreadable";
			readonly message: string;
	  };

/**
 * Read a file as UTF-8 text.
 *
 * Never rejects. A refusal is a value with a `reason`, so the UI can say "binary
 * file" in the tab instead of showing an error dialog for something the user
 * merely clicked on by accident.
 */
export async function loadFile(path: string): Promise<LoadResult> {
	let bytes: Uint8Array;
	try {
		const file = Bun.file(path);
		const size = file.size;
		if (size > MAX_FILE_BYTES) {
			return {
				ok: false,
				reason: "too-large",
				message: `${formatBytes(size)} exceeds the ${formatBytes(MAX_FILE_BYTES)} limit`,
			};
		}
		bytes = new Uint8Array(await file.arrayBuffer());
	} catch (error) {
		return {
			ok: false,
			reason: "unreadable",
			message: error instanceof Error ? error.message : String(error),
		};
	}

	if (looksBinary(bytes)) {
		return { ok: false, reason: "binary", message: "binary file" };
	}

	// `fatal: false` is deliberate: a file that is *mostly* UTF-8 with a stray
	// bad byte is still worth showing, with replacement characters, rather than
	// refusing outright.
	const text = new TextDecoder("utf-8").decode(bytes);
	return { ok: true, text: stripBom(text), bytes: bytes.length };
}

/** The outcome of a write. A failure lets the caller keep the buffer dirty. */
export type SaveResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly message: string };

/**
 * Write text to a path, creating parent directories as needed. Never rejects;
 * a failure is reported so the editor can keep the buffer dirty instead of
 * pretending the save succeeded.
 */
export async function saveFile(
	path: string,
	text: string,
): Promise<SaveResult> {
	try {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text, "utf8");
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Heuristic binary detection, matching what `git` and `grep` do: a NUL byte in
 * the leading bytes means binary. It is cheap and has no false positives on real
 * source files, which is the trade that matters here.
 */
export function looksBinary(bytes: Uint8Array): boolean {
	const limit = Math.min(bytes.length, SNIFF_BYTES);
	for (let i = 0; i < limit; i++) {
		if (bytes[i] === 0) return true;
	}
	return false;
}

/** A UTF-8 BOM would otherwise show as a stray glyph in column one. */
function stripBom(text: string): string {
	return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * How a file indents itself.
 *
 * The editor works in display cells, so a literal tab cannot survive in the
 * buffer — a column index would stop equalling a screen column. Tabs are
 * therefore expanded on load, which means the indent style has to be recorded
 * and reapplied on save. Without that, opening a tab-indented file and pressing
 * ctrl+s silently rewrites the whole file with spaces.
 */
export interface IndentStyle {
	readonly useTabs: boolean;
	/** Cells one indent level occupies. */
	readonly width: number;
}

/** Style assumed for a buffer with no file behind it. */
export const DEFAULT_INDENT: IndentStyle = { useTabs: false, width: 2 };

/**
 * Infer a file's indent style from its leading whitespace.
 *
 * Tabs win on a tie: a file with any tab-indented lines is a tab-indented file,
 * because reindenting those lines with spaces is the destructive direction.
 */
export function detectIndent(text: string): IndentStyle {
	let tabLines = 0;
	const widths = new Map<number, number>();

	for (const line of text.split("\n")) {
		if (line.startsWith("\t")) {
			tabLines += 1;
			continue;
		}
		const spaces = line.length - line.trimStart().length;
		// A single leading space is usually a continued comment (` * like this`),
		// not an indent level.
		if (spaces >= 2 && line.trim().length > 0) {
			widths.set(spaces, (widths.get(spaces) ?? 0) + 1);
		}
	}

	if (tabLines > 0) return { useTabs: true, width: 4 };

	// The most common leading-space count that divides the others is the unit;
	// approximating it by the smallest frequent width is good enough and cannot
	// corrupt anything, since spaces are written back verbatim.
	let width = 0;
	let best = 0;
	for (const [candidate, count] of widths) {
		if (count > best || (count === best && candidate < width)) {
			best = count;
			width = candidate;
		}
	}
	const unit = width === 0 ? 2 : gcdOfKeys(widths);
	return { useTabs: false, width: unit === 0 ? 2 : Math.min(unit, 8) };
}

function gcdOfKeys(widths: Map<number, number>): number {
	let result = 0;
	for (const width of widths.keys()) result = gcd(result, width);
	return result;
}

function gcd(a: number, b: number): number {
	return b === 0 ? a : gcd(b, a % b);
}

/**
 * Convert a buffer's space indentation back to the file's own style, for saving.
 *
 * Only *leading* whitespace is converted. A tab used mid-line for alignment does
 * not survive the round trip — a known limitation, and much rarer than leading
 * indentation.
 */
export function applyIndentStyle(text: string, style: IndentStyle): string {
	if (!style.useTabs) return text;
	return text
		.split("\n")
		.map((line) => {
			const spaces = line.length - line.trimStart().length;
			if (spaces === 0) return line;
			const levels = Math.floor(spaces / style.width);
			const remainder = spaces % style.width;
			return "\t".repeat(levels) + " ".repeat(remainder) + line.slice(spaces);
		})
		.join("\n");
}

/** Read a whole file for non-buffer uses, e.g. LSP's initial document sync. */
export async function readText(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return null;
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
