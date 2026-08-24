import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { LspClient } from "../src/core/lsp/client";
import { encodeMessage, MessageDecoder } from "../src/core/lsp/framing";
import { LspManager } from "../src/core/lsp/manager";
import {
	CompletionItemKind,
	completionSigil,
	type Hover,
	hoverText,
	pathToUri,
	uriToPath,
} from "../src/core/lsp/protocol";
import { protocolLanguageId, serversFor } from "../src/core/lsp/servers";

const FIXTURE = join(import.meta.dir, "fixtures", "fake-lsp-server.ts");
const encode = (text: string) => new TextEncoder().encode(text);

describe("framing", () => {
	test("encodes a Content-Length header counting bytes", () => {
		// `{"a":"✓"}` is 9 characters but 11 bytes — ✓ is three bytes in UTF-8.
		const bytes = encodeMessage({ a: "✓" });
		const text = new TextDecoder().decode(bytes);
		expect(text.startsWith("Content-Length: 11\r\n\r\n")).toBe(true);
		expect(text.endsWith('{"a":"✓"}')).toBe(true);
	});

	test("round-trips a message", () => {
		const decoder = new MessageDecoder();
		const message = { jsonrpc: "2.0", id: 1, method: "test" };
		expect(decoder.push(encodeMessage(message))).toEqual([message]);
	});

	test("reassembles a message split across chunks", () => {
		const decoder = new MessageDecoder();
		const bytes = encodeMessage({ id: 7, method: "split" });

		// Byte-at-a-time is the worst case a real pipe can produce.
		let delivered: unknown[] = [];
		for (const byte of bytes) {
			delivered = delivered.concat(decoder.push(new Uint8Array([byte])));
		}
		expect(delivered).toEqual([{ id: 7, method: "split" }]);
		expect(decoder.pending).toBe(0);
	});

	test("yields several messages arriving in one chunk", () => {
		const decoder = new MessageDecoder();
		const a = encodeMessage({ id: 1 });
		const b = encodeMessage({ id: 2 });
		const both = new Uint8Array(a.byteLength + b.byteLength);
		both.set(a, 0);
		both.set(b, a.byteLength);

		expect(decoder.push(both)).toEqual([{ id: 1 }, { id: 2 }]);
	});

	test("splits a chunk that ends mid-body", () => {
		const decoder = new MessageDecoder();
		const bytes = encodeMessage({ id: 1, method: "partial" });
		const cut = bytes.byteLength - 4;

		expect(decoder.push(bytes.subarray(0, cut))).toEqual([]);
		expect(decoder.pending).toBeGreaterThan(0);
		expect(decoder.push(bytes.subarray(cut))).toEqual([
			{ id: 1, method: "partial" },
		]);
	});

	test("counts bytes, not characters, for multi-byte content", () => {
		// The regression this guards: buffering decoded strings and slicing by
		// character corrupts every message containing non-ASCII text, which servers
		// emit constantly in diagnostic messages.
		const decoder = new MessageDecoder();
		const message = { message: "型 error ✓ — see docs" };
		expect(decoder.push(encodeMessage(message))).toEqual([message]);
		expect(decoder.pending).toBe(0);
	});

	test("skips headers with no Content-Length and resynchronises", () => {
		const decoder = new MessageDecoder();
		const junk = encode("X-Nonsense: 1\r\n\r\n");
		const good = encodeMessage({ id: 5 });
		const both = new Uint8Array(junk.byteLength + good.byteLength);
		both.set(junk, 0);
		both.set(good, junk.byteLength);

		expect(decoder.push(both)).toEqual([{ id: 5 }]);
	});

	test("drops a non-JSON body without losing framing sync", () => {
		const decoder = new MessageDecoder();
		const bad = encode("Content-Length: 3\r\n\r\nnot");
		const good = encodeMessage({ id: 9 });
		expect(decoder.push(bad)).toEqual([]);
		expect(decoder.push(good)).toEqual([{ id: 9 }]);
	});

	test("holds incomplete headers without emitting anything", () => {
		const decoder = new MessageDecoder();
		expect(decoder.push(encode("Content-Len"))).toEqual([]);
		expect(decoder.pending).toBeGreaterThan(0);
	});
});

describe("protocol helpers", () => {
	test("path/URI conversion round-trips, including spaces", () => {
		for (const path of [
			"/tmp/a.ts",
			"/tmp/with space/b.ts",
			"/tmp/ünïcode.ts",
		]) {
			expect(uriToPath(pathToUri(path))).toBe(path);
		}
	});

	test("URIs percent-encode but keep separators", () => {
		const uri = pathToUri("/tmp/with space/b.ts");
		expect(uri).toBe("file:///tmp/with%20space/b.ts");
	});

	test("a non-file URI passes through unchanged", () => {
		expect(uriToPath("untitled:Untitled-1")).toBe("untitled:Untitled-1");
	});

	test("every completion kind gets a sigil", () => {
		for (const kind of Object.values(CompletionItemKind)) {
			if (typeof kind !== "number") continue;
			expect(completionSigil(kind).length).toBeGreaterThan(0);
		}
		expect(completionSigil(undefined)).toBe("·");
	});

	test("hover text flattens all three content shapes", () => {
		expect(hoverText({ contents: "plain" } as Hover)).toBe("plain");
		expect(hoverText({ contents: { kind: "markdown", value: "md" } })).toBe(
			"md",
		);
		expect(
			hoverText({ contents: ["a", { kind: "plaintext", value: "b" }] }),
		).toBe("a\nb");
	});
});

