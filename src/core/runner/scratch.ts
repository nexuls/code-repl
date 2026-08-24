/**
 * The session scratch directory.
 *
 * Every run writes its source to `$TMPDIR/code-repl-<pid>/<tab>/` — never into
 * the folder the user opened. A REPL that drops `main.tmp.go` into someone's
 * repository, or overwrites a real file whose name collides, is a tool people
 * stop trusting.
 *
 * The directory is created lazily on first run and removed on exit, so a session
 * that never runs anything leaves nothing behind.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Language } from "../languages/registry";

/** A source file written to scratch, plus the paths a run plan needs. */
export interface ScratchFile {
	/** Absolute path of the written source file. */
	readonly file: string;
	/** Absolute path of the directory containing it. */
	readonly dir: string;
	/** Source file name without its extension. */
	readonly stem: string;
	/** Absolute path a compiler should write its executable to. */
	readonly binary: string;
}

/** Windows needs the extension or the compiled binary will not execute. */
const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";

/**
 * Some languages constrain the entry file's name. Java's single-file mode is
 * relaxed about it, but a `public class Main` still reads better next to
 * `Main.java`, and Go requires a `.go` file in a package directory.
 */
const STEM_OVERRIDES: Readonly<Record<string, string>> = {
	java: "Main",
};

/**
 * The process's scratch tree.
 *
 * Created lazily on first write and removed by `dispose()`, so a session that
 * never runs anything leaves nothing behind.
 */
export class ScratchSpace {
	/** Root for this process. The pid keeps concurrent sessions from colliding. */
	readonly root: string;
	private created = false;

	constructor(root = join(tmpdir(), `code-repl-${process.pid}`)) {
		this.root = root;
	}

	/**
	 * Write `source` into a per-slot subdirectory and return the paths a run plan
	 * needs. `slot` is normally a tab id: reusing it overwrites the previous
	 * source rather than accumulating files across runs.
	 */
	async write(
		slot: string,
		language: Language,
		source: string,
	): Promise<ScratchFile> {
		const dir = join(this.root, sanitiseSlot(slot));
		await mkdir(dir, { recursive: true });
		this.created = true;

		const stem = STEM_OVERRIDES[language.id] ?? "main";
		const file = join(dir, `${stem}.${language.extension}`);
		await writeFile(file, source, "utf8");

		return { file, dir, stem, binary: join(dir, `${stem}${EXE_SUFFIX}`) };
	}

	/**
	 * Remove the whole scratch tree. Safe to call more than once and when nothing
	 * was ever written; failures are swallowed because this runs on the exit path
	 * where there is no longer a UI to report them to.
	 */
	async dispose(): Promise<void> {
		if (!this.created) return;
		this.created = false;
		try {
			await rm(this.root, { recursive: true, force: true });
		} catch {
			// A locked file on Windows, or a tmpdir already reaped. Losing a scratch
			// directory is not worth failing an exit over.
		}
	}
}

/**
 * Reduce a slot name to something safe as a single path segment. Tab ids are
 * generated, but a user-supplied name must not be able to escape the root with
 * `../`.
 */
function sanitiseSlot(slot: string): string {
	const safe = slot.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
	return safe.length > 0 ? safe : "default";
}
