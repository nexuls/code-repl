/**
 * Whole-session state: tabs, workspace, and which pane has focus.
 *
 * Composing the two reducers here rather than in `App` keeps the component free
 * of state transitions, and means the app's behaviour can be driven in a test
 * by dispatching actions at a plain function.
 */

import {
	emptyTabs,
	type TabsAction,
	type TabsState,
	tabsReducer,
} from "./tabs";
import {
	emptyWorkspace,
	type WorkspaceAction,
	type WorkspaceState,
	workspaceReducer,
} from "./workspace";

/** Which pane receives keystrokes. */
export type Pane = "tree" | "editor" | "output";

/** A transient overlay. Only one can be open at a time. */
export type Overlay =
	| { readonly kind: "none" }
	| { readonly kind: "languages" }
	| { readonly kind: "help" }
	/** Confirmation before discarding unsaved work. */
	| { readonly kind: "confirm-quit"; readonly dirtyCount: number }
	/** Asking where to put a buffer that has no path yet. */
	| {
			readonly kind: "save-as";
			readonly directory: string;
			readonly suggestedName: string;
	  };

export interface SessionState {
	readonly tabs: TabsState;
	readonly workspace: WorkspaceState;
	readonly pane: Pane;
	readonly overlay: Overlay;
	/** Whether the file tree pane is shown at all. */
	readonly treeVisible: boolean;
	/** Whether the output pane is shown. */
	readonly outputVisible: boolean;
	/** Transient message for the status bar. */
	readonly status?: string;
}

export const initialSession: SessionState = {
	tabs: emptyTabs,
	workspace: emptyWorkspace,
	pane: "editor",
	overlay: { kind: "none" },
	treeVisible: false,
	outputVisible: true,
};

export type SessionAction =
	| { type: "tabs"; action: TabsAction }
	| { type: "workspace"; action: WorkspaceAction }
	| { type: "focus"; pane: Pane }
	| { type: "cycle-pane" }
	| { type: "overlay"; overlay: Overlay }
	| { type: "toggle-tree" }
	| { type: "toggle-output" }
	| { type: "status"; message?: string };

export function sessionReducer(
	state: SessionState,
	action: SessionAction,
): SessionState {
	switch (action.type) {
		case "tabs": {
			const tabs = tabsReducer(state.tabs, action.action);
			if (tabs === state.tabs) return state;
			return { ...state, tabs };
		}

		case "workspace": {
			const workspace = workspaceReducer(state.workspace, action.action);
			if (workspace === state.workspace) return state;
			// Opening a folder implies wanting to see it.
			const treeVisible =
				action.action.type === "set-root" ? true : state.treeVisible;
			return { ...state, workspace, treeVisible };
		}

		case "focus":
			return state.pane === action.pane
				? state
				: { ...state, pane: action.pane };

		case "cycle-pane": {
			// Hidden panes are skipped, so Tab never focuses something invisible.
			const order: Pane[] = ["tree", "editor", "output"];
			const available = order.filter(
				(pane) =>
					(pane !== "tree" || state.treeVisible) &&
					(pane !== "output" || state.outputVisible),
			);
			if (available.length === 0) return state;
			const index = available.indexOf(state.pane);
			return { ...state, pane: available[(index + 1) % available.length]! };
		}

		case "overlay":
			return { ...state, overlay: action.overlay };

		case "toggle-tree": {
			const treeVisible = !state.treeVisible;
			return {
				...state,
				treeVisible,
				// Focus must not be left on a pane that just disappeared.
				pane: !treeVisible && state.pane === "tree" ? "editor" : state.pane,
			};
		}

		case "toggle-output": {
			const outputVisible = !state.outputVisible;
			return {
				...state,
				outputVisible,
				pane: !outputVisible && state.pane === "output" ? "editor" : state.pane,
			};
		}

		case "status":
			return { ...state, status: action.message };
	}
}
