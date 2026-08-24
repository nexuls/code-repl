/**
 * The run pipeline: turn a buffer's text into a finished process run.
 *
 * This module is the seam the UI talks to. It knows how to go from "this tab
 * holds this Python source" to "here is streamed output and an exit status",
 * and it refuses clearly when the machine cannot run that language.
 */

import type { DetectedLanguage } from "../languages/detect";
import type { OutputChunk, RunHandle, RunResult } from "./execute";
import { run } from "./execute";
import type { ScratchSpace } from "./scratch";

export type {
	OutputChunk,
	OutputStream,
	RunHandle,
	RunResult,
	RunStatus,
} from "./execute";
export type { ScratchFile } from "./scratch";
export { ScratchSpace } from "./scratch";

/** Everything needed to write a buffer to scratch and run it. */
export interface RunRequest {
	/** Stable id for the buffer, used as the scratch slot. */
	readonly slot: string;
	/** Detection result for the buffer's language. */
	readonly detected: DetectedLanguage;
	readonly source: string;
	readonly onOutput: (chunk: OutputChunk) => void;
	readonly timeoutMs?: number;
	readonly stdin?: string;
}

/**
 * Write the source to scratch and start running it.
 *
 * Rejects only when the language has no installed toolchain — every other
 * failure (compile error, crash, timeout) is a resolved `RunResult`, because
 * those are results the user wants to read, not exceptions.
 */
export async function startRun(
	scratchSpace: ScratchSpace,
	request: RunRequest,
): Promise<RunHandle> {
	const { detected } = request;
	const { toolchain, language } = detected;
	if (!toolchain) {
		throw new NoToolchainError(language.name);
	}

	const scratch = await scratchSpace.write(
		request.slot,
		language,
		request.source,
	);
	const steps = toolchain.plan(scratch);

	return run({
		steps,
		scratch,
		onOutput: request.onOutput,
		timeoutMs: request.timeoutMs,
		stdin: request.stdin,
	});
}

/** Thrown when a run is requested for a language nothing on this machine can run. */
export class NoToolchainError extends Error {
	constructor(languageName: string) {
		super(`no installed toolchain for ${languageName}`);
		this.name = "NoToolchainError";
	}
}

/** A short, human summary of a finished run, for the status bar. */
export function describeResult(result: RunResult): string {
	const ms = `${result.durationMs}ms`;
	switch (result.status) {
		case "success":
			return `ok · ${ms}`;
		case "failed":
			return `${result.failedStep} exited ${result.exitCode} · ${ms}`;
		case "timeout":
			return `timed out · ${ms}`;
		case "cancelled":
			return `cancelled · ${ms}`;
		case "spawn-error":
			return `could not start ${result.failedStep} · ${ms}`;
	}
}
