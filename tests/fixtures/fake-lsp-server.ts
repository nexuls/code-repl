/**
 * A stand-in language server, used by the LSP client tests.
 *
 * Speaks just enough of the protocol to be driven like a real server: it frames
 * responses correctly, answers `initialize`, `textDocument/completion`, and
 * `shutdown`, pushes a diagnostics notification on `didOpen`, and can be told to
 * misbehave via argv so the client's failure paths are exercised for real rather
 * than mocked.
 *
 *   --silent   accept requests and never answer them (tests request timeouts)
 *   --crash    exit as soon as the first request arrives (tests server death)
 */

const flags = new Set(process.argv.slice(2));

function send(message: unknown): void {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
	process.stdout.write(body);
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk: Buffer) => {
	buffer = Buffer.concat([buffer, chunk]);

	while (true) {
		const headerEnd = buffer.indexOf("\r\n\r\n");
		if (headerEnd < 0) return;
		const header = buffer.subarray(0, headerEnd).toString("utf8");
		const match = /content-length:\s*(\d+)/i.exec(header);
		if (!match) return;

		const length = Number(match[1]);
		const bodyStart = headerEnd + 4;
		if (buffer.byteLength < bodyStart + length) return;

		const body = buffer
			.subarray(bodyStart, bodyStart + length)
			.toString("utf8");
		buffer = buffer.subarray(bodyStart + length);
		handle(JSON.parse(body));
	}
});

function handle(message: {
	id?: number;
	method?: string;
	params?: unknown;
}): void {
	if (flags.has("--crash")) process.exit(1);
	if (flags.has("--silent")) return;

	switch (message.method) {
		case "initialize":
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					capabilities: { textDocumentSync: 1, completionProvider: {} },
					serverInfo: { name: "fake-lsp" },
				},
			});
			return;

		case "textDocument/didOpen": {
			const params = message.params as { textDocument: { uri: string } };
			send({
				jsonrpc: "2.0",
				method: "textDocument/publishDiagnostics",
				params: {
					uri: params.textDocument.uri,
					diagnostics: [
						{
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 4 },
							},
							severity: 1,
							message: "fake diagnostic ✓",
							source: "fake",
						},
					],
				},
			});
			return;
		}

		case "textDocument/completion":
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: {
					isIncomplete: false,
					items: [
						{ label: "zebra", kind: 6, sortText: "0" },
						{ label: "apple", kind: 3, sortText: "1", detail: "() => void" },
					],
				},
			});
			return;

		case "textDocument/hover":
			send({
				jsonrpc: "2.0",
				id: message.id,
				result: { contents: { kind: "markdown", value: "**hover** text" } },
			});
			return;

		case "textDocument/boom":
			send({
				jsonrpc: "2.0",
				id: message.id,
				error: { code: -32603, message: "deliberate failure" },
			});
			return;

		case "shutdown":
			send({ jsonrpc: "2.0", id: message.id, result: null });
			return;

		case "exit":
			process.exit(0);
	}
}
