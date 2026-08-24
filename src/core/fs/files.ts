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
