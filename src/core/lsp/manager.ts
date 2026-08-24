/**
 * Language-server lifecycle and the editor-facing API.
 *
 * One server per language, started lazily the first time a buffer in that
 * language is opened, and shut down with the app. Translates editor events into
 * LSP notifications and editor questions into typed answers.
 *
 * **Every feature degrades to nothing.** No server installed, a server that
 * crashed, a request that timed out: completion returns `[]`, hover returns
 * `null`, diagnostics stay empty. The editor must stay usable on a machine with
 * no language servers at all, which is the common case.
 */

import { LspClient } from "./client";
import type {
	CompletionItem,
	CompletionList,
	Diagnostic,
	Hover,
	Position,
	PublishDiagnosticsParams,
} from "./protocol";
import { pathToUri, uriToPath } from "./protocol";
import { protocolLanguageId, type ServerSpec, serversFor } from "./servers";

/** A document the manager is tracking on the server's behalf. */
interface TrackedDocument {
	readonly uri: string;
	readonly languageId: string;
	/** LSP document version, incremented on every change notification. */
	version: number;
}

/** One running server plus the documents synced to it. */
interface Session {
	readonly spec: ServerSpec;
	readonly client: LspClient;
	readonly documents: Map<string, TrackedDocument>;
	/** Resolves once `initialize`/`initialized` have completed. */
	readonly ready: Promise<void>;
}

export interface LspManagerOptions {
	/** Workspace root sent as the server's rootUri. */
	readonly root: string;
	/** Called whenever a server publishes diagnostics for a path. */
	readonly onDiagnostics?: (path: string, diagnostics: Diagnostic[]) => void;
	/** Called when a server fails to start or dies, for the status bar. */
	readonly onServerEvent?: (event: ServerEvent) => void;
	/** Resolve an executable to a path, or null. Injectable for tests. */
	readonly which?: (command: string) => Promise<string | null>;
}

export interface ServerEvent {
	readonly languageId: string;
	readonly serverId: string;
	readonly state: "starting" | "ready" | "failed" | "exited";
	readonly message?: string;
}

export class LspManager {
	/** Keyed by our language id, not by server id: one server per language. */
	private readonly sessions = new Map<string, Session>();
	/** Languages already found to have no installed server, so we stop probing. */
	private readonly unavailable = new Set<string>();
	private disposed = false;

	constructor(private readonly options: LspManagerOptions) {}

	/**
	 * Tell the manager a buffer is open. Starts the language's server if needed.
	 *
	 * Safe to call for a language with no server: it records the absence and
	 * returns without doing anything on later calls.
	 */
	async openDocument(
		path: string,
		languageId: string,
		text: string,
	): Promise<void> {
		const session = await this.sessionFor(languageId);
		if (!session) return;

		const uri = pathToUri(path);
		if (session.documents.has(uri)) {
			// Already open — treat this as a full resync rather than a duplicate
			// didOpen, which some servers reject outright.
			this.changeDocument(path, languageId, text);
			return;
		}

		const document: TrackedDocument = {
			uri,
			languageId: protocolLanguageId(session.spec, languageId),
			version: 1,
		};
		session.documents.set(uri, document);
		session.client.notify("textDocument/didOpen", {
			textDocument: {
				uri,
				languageId: document.languageId,
				version: document.version,
				text,
			},
		});
	}

	/**
	 * Report a buffer's new contents. Full-text sync: incremental sync would need
	 * the editor to track edit ranges, and for scratch-sized files the whole text
	 * is cheaper than the bookkeeping.
	 */
	changeDocument(path: string, languageId: string, text: string): void {
		const session = this.sessions.get(languageId);
		const uri = pathToUri(path);
		const document = session?.documents.get(uri);
		if (!session || !document) return;

		document.version += 1;
		session.client.notify("textDocument/didChange", {
			textDocument: { uri, version: document.version },
			contentChanges: [{ text }],
		});
	}

	/** Report that a buffer closed, so the server can drop its state. */
	closeDocument(path: string, languageId: string): void {
		const session = this.sessions.get(languageId);
		const uri = pathToUri(path);
		if (!session?.documents.delete(uri)) return;
		session.client.notify("textDocument/didClose", { textDocument: { uri } });
	}

	/**
	 * Completion items at a position, already sorted the way the server wants.
	 * Returns `[]` for any failure — the popup simply does not appear.
	 */
	async completion(
		path: string,
		languageId: string,
		position: Position,
	): Promise<CompletionItem[]> {
		const result = await this.ask<CompletionList | CompletionItem[] | null>(
			languageId,
			"textDocument/completion",
			{
				textDocument: { uri: pathToUri(path) },
				position,
			},
		);
		if (!result) return [];
		// The response is either a bare array or a CompletionList, depending on
		// the server. Both shapes are in the spec.
		const items = Array.isArray(result) ? result : result.items;
		return items.slice().sort(byServerOrder);
	}

