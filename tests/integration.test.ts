import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type DetectedLanguage,
	detectAll,
	isAvailable,
} from "../src/core/languages/detect";
import { type OutputChunk, ScratchSpace, startRun } from "../src/core/runner";

/**
 * End-to-end: detect what this machine has, then actually compile and run each
 * language's starter template through the real pipeline.
 *
 * These tests are **machine-dependent on purpose**. Unit tests prove the plan is
 * built correctly; only this proves the plan is *right* — that `rustc` really
 * accepts those flags, that Java's single-file mode really tolerates a generated
 * file name, that a compiled binary really lands where the second step looks for
 * it. A registry entry can be perfectly well-formed and still not run.
 *
 * A language that is not installed is skipped, not failed. CI machines differ,
 * and refusing to pass on a machine without Go would make the suite useless.
 */

const languages = await detectAll();
const installed = languages.filter(isAvailable);

const roots: string[] = [];
afterAll(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function scratchSpace(): Promise<ScratchSpace> {
	const root = await mkdtemp(join(tmpdir(), "code-repl-e2e-"));
	roots.push(root);
	return new ScratchSpace(root);
}

/** Run a language's template and return the combined output plus the status. */
async function runTemplate(detected: DetectedLanguage, source?: string) {
	const space = await scratchSpace();
	const chunks: OutputChunk[] = [];

	const handle = await startRun(space, {
		slot: `e2e-${detected.language.id}`,
		detected,
		source: source ?? detected.language.template,
		onOutput: (chunk) => chunks.push(chunk),
		// Compilers are slow, especially on a cold cache.
		timeoutMs: 90_000,
	});
	const result = await handle.done;

	return {
		result,
		stdout: chunks
			.filter((c) => c.stream === "stdout")
			.map((c) => c.text)
			.join(""),
		all: chunks.map((c) => c.text).join(""),
	};
}

describe("detection on this machine", () => {
	test("finds at least one usable toolchain", () => {
		// If this fails, every skip below is meaningless rather than informative.
		expect(installed.length).toBeGreaterThan(0);
	});

	test("reports every registry language, installed or not", () => {
		expect(languages.length).toBeGreaterThan(installed.length);
		for (const detected of languages) {
			expect(detected.language.id).toBeTruthy();
		}
	});

	test("every detected toolchain resolved its binaries to real paths", () => {
		for (const detected of installed) {
			for (const bin of detected.toolchain?.requires ?? []) {
				expect(detected.binaries[bin]).toBeTruthy();
			}
		}
	});
});

describe("running each installed language's template", () => {
	// One test per language in the registry, skipping the absent ones so the
	// report says which languages were actually exercised.
	for (const detected of languages) {
		const { language } = detected;
		const available = isAvailable(detected);

		test.skipIf(!available)(
			`${language.name} runs and prints its greeting`,
			async () => {
				const { result, stdout, all } = await runTemplate(detected);

				// The failure message has to carry the compiler output, or a broken
				// registry entry reports as a bare "expected success, got failed".
				expect(`${result.status} :: ${all}`).toContain("success");
				expect(stdout.toLowerCase()).toContain("hello");
			},
			120_000,
		);
	}
});

describe("failure paths against real toolchains", () => {
	const anInterpreter = installed.find(
		(d) => d.language.id === "python" || d.language.id === "javascript",
	);
	const aCompiler = installed.find(
		(d) =>
			d.language.id === "c" ||
			d.language.id === "rust" ||
			d.language.id === "go",
	);

	test.skipIf(!anInterpreter)(
		"a runtime error is a failed result carrying the message",
		async () => {
			const source =
				anInterpreter?.language.id === "python"
					? 'raise SystemExit("boom")\n'
					: 'throw new Error("boom")\n';
			const { result, all } = await runTemplate(anInterpreter!, source);

			// A crash is output the user asked to read, not an exception.
			expect(result.status).toBe("failed");
			expect(all).toContain("boom");
		},
		60_000,
	);

	test.skipIf(!aCompiler)(
		"a compile error aborts before running anything",
		async () => {
			const { result, all } = await runTemplate(
				aCompiler!,
				"this is not valid source code at all\n",
			);

			expect(result.status).toBe("failed");
			// Compilers report to stderr; something must have been said.
			expect(all.length).toBeGreaterThan(0);
			// For a two-step toolchain the compile step is what failed, and the run
			// step must never have executed a stale binary.
			if (
				(aCompiler!.toolchain?.plan({
					file: "/x/main.c",
					dir: "/x",
					stem: "main",
					binary: "/x/main",
				}).length ?? 1) > 1
			) {
				expect(result.failedStep).toBe("compile");
			}
		},
		60_000,
	);

	test.skipIf(!anInterpreter)(
		"an infinite loop is killed by the timeout",
		async () => {
			const source =
				anInterpreter?.language.id === "python"
					? "while True:\n    pass\n"
					: "while (true) {}\n";
			const space = await scratchSpace();
			const chunks: OutputChunk[] = [];

			const started = performance.now();
			const handle = await startRun(space, {
				slot: "e2e-timeout",
				detected: anInterpreter!,
				source,
				onOutput: (chunk) => chunks.push(chunk),
				timeoutMs: 1_000,
			});
			const result = await handle.done;

			expect(result.status).toBe("timeout");
			// The kill must be prompt, not merely eventual.
			expect(performance.now() - started).toBeLessThan(10_000);
		},
		30_000,
	);

	test.skipIf(!anInterpreter)(
		"stdin reaches the program",
		async () => {
			const source =
				anInterpreter?.language.id === "python"
					? "import sys\nsys.stdout.write(sys.stdin.read().upper())\n"
					: "process.stdout.write(require('fs').readFileSync(0,'utf8').toUpperCase())\n";
			const space = await scratchSpace();
			const chunks: OutputChunk[] = [];

			const handle = await startRun(space, {
				slot: "e2e-stdin",
				detected: anInterpreter!,
				source,
				stdin: "shout\n",
				onOutput: (chunk) => chunks.push(chunk),
				timeoutMs: 30_000,
			});
			await handle.done;

			expect(chunks.map((c) => c.text).join("")).toContain("SHOUT");
		},
		60_000,
	);
});
