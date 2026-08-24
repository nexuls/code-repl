/**
 * The file tree pane.
 *
 * Renders the flattened row list from `workspace` state, windowed to the visible
 * height. A large repository can produce thousands of rows once directories are
 * expanded, so only the visible slice becomes renderables — the rest cost
 * nothing.
 *
 * Keyboard handling guards on `focused`, because `useKeyboard` is global: without
 * the guard this pane would move its selection while you are typing in the
 * editor.
 */

import { StyledText } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceState } from "../app/state/workspace";
import { visibleRows } from "../app/state/workspace";
import type { TreeRow } from "../core/fs/tree";
import { chunk, fit } from "../lib/text";
import type { EditorTheme } from "../lib/theme";

export interface FileTreeProps {
	readonly workspace: WorkspaceState;
	readonly width: number;
	readonly height: number;
	readonly focused: boolean;
	readonly theme: EditorTheme;
	/** Move the selection by `delta` rows. */
	readonly onMove: (delta: number) => void;
	/** Select the row at `path` (a click). */
	readonly onSelect: (path: string) => void;
	/** Expand or collapse a directory. */
	readonly onToggle: (path: string) => void;
	/** Open a file in a tab. */
	readonly onOpen: (path: string) => void;
}

export function FileTree({
	workspace,
	width,
	height,
	focused,
	theme,
	onMove,
	onSelect,
	onToggle,
	onOpen,
}: FileTreeProps) {
	const rows = useMemo(() => visibleRows(workspace), [workspace]);
	const [scroll, setScroll] = useState(0);

	// Two rows of chrome: the border top and bottom.
	const viewRows = Math.max(1, height - 2);
	const innerWidth = Math.max(1, width - 2);
	const selectedIndex = rows.findIndex(
		(row) => row.node.path === workspace.selected,
	);

	// Keep the selection on screen after a move, an expansion, or a resize.
	useEffect(() => {
		setScroll((prev) => {
			if (selectedIndex < 0) return 0;
			if (selectedIndex < prev) return selectedIndex;
			if (selectedIndex >= prev + viewRows) return selectedIndex - viewRows + 1;
			const maxScroll = Math.max(0, rows.length - viewRows);
			return Math.min(prev, maxScroll);
		});
	}, [selectedIndex, viewRows, rows.length]);

	useKeyboard((key) => {
		// `useKeyboard` is global; without this the tree would react to keys typed
		// into the editor.
		if (!focused) return;
		const selected = rows[selectedIndex];

		switch (key.name) {
			case "up":
				onMove(-1);
				return;
			case "down":
				onMove(1);
				return;
			case "pageup":
				onMove(-viewRows);
				return;
			case "pagedown":
				onMove(viewRows);
				return;
			case "home":
				onMove(-rows.length);
				return;
			case "end":
				onMove(rows.length);
				return;
			case "left":
				// Collapse if open; otherwise step out to the parent, which is what
				// makes a tree navigable with two keys.
				if (!selected) return;
				if (selected.node.kind === "directory" && selected.expanded) {
					onToggle(selected.node.path);
				} else {
					const parent = rows
						.slice(0, selectedIndex)
						.reverse()
						.find((row) => row.depth === selected.depth - 1);
					if (parent) onSelect(parent.node.path);
				}
				return;
			case "right":
				if (selected?.node.kind !== "directory") return;
				if (selected.expanded) onMove(1);
				else onToggle(selected.node.path);
				return;
			case "return":
			case "enter":
				if (!selected) return;
				if (selected.node.kind === "directory") onToggle(selected.node.path);
				else onOpen(selected.node.path);
				return;
		}
	});

	const first = Math.min(scroll, Math.max(0, rows.length - viewRows));
	const visible = rows.slice(first, first + viewRows);

	return (
		<box
			width={width}
			height={height}
			border
			borderColor={focused ? theme.borderFocused : theme.border}
			backgroundColor={theme.surface}
			title=" files "
			titleAlignment="left"
			flexDirection="column"
			onMouseDown={(event) => {
				const localY = event.y - (event.currentTarget?.y ?? 0) - 1; // past the border
				const row = visible[localY];
				if (!row) return;
				// A click selects; a click on a directory also toggles it, which is
				// what a file tree is expected to do.
				onSelect(row.node.path);
				if (row.node.kind === "directory") onToggle(row.node.path);
			}}
			onMouseScroll={(event) => {
				const delta = event.scroll?.direction === "up" ? -3 : 3;
				setScroll((prev) =>
					Math.max(
						0,
						Math.min(prev + delta, Math.max(0, rows.length - viewRows)),
					),
				);
			}}
		>
			{rows.length === 0 ? (
				<text
					content={
						new StyledText([
							chunk(
								fit(" no folder open", innerWidth),
								theme.muted,
								theme.surface,
							),
						])
					}
					wrapMode="none"
					selectable={false}
				/>
			) : (
				visible.map((row) => (
					<text
						key={row.node.path}
						content={rowChunks(
							row,
							row.node.path === workspace.selected,
							workspace.loading.has(row.node.path),
							innerWidth,
							theme,
						)}
						wrapMode="none"
						selectable={false}
					/>
				))
			)}
		</box>
	);
}

/** One tree row: indent, disclosure marker, name. */
function rowChunks(
	row: TreeRow,
	selected: boolean,
	loading: boolean,
	width: number,
	theme: EditorTheme,
): StyledText {
	const indent = "  ".repeat(row.depth);
	const marker =
		row.node.kind === "directory" ? (row.expanded ? "▾ " : "▸ ") : "  ";
	// A spinner-free loading cue: the tree never animates, so a static mark keeps
	// the render loop idle while a scan is in flight.
	const suffix = loading ? " …" : row.node.error ? " ⚠" : "";

	const bg = selected ? theme.treeSelected : theme.surface;
	const fg = selected
		? theme.treeSelectedText
		: row.node.error
			? theme.error
			: row.node.kind === "directory"
				? theme.treeDirectory
				: theme.treeFile;

	return new StyledText([
		chunk(fit(`${indent}${marker}${row.node.name}${suffix}`, width), fg, bg),
	]);
}
