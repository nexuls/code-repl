/**
 * LSP's wire format: JSON-RPC messages with HTTP-style headers over a stream.
 *
 * ```
 * Content-Length: 42\r\n
 * \r\n
 * {"jsonrpc":"2.0", ...}
 * ```
 *
 * Kept separate from the client so the tricky part — reassembling messages from
 * arbitrary stream chunks — is testable without a child process.
 *
 * `Content-Length` counts **bytes, not characters**, so the decoder buffers
 * `Uint8Array` and slices by byte offset. Buffering decoded strings instead
 * corrupts every message containing a non-ASCII character, which servers emit
 * routinely in diagnostic text.
 */

/** Serialise one message, headers included, ready to write to a stream. */
export function encodeMessage(message: unknown): Uint8Array {
	const body = new TextEncoder().encode(JSON.stringify(message));
	const header = new TextEncoder().encode(
		`Content-Length: ${body.byteLength}\r\n\r\n`,
	);
	const out = new Uint8Array(header.byteLength + body.byteLength);
	out.set(header, 0);
	out.set(body, header.byteLength);
	return out;
}

/**
 * Incremental decoder. Feed it stream chunks; it yields whole messages as they
 * complete. A single chunk may contain no messages, part of one, or several.
 */
export class MessageDecoder {
	private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

	/**
	 * Append a chunk and return every message that is now complete.
	 *
	 * A malformed header is skipped rather than thrown: a server that writes a
	 * stray line to stdout should cost one message, not the whole session.
	 */
	push(chunk: Uint8Array<ArrayBufferLike>): unknown[] {
		this.buffer = concat(this.buffer, chunk);
		const messages: unknown[] = [];

		while (true) {
			const headerEnd = findHeaderEnd(this.buffer);
			if (headerEnd < 0) break; // Headers still incomplete.

			const headerText = new TextDecoder().decode(
				this.buffer.subarray(0, headerEnd),
			);
			const length = contentLength(headerText);
			if (length === null) {
				// No usable Content-Length. Drop these headers and resynchronise on
				// whatever follows.
				this.buffer = this.buffer.subarray(headerEnd + 4);
				continue;
			}

			const bodyStart = headerEnd + 4; // Past the "\r\n\r\n".
			if (this.buffer.byteLength < bodyStart + length) break; // Body incomplete.

			const body = this.buffer.subarray(bodyStart, bodyStart + length);
			this.buffer = this.buffer.subarray(bodyStart + length);

			try {
				messages.push(JSON.parse(new TextDecoder().decode(body)));
			} catch {
				// Truncated or non-JSON body. The framing is still in sync, so the
				// next message can be read normally.
			}
		}

		return messages;
	}

	/** Bytes held pending completion. Exposed for tests and diagnostics. */
	get pending(): number {
		return this.buffer.byteLength;
	}
}

/** Byte offset of the `\r\n\r\n` that ends the headers, or -1. */
function findHeaderEnd(buffer: Uint8Array<ArrayBufferLike>): number {
	for (let i = 0; i + 3 < buffer.byteLength; i++) {
		if (
			buffer[i] === 0x0d &&
			buffer[i + 1] === 0x0a &&
			buffer[i + 2] === 0x0d &&
			buffer[i + 3] === 0x0a
		) {
			return i;
		}
	}
	return -1;
}

function contentLength(headers: string): number | null {
	for (const line of headers.split("\r\n")) {
		const match = /^content-length:\s*(\d+)\s*$/i.exec(line);
		if (match) return Number(match[1]);
	}
	return null;
}

function concat(
	a: Uint8Array<ArrayBufferLike>,
	b: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBufferLike> {
	if (a.byteLength === 0) return b;
	if (b.byteLength === 0) return a;
	const out = new Uint8Array(a.byteLength + b.byteLength);
	out.set(a, 0);
	out.set(b, a.byteLength);
	return out;
}
