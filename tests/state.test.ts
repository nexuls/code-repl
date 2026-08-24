import { beforeEach, describe, expect, test } from "bun:test";
import {
	initialSession,
	type SessionState,
	sessionReducer,
} from "../src/app/state/session";
import {
	activeTab,
	dirtyTabs,
	emptyTabs,
	fileTab,
	isDirty,
	nextTabId,
	scratchTab,
	type Tab,
	type TabsState,
	tabsReducer,
} from "../src/app/state/tabs";
import {
	emptyWorkspace,
	visibleRows,
	type WorkspaceState,
	workspaceReducer,
} from "../src/app/state/workspace";
import { DEFAULT_INDENT } from "../src/core/fs/files";
import type { TreeNode } from "../src/core/fs/tree";
import { languageById } from "../src/core/languages/registry";

const python = languageById("python")!;
const rust = languageById("rust")!;

/** A tab with a known id, so actions can target it. */
function tab(id: string, overrides: Partial<Tab> = {}): Tab {
	return {
		id,
		title: `${id}.py`,
		language: python,
		text: "",
		savedText: "",
		output: [],
		running: false,
		diagnostics: [],
		indent: DEFAULT_INDENT,
		...overrides,
	};
}

/** A state holding the given tabs, with the first active. */
function withTabs(...tabs: Tab[]): TabsState {
	return { tabs, active: tabs.length > 0 ? 0 : -1 };
}

describe("tabs: opening and closing", () => {
	test("opening appends and focuses the new tab", () => {
		let state = tabsReducer(emptyTabs, { type: "open", tab: tab("a") });
		state = tabsReducer(state, { type: "open", tab: tab("b") });

		expect(state.tabs.map((t) => t.id)).toEqual(["a", "b"]);
		expect(activeTab(state)?.id).toBe("b");
	});

	test("opening a file that is already open focuses it instead of duplicating", () => {
		const first = tab("a", { path: "/x/main.py" });
		let state = tabsReducer(emptyTabs, { type: "open", tab: first });
		state = tabsReducer(state, { type: "open", tab: tab("b") });
		state = tabsReducer(state, {
			type: "open",
			tab: tab("c", { path: "/x/main.py" }),
		});

		expect(state.tabs).toHaveLength(2);
		expect(activeTab(state)?.id).toBe("a");
	});

	test("two scratch buffers are distinct even though neither has a path", () => {
		let state = tabsReducer(emptyTabs, { type: "open", tab: tab("a") });
		state = tabsReducer(state, { type: "open", tab: tab("b") });
		expect(state.tabs).toHaveLength(2);
	});

	test("closing focuses the tab to the left", () => {
		const state = withTabs(tab("a"), tab("b"), tab("c"));
		const next = tabsReducer(
			{ ...state, active: 2 },
			{ type: "close", id: "c" },
		);

		expect(next.tabs.map((t) => t.id)).toEqual(["a", "b"]);
		expect(activeTab(next)?.id).toBe("b");
	});

	test("closing a middle tab keeps the neighbour under the cursor", () => {
		const state = { ...withTabs(tab("a"), tab("b"), tab("c")), active: 1 };
		const next = tabsReducer(state, { type: "close", id: "b" });
		expect(activeTab(next)?.id).toBe("c");
	});

	test("closing the last tab leaves no active index", () => {
		const next = tabsReducer(withTabs(tab("a")), { type: "close", id: "a" });
		expect(next.tabs).toEqual([]);
		expect(next.active).toBe(-1);
		expect(activeTab(next)).toBeUndefined();
	});

	test("closing an unknown id changes nothing, identically", () => {
		const state = withTabs(tab("a"));
		expect(tabsReducer(state, { type: "close", id: "nope" })).toBe(state);
	});
});

describe("tabs: selection", () => {
	const state = withTabs(tab("a"), tab("b"), tab("c"));

	test("next and previous wrap around", () => {
		let next = tabsReducer({ ...state, active: 2 }, { type: "next" });
		expect(next.active).toBe(0);
		next = tabsReducer({ ...state, active: 0 }, { type: "previous" });
		expect(next.active).toBe(2);
	});

	test("cycling with no tabs open is a no-op", () => {
		expect(tabsReducer(emptyTabs, { type: "next" })).toBe(emptyTabs);
		expect(tabsReducer(emptyTabs, { type: "previous" })).toBe(emptyTabs);
	});

	test("select ignores an out-of-range index", () => {
		expect(tabsReducer(state, { type: "select", index: 9 })).toBe(state);
		expect(tabsReducer(state, { type: "select", index: -1 })).toBe(state);
	});
});

