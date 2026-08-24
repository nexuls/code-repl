/**
 * Open buffers and the active tab.
 *
 * A pure reducer over serialisable state: no IO, no process spawning, no
 * OpenTUI. Loading a file's text and writing it back are the caller's job — the
 * reducer only records the result. That is what makes tab behaviour (which tab
 * becomes active when you close the last one, whether a file already open gets a
 * second tab) testable without a filesystem.
 */

import {
	DEFAULT_INDENT,
	detectIndent,
	type IndentStyle,
} from "../../core/fs/files";
import type { Language } from "../../core/languages/registry";
import type { Diagnostic } from "../../core/lsp/protocol";
import type { OutputChunk, RunStatus } from "../../core/runner";
import { expandTabs } from "../../lib/text";

/** One open buffer. */
export interface Tab {
	/** Stable identity; also the runner's scratch slot. Never reused. */
	readonly id: string;
	/** Absolute path, or `undefined` for an unsaved scratch buffer. */
	readonly path?: string;
	/** Name shown on the tab. */
	readonly title: string;
	readonly language: Language;
	readonly text: string;
	/**
	 * Text as last loaded or saved, already normalised the same way the buffer
	 * is. Comparing raw file text against a normalised buffer would mark every
	 * tab-indented file dirty the instant it opened.
	 */
	readonly savedText: string;
	/** The file's own indent style, reapplied on save. */
	readonly indent: IndentStyle;
	/** Output accumulated by the most recent run. */
	readonly output: readonly OutputChunk[];
	/** Status of the most recent run, or `undefined` if it never ran. */
	readonly runStatus?: RunStatus;
	/** Summary line for the status bar, e.g. "ok · 42ms". */
	readonly runSummary?: string;
	/** True while a run is in flight. */
	readonly running: boolean;
	/** Latest diagnostics from the language server. */
	readonly diagnostics: readonly Diagnostic[];
}

export interface TabsState {
	readonly tabs: readonly Tab[];
	/** Index into `tabs`, or -1 when none are open. */
	readonly active: number;
}

export const emptyTabs: TabsState = { tabs: [], active: -1 };

export type TabsAction =
	| { type: "open"; tab: Tab }
	| { type: "close"; id: string }
	| { type: "select"; index: number }
	| { type: "next" }
	| { type: "previous" }
	| { type: "edit"; id: string; text: string }
	/**
	 * A write completed. `text` is what actually reached disk, not the buffer's
	 * current contents: edits made while the write was in flight are genuinely
	 * unsaved, and marking them clean would lose them at quit.
	 */
	| { type: "saved"; id: string; path: string; title: string; text: string }
	| { type: "run-started"; id: string }
	| { type: "run-output"; id: string; chunk: OutputChunk }
	| { type: "run-finished"; id: string; status: RunStatus; summary: string }
	| { type: "clear-output"; id: string }
	| { type: "diagnostics"; path: string; diagnostics: readonly Diagnostic[] }
	| { type: "set-language"; id: string; language: Language };

