/**
 * Running a snippet.
 *
 * A run is a short sequence of processes: optionally compile, then execute. Each
 * step's output is streamed to the caller as it arrives rather than buffered to
 * completion, so a program that prints slowly still fills the output pane
 * progressively and a program that never exits can be killed.
 *
 * A failing compile step aborts the run — executing a stale binary from the
 * previous successful compile would be actively misleading.
 */

import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import type { RunStep } from "../languages/registry";
import type { ScratchFile } from "./scratch";

/** Where a line of output came from. */
export type OutputStream = "stdout" | "stderr" | "system";

/** One chunk of run output, in arrival order. */
export interface OutputChunk {
	readonly stream: OutputStream;
	readonly text: string;
}

/** Why a run stopped. */
export type RunStatus =
	| "success"
	/** A step exited non-zero. `exitCode` and `failedStep` say which. */
	| "failed"
	/** Killed after exceeding the timeout. */
	| "timeout"
	/** Killed by an explicit `cancel()`. */
	| "cancelled"
	/** The step's executable could not be spawned at all. */
	| "spawn-error";

/** How a finished run ended, and how long it took. */
export interface RunResult {
	readonly status: RunStatus;
	/** Exit code of the last step that ran, when there was one. */
	readonly exitCode?: number;
	/** Label of the step that ended the run, e.g. "compile". */
	readonly failedStep?: string;
	/** Wall-clock duration of the whole run, in milliseconds. */
	readonly durationMs: number;
}

/** A run's steps, its scratch location, and where its output goes. */
export interface RunOptions {
	/** Steps to run in order, from a toolchain's `plan()`. */
	readonly steps: readonly RunStep[];
	/** Scratch paths; the run's working directory is `scratch.dir`. */
	readonly scratch: ScratchFile;
	/** Called for every chunk of output, in arrival order. */
	readonly onOutput: (chunk: OutputChunk) => void;
	/** Kill the run after this long. Default 10s; a REPL should feel bounded. */
	readonly timeoutMs?: number;
	/** Text piped to the program's stdin. */
	readonly stdin?: string;
	/** Extra environment for the child processes. */
	readonly env?: Readonly<Record<string, string>>;
}