describe("tabs: dirty tracking", () => {
	test("a file tab starts clean and becomes dirty on edit", () => {
		const opened = fileTab("/x/a.py", python, "print(1)");
		expect(isDirty(opened)).toBe(false);

		const state = tabsReducer(withTabs(opened), {
			type: "edit",
			id: opened.id,
			text: "print(2)",
		});
		expect(isDirty(activeTab(state)!)).toBe(true);
	});

	test("a scratch buffer starts dirty, since it exists nowhere on disk", () => {
		expect(isDirty(scratchTab(python))).toBe(true);
	});

	test("saving makes the buffer clean and records the new path", () => {
		const opened = scratchTab(python);
		let state = tabsReducer(withTabs(opened), {
			type: "edit",
			id: opened.id,
			text: "x = 1",
		});
		state = tabsReducer(state, {
			type: "saved",
			id: opened.id,
			path: "/x/new.py",
			title: "new.py",
		});

		const saved = activeTab(state)!;
		expect(isDirty(saved)).toBe(false);
		expect(saved.path).toBe("/x/new.py");
		expect(saved.title).toBe("new.py");
	});

	test("an edit to identical text preserves object identity", () => {
		// Otherwise every keystroke re-renders the tab bar.
		const state = withTabs(tab("a", { text: "same" }));
		expect(tabsReducer(state, { type: "edit", id: "a", text: "same" })).toBe(
			state,
		);
	});

	test("dirtyTabs lists exactly the unsaved buffers", () => {
		const clean = fileTab("/x/a.py", python, "same");
		const dirty = fileTab("/x/b.py", python, "before");
		let state = withTabs(clean, dirty);
		state = tabsReducer(state, { type: "edit", id: dirty.id, text: "after" });

		expect(dirtyTabs(state).map((t) => t.id)).toEqual([dirty.id]);
	});
});

describe("tabs: run lifecycle", () => {
	test("starting a run clears the previous output and result", () => {
		let state = withTabs(
			tab("a", {
				output: [{ stream: "stdout", text: "stale" }],
				runStatus: "failed",
				runSummary: "old",
			}),
		);
		state = tabsReducer(state, { type: "run-started", id: "a" });

		const current = activeTab(state)!;
		expect(current.running).toBe(true);
		expect(current.output).toEqual([]);
		expect(current.runStatus).toBeUndefined();
		expect(current.runSummary).toBeUndefined();
	});

	test("output chunks accumulate in arrival order", () => {
		let state = withTabs(tab("a"));
		state = tabsReducer(state, {
			type: "run-output",
			id: "a",
			chunk: { stream: "stdout", text: "one" },
		});
		state = tabsReducer(state, {
			type: "run-output",
			id: "a",
			chunk: { stream: "stderr", text: "two" },
		});

		expect(activeTab(state)!.output.map((c) => c.text)).toEqual(["one", "two"]);
	});

	test("finishing records the status and stops the spinner", () => {
		let state = tabsReducer(withTabs(tab("a")), {
			type: "run-started",
			id: "a",
		});
		state = tabsReducer(state, {
			type: "run-finished",
			id: "a",
			status: "success",
			summary: "ok · 12ms",
		});

		const current = activeTab(state)!;
		expect(current.running).toBe(false);
		expect(current.runStatus).toBe("success");
		expect(current.runSummary).toBe("ok · 12ms");
	});

	test("output for a closed tab is discarded rather than throwing", () => {
		// A run's output can outlive its tab: the process is killed, but a chunk
		// already in flight still arrives.
		const state = withTabs(tab("a"));
		expect(
			tabsReducer(state, {
				type: "run-output",
				id: "gone",
				chunk: { stream: "stdout", text: "x" },
			}),
		).toBe(state);
	});
});

