import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { languageById } from "../src/core/languages/registry";
import {
	describeResult,
	NoToolchainError,
	type OutputChunk,
	startRun,
} from "../src/core/runner";
import { run } from "../src/core/runner/execute";
import { ScratchSpace } from "../src/core/runner/scratch";

/** Collect every chunk a run emits, and the concatenated text per stream. */
function collector() {
	const chunks: OutputChunk[] = [];
	const onOutput = (chunk: OutputChunk) => chunks.push(chunk);
	const text = (stream: OutputChunk["stream"]) =>
		chunks
			.filter((c) => c.stream === stream)
			.map((c) => c.text)
			.join("");
	return { chunks, onOutput, text };
}

const spaces: ScratchSpace[] = [];

/** A scratch space rooted in its own temp dir, cleaned up after each test. */
async function scratchSpace(): Promise<ScratchSpace> {
	const root = await mkdtemp(join(tmpdir(), "code-repl-test-"));
	const space = new ScratchSpace(root);
	spaces.push(space);
	return space;
}

afterEach(async () => {
	await Promise.all(spaces.splice(0).map((space) => space.dispose()));
});

describe("ScratchSpace", () => {
	test("writes a source file with the language's extension", async () => {
		const space = await scratchSpace();
		const python = languageById("python")!;
		const scratch = await space.write("tab-1", python, "print(1)\n");

		expect(scratch.file.endsWith("main.py")).toBe(true);
		expect(scratch.stem).toBe("main");
		expect(await Bun.file(scratch.file).text()).toBe("print(1)\n");
	});

	test("honours a language's required entry-file name", async () => {
		const space = await scratchSpace();
		const java = languageById("java")!;
		const scratch = await space.write("tab-1", java, "");
		expect(scratch.file.endsWith("Main.java")).toBe(true);
		expect(scratch.stem).toBe("Main");
	});

	test("reusing a slot overwrites rather than accumulating", async () => {
		const space = await scratchSpace();
		const python = languageById("python")!;
		const first = await space.write("tab-1", python, "print(1)\n");
		const second = await space.write("tab-1", python, "print(2)\n");

		expect(second.file).toBe(first.file);
		expect(await Bun.file(first.file).text()).toBe("print(2)\n");
	});

	test("separate slots get separate directories", async () => {
		const space = await scratchSpace();
		const python = languageById("python")!;
		const a = await space.write("tab-1", python, "");
		const b = await space.write("tab-2", python, "");
		expect(a.dir).not.toBe(b.dir);
	});

	test("a slot name cannot escape the scratch root", async () => {
		const space = await scratchSpace();
		const python = languageById("python")!;
		const scratch = await space.write("../../etc/evil", python, "");
		expect(scratch.dir.startsWith(space.root)).toBe(true);
		expect(scratch.dir).not.toContain("..");
	});

	test("dispose removes the tree and is safe to repeat", async () => {
		const space = await scratchSpace();
		const python = languageById("python")!;
		const scratch = await space.write("tab-1", python, "print(1)\n");
		expect(existsSync(scratch.file)).toBe(true);

		await space.dispose();
		expect(existsSync(space.root)).toBe(false);
		await space.dispose();
	});
});