/** Pure reducer. Returns `state` itself when an action changes nothing. */
export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
	switch (action.type) {
		case "open": {
			// Opening a file that is already open focuses it rather than making a
			// second tab of the same thing.
			if (action.tab.path) {
				const existing = state.tabs.findIndex(
					(t) => t.path === action.tab.path,
				);
				if (existing >= 0) return { ...state, active: existing };
			}
			return {
				tabs: [...state.tabs, action.tab],
				active: state.tabs.length,
			};
		}

		case "close": {
			const index = state.tabs.findIndex((t) => t.id === action.id);
			if (index < 0) return state;
			const tabs = state.tabs.filter((_, i) => i !== index);
			// Focus moves left, which keeps the neighbouring tab under the cursor
			// instead of jumping to whatever slid into the closed slot.
			const active = tabs.length === 0 ? -1 : Math.min(index, tabs.length - 1);
			return { tabs, active };
		}

		case "select":
			if (action.index < 0 || action.index >= state.tabs.length) return state;
			return { ...state, active: action.index };

		case "next":
			if (state.tabs.length === 0) return state;
			return { ...state, active: (state.active + 1) % state.tabs.length };

		case "previous":
			if (state.tabs.length === 0) return state;
			return {
				...state,
				active: (state.active - 1 + state.tabs.length) % state.tabs.length,
			};

		case "edit":
			return updateTab(state, action.id, (tab) =>
				tab.text === action.text ? tab : { ...tab, text: action.text },
			);

		case "saved":
			return updateTab(state, action.id, (tab) => ({
				...tab,
				path: action.path,
				title: action.title,
				// The text that was written, not the current buffer.
				savedText: action.text,
			}));

		case "run-started":
			return updateTab(state, action.id, (tab) => ({
				...tab,
				running: true,
				output: [],
				runStatus: undefined,
				runSummary: undefined,
			}));

		case "run-output":
			return updateTab(state, action.id, (tab) => ({
				...tab,
				output: [...tab.output, action.chunk],
			}));

		case "run-finished":
			return updateTab(state, action.id, (tab) => ({
				...tab,
				running: false,
				runStatus: action.status,
				runSummary: action.summary,
			}));

		case "clear-output":
			return updateTab(state, action.id, (tab) => ({
				...tab,
				output: [],
				runStatus: undefined,
				runSummary: undefined,
			}));

		case "diagnostics": {
			// Diagnostics arrive keyed by path, because that is what the server
			// knows; an unsaved buffer has no path and simply gets none.
			const index = state.tabs.findIndex((t) => t.path === action.path);
			if (index < 0) return state;
			return updateTab(state, state.tabs[index]!.id, (tab) => ({
				...tab,
				diagnostics: action.diagnostics,
			}));
		}

		case "set-language":
			return updateTab(state, action.id, (tab) => ({
				...tab,
				language: action.language,
				// A scratch buffer is named after its language, so retargeting it
				// renames it. A file-backed buffer keeps its filename: the file on
				// disk did not move just because the grammar changed.
				title: tab.path ? tab.title : `scratch.${action.language.extension}`,
			}));
	}
}

/** The focused tab, or `undefined` when none are open. */
export function activeTab(state: TabsState): Tab | undefined {
	return state.tabs[state.active];
}

/** True when the buffer differs from what is on disk. */
export function isDirty(tab: Tab): boolean {
	return tab.text !== tab.savedText;
}

/** Any tab with unsaved changes, for the quit confirmation. */
export function dirtyTabs(state: TabsState): readonly Tab[] {
	return state.tabs.filter(isDirty);
}

/**
 * Replace one tab, preserving identity when the updater returns the same object
 * so React can skip re-rendering untouched tabs.
 */
function updateTab(
	state: TabsState,
	id: string,
	update: (tab: Tab) => Tab,
): TabsState {
	const index = state.tabs.findIndex((t) => t.id === id);
	if (index < 0) return state;
	const current = state.tabs[index]!;
	const next = update(current);
	if (next === current) return state;
	const tabs = state.tabs.slice();
	tabs[index] = next;
	return { ...state, tabs };
}

let counter = 0;

/** A fresh tab id. Monotonic, so a scratch slot is never reused. */
export function nextTabId(): string {
	counter += 1;
	return `tab-${counter}`;
}

/** Build a scratch tab holding a language's starter template. */
export function scratchTab(language: Language): Tab {
	return {
		id: nextTabId(),
		title: `scratch.${language.extension}`,
		language,
		text: language.template,
		// No path and no saved text: a scratch buffer starts dirty by definition.
		savedText: "",
		indent: DEFAULT_INDENT,
		output: [],
		running: false,
		diagnostics: [],
	};
}

/**
 * Build a tab for a file read from disk.
 *
 * The text is normalised — tabs expanded — before it becomes both `text` and
 * `savedText`, so a tab-indented file opens *clean*. The original style is kept
 * so saving writes the file back the way it was found.
 */
export function fileTab(path: string, language: Language, text: string): Tab {
	const indent = detectIndent(text);
	const normalised = expandTabs(text, indent.width);
	return {
		id: nextTabId(),
		path,
		title: path.slice(path.lastIndexOf("/") + 1),
		language,
		text: normalised,
		savedText: normalised,
		indent,
		output: [],
		running: false,
		diagnostics: [],
	};
}