/** A run in flight. */
export interface RunHandle {
	/** Resolves when the run finishes, whatever the reason. Never rejects. */
	readonly done: Promise<RunResult>;
	/** Kill the current step and abandon the rest. Idempotent. */
	cancel(): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * How long to keep reading output after a killed process has exited. A killed
 * shell's own children may still hold the pipes open, so the drain is bounded
 * rather than awaited to completion.
 */
const DRAIN_GRACE_MS = 100;

/**
 * Start a run. Returns immediately with a handle; the work happens in the
 * background and reports through `onOutput` and `done`.
 */
export function run(options: RunOptions): RunHandle {
	const controller = new AbortController();
	const done = execute(options, controller.signal);
	return {
		done,
		cancel: () => controller.abort(),
	};
}

async function execute(
	options: RunOptions,
	signal: AbortSignal,
): Promise<RunResult> {
	const { steps, scratch, onOutput } = options;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const startedAt = performance.now();
	const elapsed = () => Math.round(performance.now() - startedAt);

	for (const [index, step] of steps.entries()) {
		if (signal.aborted) {
			return {
				status: "cancelled",
				failedStep: step.label,
				durationMs: elapsed(),
			};
		}

		// Only the final step is the user's program, so only it gets their stdin.
		const isLast = index === steps.length - 1;
		const outcome = await runStep(step, {
			cwd: scratch.dir,
			stdin: isLast ? options.stdin : undefined,
			env: options.env,
			timeoutMs,
			signal,
			onOutput,
		});

		if (outcome.kind === "spawn-error") {
			onOutput({
				stream: "system",
				text: `cannot run ${step.command}: ${outcome.message}\n`,
			});
			return {
				status: "spawn-error",
				failedStep: step.label,
				durationMs: elapsed(),
			};
		}
		if (outcome.kind === "cancelled") {
			return {
				status: "cancelled",
				failedStep: step.label,
				durationMs: elapsed(),
			};
		}
		if (outcome.kind === "timeout") {
			onOutput({
				stream: "system",
				text: `${step.label} timed out after ${timeoutMs}ms\n`,
			});
			return {
				status: "timeout",
				failedStep: step.label,
				durationMs: elapsed(),
			};
		}
		// A non-zero compile aborts the run: running the previous build's binary
		// would report success for code that does not compile.
		if (outcome.exitCode !== 0) {
			return {
				status: "failed",
				exitCode: outcome.exitCode,
				failedStep: step.label,
				durationMs: elapsed(),
			};
		}
	}

	return { status: "success", exitCode: 0, durationMs: elapsed() };
}

type StepOutcome =
	| { kind: "exited"; exitCode: number }
	| { kind: "timeout" }
	| { kind: "cancelled" }
	| { kind: "spawn-error"; message: string };

interface StepOptions {
	cwd: string;
	stdin?: string;
	env?: Readonly<Record<string, string>>;
	timeoutMs: number;
	signal: AbortSignal;
	onOutput: (chunk: OutputChunk) => void;
}

async function runStep(
	step: RunStep,
	options: StepOptions,
): Promise<StepOutcome> {
	let timedOut = false;
	let cancelled = false;

	// `detached` makes the child a process-group leader, which is the only way to
	// kill what *it* spawned. Without it, killing `sh` orphans the `sleep` it
	// started, and that orphan keeps our output pipes open indefinitely.
	const proc = spawn(step.command, [...step.args], {
		cwd: options.cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: options.env ? { ...process.env, ...options.env } : process.env,
		detached: process.platform !== "win32",
	});

	// Registered before the first await. An abort that arrives while the spawn is
	// still settling would otherwise be dropped, and the step would run to its
	// timeout instead of stopping.
	const onAbort = () => {
		cancelled = true;
		killTree(proc);
	};
	options.signal.addEventListener("abort", onAbort, { once: true });

	const timer = setTimeout(() => {
		timedOut = true;
		killTree(proc);
	}, options.timeoutMs);

	try {
		const spawnFailure = await new Promise<StepOutcome | null>((resolve) => {
			proc.once("spawn", () => resolve(null));
			proc.once("error", (error: Error) =>
				resolve({ kind: "spawn-error", message: error.message }),
			);
		});
		if (spawnFailure) return spawnFailure;
		// The kill in `onAbort` targeted a process that had not started yet, so it
		// is repeated now that there is something to signal.
		if (cancelled) killTree(proc);

		if (options.stdin === undefined) {
			proc.stdin?.end();
		} else {
			proc.stdin?.end(options.stdin);
		}

		// Both streams are pumped concurrently so a program that writes a lot to
		// stderr cannot block on a full stdout pipe, or vice versa. The pumps are
		// started but not awaited yet — see the drain comment below.
		const drained = Promise.all([
			pump(proc.stdout, "stdout", options.onOutput),
			pump(proc.stderr, "stderr", options.onOutput),
		]);

		const exitCode = await exited(proc);

		// Exit is the authoritative end of a step, not end-of-stream: an orphaned
		// grandchild can hold a pipe open long after the process we care about is
		// gone. So the drain gets a bounded grace period and no more.
		await Promise.race([drained, delay(DRAIN_GRACE_MS)]);

		if (cancelled) return { kind: "cancelled" };
		if (timedOut) return { kind: "timeout" };
		return { kind: "exited", exitCode };
	} finally {
		clearTimeout(timer);
		options.signal.removeEventListener("abort", onAbort);
	}
}

/** Resolve with the child's exit code, mapping a fatal signal to 128+signo. */
function exited(proc: ReturnType<typeof spawn>): Promise<number> {
	return new Promise((resolve) => {
		proc.once("close", (code: number | null, signal: NodeJS.Signals | null) => {
			if (code !== null) return resolve(code);
			// Mirror the shell convention so a signalled exit is still a number.
			resolve(signal ? 128 + (signalNumber(signal) ?? 0) : 1);
		});
	});
}

const SIGNAL_NUMBERS: Readonly<Record<string, number>> = {
	SIGHUP: 1,
	SIGINT: 2,
	SIGQUIT: 3,
	SIGKILL: 9,
	SIGTERM: 15,
};

function signalNumber(signal: NodeJS.Signals): number | undefined {
	return SIGNAL_NUMBERS[signal];
}

/**
 * Forward a child stream to `onOutput` as chunks arrive. Chunk boundaries are
 * left as the OS produced them: the output pane appends text and re-wraps, so it
 * does not need whole lines, and waiting for a newline would stall a program
 * that prints a prompt without one.
 */
async function pump(
	stream: Readable | null,
	kind: OutputStream,
	onOutput: (chunk: OutputChunk) => void,
): Promise<void> {
	if (!stream) return;
	const decoder = new TextDecoder();
	try {
		for await (const chunk of stream) {
			// `stream: true` keeps a multi-byte character split across two reads
			// from being decoded as two replacement characters.
			const text = decoder.decode(chunk as Uint8Array, { stream: true });
			if (text) onOutput({ stream: kind, text });
		}
		const tail = decoder.decode();
		if (tail) onOutput({ stream: kind, text: tail });
	} catch {
		// The process was killed mid-read. The outcome is already decided by the
		// timeout or cancel path that killed it.
	}
}

/**
 * Kill the child and everything it spawned. Detached children are group leaders,
 * so a negative pid reaches the whole group; the plain kill is the Windows and
 * already-exited fallback.
 */
function killTree(proc: ReturnType<typeof spawn>): void {
	const { pid } = proc;
	if (pid !== undefined && process.platform !== "win32") {
		try {
			process.kill(-pid, "SIGKILL");
			return;
		} catch {
			// The group is already gone, or the child never became a leader.
		}
	}
	try {
		proc.kill("SIGKILL");
	} catch {
		// Already exited.
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