describe("server registry", () => {
	test("finds candidates for a language, in declaration order", () => {
		const python = serversFor("python").map((s) => s.id);
		expect(python[0]).toBe("pyright");
		expect(python).toContain("pylsp");
	});

	test("a language with no server yields an empty list", () => {
		expect(serversFor("brainfuck")).toEqual([]);
	});

	test("maps our language id to the protocol's own name", () => {
		const bash = serversFor("bash")[0]!;
		// The protocol calls it "shellscript", not "bash".
		expect(protocolLanguageId(bash, "bash")).toBe("shellscript");
		expect(protocolLanguageId(bash, "zsh")).toBe("shellscript");
	});

	test("falls back to our id when a server declares no mapping", () => {
		const gopls = serversFor("go")[0]!;
		expect(protocolLanguageId(gopls, "unknown")).toBe("unknown");
	});
});

const clients: LspClient[] = [];

/** A client wired to the fake server, disposed after each test. */
function fakeClient(args: string[] = [], timeoutMs = 2_000): LspClient {
	const client = new LspClient({
		command: process.execPath,
		args: ["run", FIXTURE, ...args],
		cwd: import.meta.dir,
		requestTimeoutMs: timeoutMs,
	});
	clients.push(client);
	return client;
}

afterEach(async () => {
	await Promise.all(clients.splice(0).map((client) => client.dispose()));
});

describe("LspClient", () => {
	test("completes a request/response round trip", async () => {
		const client = fakeClient();
		const result = await client.request<{ serverInfo: { name: string } }>(
			"initialize",
			{},
		);
		expect(result.serverInfo.name).toBe("fake-lsp");
	});

	test("correlates concurrent requests by id", async () => {
		const client = fakeClient();
		const [init, completion] = await Promise.all([
			client.request<{ serverInfo: { name: string } }>("initialize", {}),
			client.request<{ items: unknown[] }>("textDocument/completion", {}),
		]);
		expect(init.serverInfo.name).toBe("fake-lsp");
		expect(completion.items).toHaveLength(2);
	});

	test("rejects with the server's error message", async () => {
		const client = fakeClient();
		await expect(client.request("textDocument/boom", {})).rejects.toThrow(
			"deliberate failure",
		);
	});

	test("times out rather than hanging on a silent server", async () => {
		const client = fakeClient(["--silent"], 200);
		await expect(client.request("initialize", {})).rejects.toThrow("timed out");
	});

	test("fails in-flight requests when the server dies", async () => {
		// Otherwise the editor waits on a promise nobody will ever settle.
		const client = fakeClient(["--crash"], 5_000);
		await expect(client.request("initialize", {})).rejects.toThrow();
	});

	test("delivers server-initiated notifications", async () => {
		const received: { method: string; params: unknown }[] = [];
		const client = new LspClient({
			command: process.execPath,
			args: ["run", FIXTURE],
			cwd: import.meta.dir,
			onNotification: (method, params) => received.push({ method, params }),
		});
		clients.push(client);

		client.notify("textDocument/didOpen", {
			textDocument: { uri: "file:///tmp/a.ts" },
		});
		await waitFor(() => received.length > 0);

		expect(received[0]?.method).toBe("textDocument/publishDiagnostics");
	});

	test("reports liveness, and rejects requests once disposed", async () => {
		const client = fakeClient();
		expect(client.alive).toBe(true);
		await client.dispose();
		expect(client.alive).toBe(false);
		await expect(client.request("initialize", {})).rejects.toThrow("disposed");
	});

	test("dispose is idempotent", async () => {
		const client = fakeClient();
		await client.dispose();
		await client.dispose();
	});
});

const managers: LspManager[] = [];

afterEach(async () => {
	await Promise.all(managers.splice(0).map((manager) => manager.dispose()));
});

describe("LspManager", () => {
	test("degrades to empty results when no server is installed", async () => {
		const events: string[] = [];
		const manager = new LspManager({
			root: import.meta.dir,
			which: async () => null,
			onServerEvent: (event) =>
				events.push(`${event.state}:${event.message ?? ""}`),
		});
		managers.push(manager);

		await manager.openDocument("/tmp/a.py", "python", "x = 1");
		const items = await manager.completion("/tmp/a.py", "python", {
			line: 0,
			character: 1,
		});

		// The editor must stay fully usable on a machine with no language servers.
		expect(items).toEqual([]);
		expect(
			await manager.hover("/tmp/a.py", "python", { line: 0, character: 1 }),
		).toBeNull();
		expect(manager.runningServers()).toEqual([]);
		expect(events.some((e) => e.includes("no language server installed"))).toBe(
			true,
		);
	});

	test("probes only once for a language with no server", async () => {
		let probes = 0;
		const manager = new LspManager({
			root: import.meta.dir,
			which: async () => {
				probes += 1;
				return null;
			},
		});
		managers.push(manager);

		await manager.openDocument("/tmp/a.go", "go", "");
		const afterFirst = probes;
		await manager.openDocument("/tmp/b.go", "go", "");
		expect(probes).toBe(afterFirst);
	});

	test("changing or closing an untracked document is a no-op", () => {
		const manager = new LspManager({
			root: import.meta.dir,
			which: async () => null,
		});
		managers.push(manager);

		// Must not throw: the editor calls these on every keystroke, including for
		// languages that never got a server.
		manager.changeDocument("/tmp/a.py", "python", "y = 2");
		manager.closeDocument("/tmp/a.py", "python");
	});

	test("returns nothing after dispose", async () => {
		const manager = new LspManager({
			root: import.meta.dir,
			which: async () => null,
		});
		await manager.dispose();
		await manager.openDocument("/tmp/a.py", "python", "");
		expect(
			await manager.completion("/tmp/a.py", "python", {
				line: 0,
				character: 0,
			}),
		).toEqual([]);
	});
});

/** Poll until `predicate` holds, or fail the test by timing out. */
async function waitFor(
	predicate: () => boolean,
	timeoutMs = 3_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("waitFor timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}