describe("run", () => {
	/** Steps run in a real temp dir; `sh` is the one interpreter we can assume. */
	async function shellSteps(script: string, label = "run") {
		const space = await scratchSpace();
		const bash = languageById("bash")!;
		const scratch = await space.write("t", bash, script);
		return { scratch, steps: [{ label, command: "sh", args: [scratch.file] }] };
	}

	test("streams stdout and reports success", async () => {
		const { scratch, steps } = await shellSteps("echo hello\necho world\n");
		const sink = collector();
		const result = await run({ steps, scratch, onOutput: sink.onOutput }).done;

		expect(result.status).toBe("success");
		expect(result.exitCode).toBe(0);
		expect(sink.text("stdout")).toBe("hello\nworld\n");
	});

	test("keeps stdout and stderr distinguishable", async () => {
		const { scratch, steps } = await shellSteps("echo out\necho err >&2\n");
		const sink = collector();
		await run({ steps, scratch, onOutput: sink.onOutput }).done;

		expect(sink.text("stdout")).toContain("out");
		expect(sink.text("stderr")).toContain("err");
	});

	test("reports a non-zero exit as failed, with the step label", async () => {
		const { scratch, steps } = await shellSteps("exit 3\n", "run");
		const sink = collector();
		const result = await run({ steps, scratch, onOutput: sink.onOutput }).done;

		expect(result.status).toBe("failed");
		expect(result.exitCode).toBe(3);
		expect(result.failedStep).toBe("run");
	});

	test("a failing first step aborts the run", async () => {
		const space = await scratchSpace();
		const bash = languageById("bash")!;
		const scratch = await space.write("t", bash, "echo should-not-run\n");
		const sink = collector();

		const result = await run({
			steps: [
				{
					label: "compile",
					command: "sh",
					args: ["-c", "echo boom >&2; exit 1"],
				},
				{ label: "run", command: "sh", args: [scratch.file] },
			],
			scratch,
			onOutput: sink.onOutput,
		}).done;

		expect(result.status).toBe("failed");
		expect(result.failedStep).toBe("compile");
		// The second step must never have produced output.
		expect(sink.text("stdout")).not.toContain("should-not-run");
	});

	test("pipes stdin to the final step only", async () => {
		const { scratch, steps } = await shellSteps("cat\n");
		const sink = collector();
		const result = await run({
			steps,
			scratch,
			stdin: "fed in\n",
			onOutput: sink.onOutput,
		}).done;

		expect(result.status).toBe("success");
		expect(sink.text("stdout")).toBe("fed in\n");
	});

	test("kills a program that exceeds the timeout", async () => {
		const { scratch, steps } = await shellSteps("sleep 30\n");
		const sink = collector();
		const result = await run({
			steps,
			scratch,
			timeoutMs: 150,
			onOutput: sink.onOutput,
		}).done;

		expect(result.status).toBe("timeout");
		expect(sink.text("system")).toContain("timed out");
	});

	test("cancel stops a running program", async () => {
		const { scratch, steps } = await shellSteps("sleep 30\n");
		const sink = collector();
		const handle = run({
			steps,
			scratch,
			onOutput: sink.onOutput,
			timeoutMs: 5_000,
		});
		handle.cancel();

		const result = await handle.done;
		expect(result.status).toBe("cancelled");
	});

	test("a killed step does not wait on its orphaned children's pipes", async () => {
		// The regression this guards: killing `sh` leaves the `sleep` it spawned
		// holding stdout open, so waiting for end-of-stream never returns. Exit,
		// not end-of-stream, must decide when a step is over.
		const { scratch, steps } = await shellSteps("sleep 30 & sleep 30\n");
		const startedAt = performance.now();
		const result = await run({
			steps,
			scratch,
			timeoutMs: 150,
			onOutput: () => {},
		}).done;

		expect(result.status).toBe("timeout");
		expect(performance.now() - startedAt).toBeLessThan(2_000);
	});

	test("reports a missing executable instead of throwing", async () => {
		const { scratch } = await shellSteps("");
		const sink = collector();
		const result = await run({
			steps: [
				{
					label: "run",
					command: "code-repl-definitely-not-a-binary",
					args: [],
				},
			],
			scratch,
			onOutput: sink.onOutput,
		}).done;

		expect(result.status).toBe("spawn-error");
		expect(sink.text("system")).toContain("cannot run");
	});

	test("runs in the scratch directory", async () => {
		const { scratch, steps } = await shellSteps("pwd\n");
		const sink = collector();
		await run({ steps, scratch, onOutput: sink.onOutput }).done;
		expect(sink.text("stdout").trim()).toContain(scratch.dir.split("/").pop()!);
	});

	test("measures wall time", async () => {
		const { scratch, steps } = await shellSteps("echo x\n");
		const result = await run({ steps, scratch, onOutput: () => {} }).done;
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});
});

describe("startRun", () => {
	test("refuses a language with no installed toolchain", async () => {
		const space = await scratchSpace();
		const rust = languageById("rust")!;

		await expect(
			startRun(space, {
				slot: "t",
				detected: { language: rust, binaries: {} },
				source: "fn main() {}",
				onOutput: () => {},
			}),
		).rejects.toBeInstanceOf(NoToolchainError);
	});

	test("writes the source and runs the toolchain's plan", async () => {
		const space = await scratchSpace();
		const bash = languageById("bash")!;
		const sink = collector();

		const handle = await startRun(space, {
			slot: "tab-1",
			detected: {
				language: bash,
				toolchain: bash.toolchains.find((t) => t.id === "sh")!,
				binaries: { sh: "sh" },
			},
			source: 'echo "from a plan"\n',
			onOutput: sink.onOutput,
		});

		const result = await handle.done;
		expect(result.status).toBe("success");
		expect(sink.text("stdout")).toContain("from a plan");
	});
});

describe("describeResult", () => {
	test("summarises each outcome", () => {
		expect(describeResult({ status: "success", durationMs: 12 })).toBe(
			"ok · 12ms",
		);
		expect(
			describeResult({
				status: "failed",
				exitCode: 2,
				failedStep: "compile",
				durationMs: 40,
			}),
		).toBe("compile exited 2 · 40ms");
		expect(describeResult({ status: "timeout", durationMs: 10_000 })).toContain(
			"timed out",
		);
		expect(describeResult({ status: "cancelled", durationMs: 5 })).toContain(
			"cancelled",
		);
		expect(
			describeResult({
				status: "spawn-error",
				failedStep: "run",
				durationMs: 1,
			}),
		).toContain("could not start run");
	});
});