	/** Hover information at a position, or `null`. */
	async hover(
		path: string,
		languageId: string,
		position: Position,
	): Promise<Hover | null> {
		return (
			(await this.ask<Hover | null>(languageId, "textDocument/hover", {
				textDocument: { uri: pathToUri(path) },
				position,
			})) ?? null
		);
	}

	/** Shut every server down. Idempotent. */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.all(sessions.map((session) => session.client.dispose()));
	}

	/** Ids of the servers currently running, for the status bar. */
	runningServers(): { languageId: string; serverId: string }[] {
		return [...this.sessions.entries()].map(([languageId, session]) => ({
			languageId,
			serverId: session.spec.id,
		}));
	}

	/** Issue a request, swallowing every failure into `null`. */
	private async ask<T>(
		languageId: string,
		method: string,
		params: unknown,
	): Promise<T | null> {
		const session = this.sessions.get(languageId);
		if (!session?.client.alive) return null;
		try {
			await session.ready;
			return await session.client.request<T>(method, params);
		} catch {
			// Timed out, server error, or the server died. The caller's feature is
			// simply unavailable this time.
			return null;
		}
	}

	/**
	 * Get or start the session for a language. Returns `undefined` when no
	 * candidate server is installed, and remembers that so the next call is free.
	 */
	private async sessionFor(languageId: string): Promise<Session | undefined> {
		if (this.disposed) return undefined;

		const existing = this.sessions.get(languageId);
		if (existing) {
			if (existing.client.alive) return existing;
			// The server died; drop it so a fresh one can be started below.
			this.sessions.delete(languageId);
		}
		if (this.unavailable.has(languageId)) return undefined;

		const which = this.options.which ?? ((cmd: string) => Bun.which(cmd));
		for (const spec of serversFor(languageId)) {
			if (!(await which(spec.command))) continue;
			const session = this.start(languageId, spec);
			this.sessions.set(languageId, session);
			return session;
		}

		this.unavailable.add(languageId);
		this.options.onServerEvent?.({
			languageId,
			serverId: "none",
			state: "failed",
			message: "no language server installed",
		});
		return undefined;
	}

	private start(languageId: string, spec: ServerSpec): Session {
		this.options.onServerEvent?.({
			languageId,
			serverId: spec.id,
			state: "starting",
		});

		const documents = new Map<string, TrackedDocument>();
		const client = new LspClient({
			command: spec.command,
			args: spec.args,
			cwd: this.options.root,
			onNotification: (method, params) => {
				if (method !== "textDocument/publishDiagnostics") return;
				const payload = params as PublishDiagnosticsParams;
				this.options.onDiagnostics?.(
					uriToPath(payload.uri),
					payload.diagnostics ?? [],
				);
			},
			onExit: () => {
				// Only forget the session if it is still the current one; a restart
				// may already have replaced it.
				if (this.sessions.get(languageId)?.spec.id === spec.id) {
					this.sessions.delete(languageId);
				}
				this.options.onServerEvent?.({
					languageId,
					serverId: spec.id,
					state: "exited",
				});
			},
		});

		const ready = this.initialize(client, languageId, spec);
		return { spec, client, documents, ready };
	}

	private async initialize(
		client: LspClient,
		languageId: string,
		spec: ServerSpec,
	): Promise<void> {
		try {
			await client.request("initialize", {
				processId: process.pid,
				clientInfo: { name: "code-repl" },
				rootUri: pathToUri(this.options.root),
				workspaceFolders: [
					{ uri: pathToUri(this.options.root), name: "workspace" },
				],
				// Only the capabilities we can actually act on are advertised. A
				// server that thinks we support workspace edits will send them.
				capabilities: {
					textDocument: {
						synchronization: { dynamicRegistration: false },
						completion: {
							completionItem: {
								snippetSupport: false,
								documentationFormat: ["plaintext"],
							},
							contextSupport: false,
						},
						hover: { contentFormat: ["plaintext", "markdown"] },
						publishDiagnostics: { relatedInformation: false },
					},
					workspace: { workspaceFolders: true },
				},
			});
			client.notify("initialized", {});
			this.options.onServerEvent?.({
				languageId,
				serverId: spec.id,
				state: "ready",
			});
		} catch (error) {
			this.options.onServerEvent?.({
				languageId,
				serverId: spec.id,
				state: "failed",
				message: error instanceof Error ? error.message : String(error),
			});
			// Rethrow so `ask()` short-circuits instead of sending requests to a
			// server that never initialised.
			throw error;
		}
	}
}

/**
 * Servers express their intended ordering through `sortText`, which is often
 * quite different from alphabetical — it is how "the member you probably want"
 * gets to the top. Respect it, falling back to the label.
 */
function byServerOrder(a: CompletionItem, b: CompletionItem): number {
	const left = a.sortText ?? a.label;
	const right = b.sortText ?? b.label;
	return left.localeCompare(right);
}
