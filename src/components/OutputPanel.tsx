/**
 * The run-output pane.
 *
 * Output arrives as chunks with arbitrary boundaries — a process can flush
 * mid-line — so chunks are concatenated per stream-run before being wrapped into
 * display lines. Wrapping each chunk independently would break a line wherever
 * the OS happened to split the pipe read.
 *
 * The view sticks to the bottom while a run is in progress, but stops following
 * once you scroll up: reading an error at the top while output keeps arriving is
 * a normal thing to want.
 */

import { StyledText } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OutputChunk, OutputStream } from "../core/runner";
import { chunk, fit, hardWrap, stripAnsi } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface OutputPanelProps {
	readonly output: readonly OutputChunk[];
	readonly running: boolean;
	/** Summary of the last run, e.g. "ok · 12ms". Shown in the border title. */
	readonly summary?: string;
	readonly width: number;
	readonly height: number;
	readonly focused: boolean;
	readonly theme: EditorTheme;
}

/** A wrapped display line, tagged with the stream it came from. */
interface Line {
	readonly text: string;
	readonly stream: OutputStream;
}

export function OutputPanel({
	output,
	running,
	summary,
	width,
	height,
	focused,
	theme,
}: OutputPanelProps) {
	const innerWidth = Math.max(1, width - 2);
	const viewRows = Math.max(1, height - 2);

	const lines = useMemo(
		() => toLines(output, innerWidth),
		[output, innerWidth],
	);
	const [scroll, setScroll] = useState(0);
	// Following means "pinned to the bottom". Scrolling up turns it off; scrolling
	// back to the bottom turns it on again.
	const following = useRef(true);

	const maxScroll = Math.max(0, lines.length - viewRows);

	useEffect(() => {
		if (following.current) setScroll(maxScroll);
	}, [maxScroll]);

	// A new run starts at the top: the first lines are the ones you want.
	useEffect(() => {
		if (running) {
			following.current = true;
			setScroll(0);
		}
	}, [running]);

	function scrollBy(delta: number) {
		setScroll((prev) => {
			const next = Math.max(0, Math.min(prev + delta, maxScroll));
			following.current = next >= maxScroll;
			return next;
		});
	}

	useKeyboard((key) => {
		if (!focused) return;
		switch (key.name) {
			case "up":
				scrollBy(-1);
				return;
			case "down":
				scrollBy(1);
				return;
			case "pageup":
				scrollBy(-viewRows);
				return;
			case "pagedown":
				scrollBy(viewRows);
				return;
			case "home":
				scrollBy(-lines.length);
				return;
			case "end":
				scrollBy(lines.length);
				return;
		}
	});

	const first = Math.min(scroll, maxScroll);
	const visible = lines.slice(first, first + viewRows);

	return (
		<box
			width={width}
			height={height}
			border
			borderColor={focused ? theme.borderFocused : theme.border}
			backgroundColor={theme.background}
			title={title(running, summary, lines.length, first, viewRows)}
			titleAlignment="left"
			flexDirection="column"
			onMouseScroll={(event) =>
				scrollBy(event.scroll?.direction === "up" ? -3 : 3)
			}
		>
			{visible.length === 0 ? (
				<text
					content={
						new StyledText([
							chunk(
								fit(running ? " running…" : " ctrl+r to run", innerWidth),
								theme.muted,
								theme.background,
							),
						])
					}
					wrapMode="none"
					selectable={false}
				/>
			) : (
				visible.map((line, index) => (
					<text
						// Output lines have no identity beyond their position, and the
						// list is append-only, so the index is a correct key here.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						key={first + index}
						content={
							new StyledText([
								chunk(
									fit(line.text, innerWidth),
									colourFor(line.stream, theme),
									theme.background,
								),
							])
						}
						wrapMode="none"
						selectable
					/>
				))
			)}
		</box>
	);
}

/**
 * Turn chunks into wrapped display lines.
 *
 * Adjacent chunks from the same stream are joined first: a process can flush
 * mid-line, and wrapping each chunk separately would break the line wherever the
 * pipe read happened to end.
 */
function toLines(output: readonly OutputChunk[], width: number): Line[] {
	const lines: Line[] = [];
	let index = 0;

	while (index < output.length) {
		const stream = output[index]!.stream;
		let text = "";
		while (index < output.length && output[index]!.stream === stream) {
			text += output[index]!.text;
			index += 1;
		}
		// A trailing newline would otherwise produce a spurious blank line between
		// every stream switch.
		const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
		for (const line of hardWrap(stripAnsi(trimmed), width)) {
			lines.push({ text: line, stream });
		}
	}

	return lines;
}

function colourFor(stream: OutputStream, theme: EditorTheme): string {
	switch (stream) {
		case "stdout":
			return theme.outputStdout;
		case "stderr":
			return theme.outputStderr;
		case "system":
			return theme.outputSystem;
	}
}

/** Border title: run state, and a scroll position when the output overflows. */
function title(
	running: boolean,
	summary: string | undefined,
	lineCount: number,
	scroll: number,
	viewRows: number,
): string {
	const state = running ? "running…" : (summary ?? "output");
	if (lineCount <= viewRows) return ` ${state} `;
	const last = Math.min(lineCount, scroll + viewRows);
	return ` ${state}  ${scroll + 1}-${last}/${lineCount} `;
}
