import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * The layering rules, enforced.
 *
 * AGENTS.md states them; this makes them fail a build instead of a review.
 * Boundaries stated only in prose erode one convenient import at a time, and the
 * cost is not visible until the day something in `core/` can no longer be tested
 * without a terminal.
 */

const SRC = join(import.meta.dir, "..", "src");

/** Every source file under `dir`, as `{ path, text }`. */
async function sourcesUnder(
	dir: string,
): Promise<{ path: string; text: string }[]> {
	const out: { path: string; text: string }[] = [];
	const walk = async (current: string) => {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const full = join(current, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (/\.tsx?$/.test(entry.name)) {
				out.push({
					path: relative(SRC, full),
					text: await readFile(full, "utf8"),
				});
			}
		}
	};
	await walk(dir);
	return out;
}

const coreFiles = await sourcesUnder(join(SRC, "core"));
const allFiles = await sourcesUnder(SRC);

describe("src/core stays UI-free", () => {
	test("there are core files to check", () => {
		// Guards against the walk silently finding nothing and every rule below
		// passing vacuously.
		expect(coreFiles.length).toBeGreaterThan(5);
	});

	test("nothing under core/ imports @opentui", () => {
		const offenders = coreFiles
			.filter(({ text }) => /from\s+["']@opentui/.test(text))
			.map(({ path }) => path);
		expect(offenders).toEqual([]);
	});

	test("nothing under core/ imports a component", () => {
		const offenders = coreFiles
			.filter(({ text }) => /from\s+["'][^"']*components\//.test(text))
			.map(({ path }) => path);
		expect(offenders).toEqual([]);
	});

	test("nothing under core/ imports app state", () => {
		// Dependencies point downward. `app/` composes `core/`, never the reverse.
		const offenders = coreFiles
			.filter(({ text }) => /from\s+["'][^"']*app\//.test(text))
			.map(({ path }) => path);
		expect(offenders).toEqual([]);
	});

	test("nothing under core/ imports react", () => {
		const offenders = coreFiles
			.filter(({ text }) => /from\s+["']react["']/.test(text))
			.map(({ path }) => path);
		expect(offenders).toEqual([]);
	});
});

describe("theme tokens", () => {
	test("no component hardcodes a hex colour", () => {
		// A hex literal in a component is a colour a theme cannot change.
		const offenders: string[] = [];
		for (const { path, text } of allFiles) {
			if (!path.startsWith("components/") && !path.startsWith("app/")) continue;
			for (const [index, line] of text.split("\n").entries()) {
				if (
					/#[0-9a-fA-F]{3,8}\b/.test(line) &&
					!line.trimStart().startsWith("*")
				) {
					offenders.push(`${path}:${index + 1}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	test("the theme itself defines every token as a hex string", async () => {
		const { darkTheme } = await import("../src/lib/theme");
		const check = (value: unknown, name: string) => {
			expect(typeof value === "string" ? value : "").toMatch(/^#[0-9a-f]{6}$/i);
			expect(name).toBeTruthy();
		};
		for (const [name, value] of Object.entries(darkTheme)) {
			if (name === "token") continue;
			check(value, name);
		}
		for (const [name, value] of Object.entries(darkTheme.token)) {
			check(value, `token.${name}`);
		}
	});
});

describe("documentation stays honest", () => {
	test("every exported symbol in core/ has a doc comment above it", async () => {
		// AGENTS.md promises this. A contract nobody wrote down is a contract
		// nobody can rely on.
		const offenders: string[] = [];
		for (const { path, text } of coreFiles) {
			const lines = text.split("\n");
			for (const [index, line] of lines.entries()) {
				// `async`, `default`, and `abstract` all sit between `export` and the
				// keyword; missing them made the rule silently skip every async
				// export, which is most of `core/fs`.
				if (
					!/^export (default |abstract |async )*(function|class|const|interface|type|enum) /.test(
						line,
					)
				) {
					continue;
				}
				// A re-export is documented where the symbol is defined; repeating
				// the doc at the barrel would just be a copy that drifts.
				if (
					/\bfrom\s+["']/.test(line) ||
					line.trim().endsWith("export type {")
				) {
					continue;
				}
				// Walk back over decorators and blank lines to the nearest comment.
				let above = index - 1;
				while (above >= 0 && lines[above]?.trim() === "") above--;
				const previous = lines[above]?.trim() ?? "";
				const documented =
					previous.endsWith("*/") ||
					previous.startsWith("//") ||
					previous.startsWith("*");
				if (!documented)
					offenders.push(`${path}:${index + 1} ${line.slice(0, 60)}`);
			}
		}
		expect(offenders).toEqual([]);
	});
});
