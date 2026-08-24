/**
 * The opened folder: its tree, which directories are expanded, and the
 * selected row.
 *
 * Pure, like `tabs.ts`. Scanning a directory is IO and belongs to
 * `core/fs/tree.ts`; this reducer only folds a completed scan into state. The
 * consequence is that "expand" and "children arrived" are two separate actions,
 * which is also what lets the view show a directory as expanded-but-loading.
 */

import { flatten, replaceChildren, type TreeNode } from "../../core/fs/tree";

export interface WorkspaceState {
	/** Root node, or `undefined` when no folder is open. */
	readonly tree?: TreeNode;
	/** Absolute paths of expanded directories. */
	readonly expanded: ReadonlySet<string>;
	/** Path of the highlighted row, or `undefined`. */
	readonly selected?: string;
	/** Directories with a scan in flight, so the view can show a spinner. */
	readonly loading: ReadonlySet<string>;
	readonly showHidden: boolean;
}

export const emptyWorkspace: WorkspaceState = {
	expanded: new Set(),
	loading: new Set(),
	showHidden: false,
};

export type WorkspaceAction =
	/** A root scan completed. */
	| { type: "set-root"; tree: TreeNode }
	/** A directory's scan started. */
	| { type: "loading"; path: string }
	/** A directory's scan completed. */
	| {
			type: "children";
			path: string;
			children: readonly TreeNode[];
			error?: string;
	  }
	| { type: "expand"; path: string }
	| { type: "collapse"; path: string }
	| { type: "toggle"; path: string }
	| { type: "select"; path: string }
	/** Move the selection by `delta` rows through the visible list. */
	| { type: "move-selection"; delta: number }
	| { type: "toggle-hidden" }
	| { type: "close" };

export function workspaceReducer(
	state: WorkspaceState,
	action: WorkspaceAction,
): WorkspaceState {
	switch (action.type) {
		case "set-root":
			return {
				...state,
				tree: action.tree,
				// The root starts expanded: an opened folder showing one collapsed
				// row would be a pointless extra keystroke.
				expanded: new Set([action.tree.path]),
				selected: action.tree.path,
				loading: new Set(),
			};

		case "loading":
			return { ...state, loading: withAdded(state.loading, action.path) };

		case "children": {
			if (!state.tree) return state;
			return {
				...state,
				tree: replaceChildren(
					state.tree,
					action.path,
					action.children,
					action.error,
				),
				loading: withRemoved(state.loading, action.path),
			};
		}

		case "expand":
			return { ...state, expanded: withAdded(state.expanded, action.path) };

		case "collapse":
			return { ...state, expanded: withRemoved(state.expanded, action.path) };

		case "toggle":
			return state.expanded.has(action.path)
				? { ...state, expanded: withRemoved(state.expanded, action.path) }
				: { ...state, expanded: withAdded(state.expanded, action.path) };

		case "select":
			return { ...state, selected: action.path };

		case "move-selection": {
			if (!state.tree) return state;
			const rows = flatten(state.tree, state.expanded);
			if (rows.length === 0) return state;
			const current = rows.findIndex((row) => row.node.path === state.selected);
			// Clamped, not wrapped: arrowing off the end of a file list should stop,
			// not silently jump to the other end.
			const next = clamp(
				(current < 0 ? 0 : current) + action.delta,
				0,
				rows.length - 1,
			);
			return { ...state, selected: rows[next]?.node.path };
		}

		case "toggle-hidden":
			return { ...state, showHidden: !state.showHidden };

		case "close":
			return { ...emptyWorkspace, showHidden: state.showHidden };
	}
}

/** The rows the tree view should render, given the current expansion set. */
export function visibleRows(state: WorkspaceState) {
	return state.tree ? flatten(state.tree, state.expanded) : [];
}

/** True when a directory is expanded but its children have not arrived yet. */
export function isLoading(state: WorkspaceState, path: string): boolean {
	return state.loading.has(path);
}

function withAdded(
	set: ReadonlySet<string>,
	value: string,
): ReadonlySet<string> {
	if (set.has(value)) return set;
	const next = new Set(set);
	next.add(value);
	return next;
}

function withRemoved(
	set: ReadonlySet<string>,
	value: string,
): ReadonlySet<string> {
	if (!set.has(value)) return set;
	const next = new Set(set);
	next.delete(value);
	return next;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}