describe("tabs: diagnostics", () => {
	test("route to the tab with the matching path", () => {
		const a = fileTab("/x/a.py", python, "");
		const b = fileTab("/x/b.py", python, "");
		const state = tabsReducer(withTabs(a, b), {
			type: "diagnostics",
			path: "/x/b.py",
			diagnostics: [
				{
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 1 },
					},
					message: "oops",
				},
			],
		});

		expect(state.tabs[0]!.diagnostics).toEqual([]);
		expect(state.tabs[1]!.diagnostics).toHaveLength(1);
	});

	test("diagnostics for a path nothing has open are dropped", () => {
		const state = withTabs(fileTab("/x/a.py", python, ""));
		expect(
			tabsReducer(state, {
				type: "diagnostics",
				path: "/other.py",
				diagnostics: [],
			}),
		).toBe(state);
	});
});

describe("tabs: ids", () => {
	test("ids are unique and never reused, so scratch slots cannot collide", () => {
		const ids = new Set(Array.from({ length: 50 }, () => nextTabId()));
		expect(ids.size).toBe(50);
	});

	test("a scratch tab is seeded with the language template", () => {
		const created = scratchTab(rust);
		expect(created.language.id).toBe("rust");
		expect(created.text).toBe(rust.template);
		expect(created.title).toBe("scratch.rs");
	});

	test("a file tab takes its title from the basename", () => {
		expect(fileTab("/a/b/c/main.py", python, "").title).toBe("main.py");
	});
});

describe("tabs: language", () => {
	test("retargeting a scratch buffer renames it", () => {
		const scratch = scratchTab(python);
		const state = tabsReducer(withTabs(scratch), {
			type: "set-language",
			id: scratch.id,
			language: rust,
		});
		expect(activeTab(state)?.language.id).toBe("rust");
		expect(activeTab(state)?.title).toBe("scratch.rs");
	});

	test("a file-backed buffer keeps its filename", () => {
		// The file on disk did not move because the grammar changed.
		const opened = fileTab("/x/notes.txt", python, "");
		const state = tabsReducer(withTabs(opened), {
			type: "set-language",
			id: opened.id,
			language: rust,
		});
		expect(activeTab(state)?.language.id).toBe("rust");
		expect(activeTab(state)?.title).toBe("notes.txt");
	});
});

describe("workspace", () => {
	const tree: TreeNode = {
		path: "/root",
		name: "root",
		kind: "directory",
		children: [
			{ path: "/root/src", name: "src", kind: "directory" },
			{ path: "/root/a.py", name: "a.py", kind: "file" },
		],
	};

	let state: WorkspaceState;
	beforeEach(() => {
		state = workspaceReducer(emptyWorkspace, { type: "set-root", tree });
	});

	test("opening a root expands and selects it", () => {
		// A freshly opened folder showing one collapsed row would waste a keystroke.
		expect(state.expanded.has("/root")).toBe(true);
		expect(state.selected).toBe("/root");
		expect(visibleRows(state).map((r) => r.node.name)).toEqual([
			"root",
			"src",
			"a.py",
		]);
	});

	test("toggle expands then collapses", () => {
		let next = workspaceReducer(state, { type: "toggle", path: "/root" });
		expect(next.expanded.has("/root")).toBe(false);
		expect(visibleRows(next)).toHaveLength(1);

		next = workspaceReducer(next, { type: "toggle", path: "/root" });
		expect(next.expanded.has("/root")).toBe(true);
	});

	test("expanding is separate from children arriving, so a spinner can show", () => {
		let next = workspaceReducer(state, { type: "expand", path: "/root/src" });
		next = workspaceReducer(next, { type: "loading", path: "/root/src" });
		expect(next.loading.has("/root/src")).toBe(true);

		next = workspaceReducer(next, {
			type: "children",
			path: "/root/src",
			children: [{ path: "/root/src/x.py", name: "x.py", kind: "file" }],
		});
		expect(next.loading.has("/root/src")).toBe(false);
		expect(visibleRows(next).map((r) => r.node.name)).toEqual([
			"root",
			"src",
			"x.py",
			"a.py",
		]);
	});

	test("a scan error is recorded on the node", () => {
		const next = workspaceReducer(state, {
			type: "children",
			path: "/root/src",
			children: [],
			error: "EACCES",
		});
		expect(visibleRows(next)[1]?.node.error).toBe("EACCES");
	});

	test("selection moves through the visible rows and clamps at the ends", () => {
		let next = workspaceReducer(state, { type: "move-selection", delta: 1 });
		expect(next.selected).toBe("/root/src");

		// Clamped, not wrapped: arrowing off the end should stop.
		next = workspaceReducer(next, { type: "move-selection", delta: 99 });
		expect(next.selected).toBe("/root/a.py");
		next = workspaceReducer(next, { type: "move-selection", delta: -99 });
		expect(next.selected).toBe("/root");
	});

	test("collapsing a directory hides its children from the row list", () => {
		let next = workspaceReducer(state, { type: "expand", path: "/root/src" });
		next = workspaceReducer(next, {
			type: "children",
			path: "/root/src",
			children: [{ path: "/root/src/x.py", name: "x.py", kind: "file" }],
		});
		next = workspaceReducer(next, { type: "collapse", path: "/root/src" });
		expect(visibleRows(next).map((r) => r.node.name)).toEqual([
			"root",
			"src",
			"a.py",
		]);
	});

	test("closing clears the tree but keeps the hidden-files preference", () => {
		let next = workspaceReducer(state, { type: "toggle-hidden" });
		next = workspaceReducer(next, { type: "close" });
		expect(next.tree).toBeUndefined();
		expect(next.showHidden).toBe(true);
	});

	test("moving the selection with no tree open is a no-op", () => {
		expect(
			workspaceReducer(emptyWorkspace, { type: "move-selection", delta: 1 }),
		).toBe(emptyWorkspace);
	});
});

