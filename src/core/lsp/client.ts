/**
 * A minimal LSP client over a child process's stdio.
 *
 * Owns request/response correlation, notification dispatch, and the process
 * lifecycle. Deliberately knows nothing about editors or buffers — that mapping
 * is `./manager.ts`.
 *
 * Every request is timed out. A language server that stops answering must
 * degrade the feature, not hang the editor, so a lost response resolves as an
 * error rather than a promise nobody settles.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { encodeMessage, MessageDecoder } from "./framing";

/** Default per-request timeout. Completion feels broken well before this. */
const REQUEST_TIMEOUT_MS = 5_000;

/** How long to wait for a graceful `shutdown`/`exit` before killing. */
const SHUTDOWN_TIMEOUT_MS = 1_000;

export interface LspClientOptions {
	readonly command: string;
	readonly args: readonly string[];
	/** Working directory, normally the opened workspace root. */
	readonly cwd: string;
	/** Handler for server-initiated notifications. */
	readonly onNotification?: (method: string, params: unknown) => void;
	/** Anything the server writes to stderr; useful only for diagnosing setup. */
	readonly onStderr?: (text: string) => void;
	/** Called once when the server process ends, expectedly or not. */
	readonly onExit?: (code: number | null) => void;
	readonly requestTimeoutMs?: number;
}

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

export class LspClient {
	private readonly proc: ChildProcess;
	private readonly decoder = new MessageDecoder();
	private readonly pending = new Map<number, Pending>();
	private readonly requestTimeoutMs: number;
	private nextId = 1;
	private disposed = false;

	constructor(private readonly options: LspClientOptions) {
		this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
		this.proc = spawn(options.command, [...options.args], {
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});

		this.proc.stdout?.on("data", (chunk: Uint8Array) => {
			for (const message of this.decoder.push(chunk)) this.dispatch(message);
		});
		this.proc.stderr?.on("data", (chunk: Uint8Array) => {
			options.onStderr?.(new TextDecoder().decode(chunk));
		});
		// A server that dies mid-session would otherwise leave every in-flight
		// request unsettled, and the editor waiting on them forever.
		this.proc.once("exit", (code) => {
			this.failAllPending(new Error("language server exited"));
			options.onExit?.(code);
		});
		this.proc.once("error", (error: Error) => {
			this.failAllPending(error);
			options.onExit?.(null);
		});
	}

	/** True until `dispose()` or the server process ends. */
	get alive(): boolean {
		return !this.disposed && this.proc.exitCode === null;
	}

	/**
	 * Send a request and await its result.
	 *
	 * Rejects on a server-reported error, on timeout, and if the server dies —
	 * never hangs.
	 */
	request<T = unknown>(method: string, params?: unknown): Promise<T> {
		if (this.disposed) {
			return Promise.reject(new Error("client disposed"));
		}
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(
					new Error(`${method} timed out after ${this.requestTimeoutMs}ms`),
				);
			}, this.requestTimeoutMs);

			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			});
			this.write({ jsonrpc: "2.0", id, method, params });
		});
	}

	/** Send a notification. Fire-and-forget by definition. */
	notify(method: string, params?: unknown): void {
		if (this.disposed) return;
		this.write({ jsonrpc: "2.0", method, params });
	}

	/**
	 * Shut the server down: the spec's `shutdown` then `exit` handshake, with a
	 * kill if it does not oblige. Idempotent.
	 */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;

		try {
			// A short timeout of its own: a wedged server must not delay app exit.
			await Promise.race([
				this.requestRaw("shutdown"),
				delay(SHUTDOWN_TIMEOUT_MS),
			]);
			this.write({ jsonrpc: "2.0", method: "exit" });
		} catch {
			// Already gone, or never answered. Either way it gets killed below.
		}

		this.failAllPending(new Error("client disposed"));
		await Promise.race([once(this.proc, "exit"), delay(SHUTDOWN_TIMEOUT_MS)]);
		try {
			this.proc.kill("SIGKILL");
		} catch {
			// Already exited.
		}
	}

	/** `request()` minus the disposed guard, so `dispose()` can use it. */
	private requestRaw(method: string, params?: unknown): Promise<unknown> {
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out`));
			}, SHUTDOWN_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timer });
			this.write({ jsonrpc: "2.0", id, method, params });
		});
	}

	private write(message: unknown): void {
		try {
			this.proc.stdin?.write(encodeMessage(message));
		} catch {
			// The pipe closed under us; the exit handler settles the requests.
		}
	}

	private dispatch(message: unknown): void {
		if (typeof message !== "object" || message === null) return;
		const record = message as Record<string, unknown>;

		// A response carries an id we issued.
		if ("id" in record && ("result" in record || "error" in record)) {
			const pending = this.pending.get(record.id as number);
			if (!pending) return; // Already timed out; the result is stale.
			this.pending.delete(record.id as number);
			clearTimeout(pending.timer);

			if ("error" in record && record.error) {
				const error = record.error as { message?: string; code?: number };
				pending.reject(
					new Error(error.message ?? `server error ${error.code ?? "?"}`),
				);
			} else {
				pending.resolve(record.result);
			}
			return;
		}

		// A request *from* the server. We advertise no capabilities that need a
		// real answer, but the spec requires a reply or the server may stall, so
		// unknown methods get a null result.
		if ("id" in record && "method" in record) {
			this.write({ jsonrpc: "2.0", id: record.id, result: null });
			return;
		}

		if ("method" in record) {
			this.options.onNotification?.(record.method as string, record.params);
		}
	}

	private failAllPending(error: Error): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function once(proc: ChildProcess, event: string): Promise<void> {
	return new Promise((resolve) => proc.once(event, () => resolve()));
}