describe("session", () => {
	test("opening a folder reveals the tree pane", () => {
		const next = sessionReducer(initialSession, {
			type: "workspace",
			action: {
				type: "set-root",
				tree: { path: "/r", name: "r", kind: "directory", children: [] },
			},
		});
		expect(next.treeVisible).toBe(true);
	});

	test("pane cycling skips hidden panes", () => {
		// Tree hidden, output shown: Tab must alternate editor and output only.
		let state: SessionState = { ...initialSession, pane: "editor" };
		state = sessionReducer(state, { type: "cycle-pane" });
		expect(state.pane).toBe("output");
		state = sessionReducer(state, { type: "cycle-pane" });
		expect(state.pane).toBe("editor");
	});

	test("pane cycling visits all three when everything is shown", () => {
		let state: SessionState = {
			...initialSession,
			treeVisible: true,
			pane: "tree",
		};
		const seen: string[] = [state.pane];
		for (let i = 0; i < 3; i++) {
			state = sessionReducer(state, { type: "cycle-pane" });
			seen.push(state.pane);
		}
		expect(seen).toEqual(["tree", "editor", "output", "tree"]);
	});

	test("hiding the focused pane moves focus to the editor", () => {
		// Focus left on an invisible pane swallows every keystroke.
		let state: SessionState = { ...initialSession, pane: "output" };
		state = sessionReducer(state, { type: "toggle-output" });
		expect(state.outputVisible).toBe(false);
		expect(state.pane).toBe("editor");
	});

	test("hiding an unfocused pane leaves focus alone", () => {
		let state: SessionState = {
			...initialSession,
			treeVisible: true,
			pane: "editor",
		};
		state = sessionReducer(state, { type: "toggle-tree" });
		expect(state.pane).toBe("editor");
	});

	test("cycling with every pane hidden is a no-op", () => {
		const state: SessionState = {
			...initialSession,
			treeVisible: false,
			outputVisible: false,
			pane: "editor",
		};
		// "editor" is always available, so cycling returns to it rather than
		// leaving focus nowhere.
		expect(sessionReducer(state, { type: "cycle-pane" }).pane).toBe("editor");
	});

	test("an action that changes nothing preserves identity", () => {
		const state = sessionReducer(initialSession, {
			type: "tabs",
			action: { type: "close", id: "nope" },
		});
		expect(state).toBe(initialSession);
	});

	test("overlays replace one another", () => {
		let state = sessionReducer(initialSession, {
			type: "overlay",
			overlay: { kind: "languages" },
		});
		expect(state.overlay.kind).toBe("languages");
		state = sessionReducer(state, {
			type: "overlay",
			overlay: { kind: "none" },
		});
		expect(state.overlay.kind).toBe("none");
	});
});
