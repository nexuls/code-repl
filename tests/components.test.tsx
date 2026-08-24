import { describe, expect, test } from "bun:test";
import { KeyCodes } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import type { Tab } from "../src/app/state/tabs";
import { emptyWorkspace, workspaceReducer } from "../src/app/state/workspace";
import { FileTree } from "../src/components/FileTree";
import { HelpOverlay } from "../src/components/HelpOverlay";
import { LanguagePicker } from "../src/components/LanguagePicker";
import { OutputPanel } from "../src/components/OutputPanel";
import { SavePrompt } from "../src/components/SavePrompt";
import { StatusBar } from "../src/components/StatusBar";
import { TabBar } from "../src/components/TabBar";
import { DEFAULT_INDENT } from "../src/core/fs/files";
import type { DetectedLanguage } from "../src/core/languages/detect";
import { languageById } from "../src/core/languages/registry";
import { darkTheme } from "../src/lib/theme";

const python = languageById("python")!;
const rust = languageById("rust")!;

function tab(overrides: Partial<Tab> = {}): Tab {
	return {
		id: "t1",
		title: "main.py",
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

/** Mount a node and return its rendered character frame. */
async function frameOf(
	node: React.ReactNode,
	width: number,
	height: number,
): Promise<string> {
	const setup = await testRender(node, { width, height });
	try {
		await setup.renderOnce();
		return setup.captureCharFrame();
	} finally {
		setup.renderer.destroy();
	}
}

describe("TabBar", () => {
	test("shows a hint when nothing is open", async () => {
		const frame = await frameOf(
			<TabBar
				tabs={[]}
				active={-1}
				width={60}
				theme={darkTheme}
				onSelect={() => {}}
				onClose={() => {}}
			/>,
			60,
			1,
		);
		expect(frame).toContain("no buffers");
	});

	test("lists open buffers and marks unsaved ones", async () => {
		const frame = await frameOf(
			<TabBar
				tabs={[
					tab({ id: "a", title: "clean.py", text: "x", savedText: "x" }),
					tab({ id: "b", title: "dirty.py", text: "y", savedText: "" }),
				]}
				active={0}
				width={60}
				theme={darkTheme}
				onSelect={() => {}}
				onClose={() => {}}
			/>,
			60,
			1,
		);
		expect(frame).toContain("clean.py");
		expect(frame).toContain("dirty.py");
		// The dot appears only for the buffer that differs from disk.
		expect(frame).toContain("dirty.py •");
		expect(frame).not.toContain("clean.py •");
	});

	test("elides a very long buffer name rather than pushing others off", async () => {
		const frame = await frameOf(
			<TabBar
				tabs={[
					tab({ id: "a", title: "a-really-quite-long-file-name-indeed.py" }),
					tab({ id: "b", title: "second.py" }),
				]}
				active={0}
				width={70}
				theme={darkTheme}
				onSelect={() => {}}
				onClose={() => {}}
			/>,
			70,
			1,
		);
		expect(frame).toContain("…");
		expect(frame).toContain("second.py");
	});

	test("a click selects the tab under the cursor", async () => {
		const selected: number[] = [];
		const setup = await testRender(
			<TabBar
				tabs={[
					tab({ id: "a", title: "one.py" }),
					tab({ id: "b", title: "two.py" }),
				]}
				active={0}
				width={60}
				theme={darkTheme}
				onSelect={(index) => selected.push(index)}
				onClose={() => {}}
			/>,
			{ width: 60, height: 1 },
		);
		try {
			await setup.renderOnce();
			// " one.py   × " is 12 cells, so column 14 lands inside the second tab.
			await act(async () => {
				await setup.mockMouse.click(14, 0);
			});
			expect(selected).toEqual([1]);
		} finally {
			setup.renderer.destroy();
		}
	});
});

describe("FileTree", () => {
	const tree = {
		path: "/root",
		name: "root",
		kind: "directory" as const,
		children: [
			{ path: "/root/src", name: "src", kind: "directory" as const },
			{ path: "/root/main.py", name: "main.py", kind: "file" as const },
		],
	};
	const workspace = workspaceReducer(emptyWorkspace, {
		type: "set-root",
		tree,
	});

	test("renders the expanded root with its children", async () => {
		const frame = await frameOf(
			<FileTree
				workspace={workspace}
				width={30}
				height={10}
				focused
				theme={darkTheme}
				onMove={() => {}}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			30,
			10,
		);
		expect(frame).toContain("root");
		expect(frame).toContain("src");
		expect(frame).toContain("main.py");
	});

	test("uses distinct disclosure markers for open and closed directories", async () => {
		const collapsed = workspaceReducer(workspace, {
			type: "collapse",
			path: "/root",
		});
		const openFrame = await frameOf(
			<FileTree
				workspace={workspace}
				width={30}
				height={10}
				focused
				theme={darkTheme}
				onMove={() => {}}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			30,
			10,
		);
		const closedFrame = await frameOf(
			<FileTree
				workspace={collapsed}
				width={30}
				height={10}
				focused
				theme={darkTheme}
				onMove={() => {}}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			30,
			10,
		);
		expect(openFrame).toContain("▾ root");
		expect(closedFrame).toContain("▸ root");
		// Collapsing must actually hide the children, not just change the marker.
		expect(closedFrame).not.toContain("main.py");
	});

	test("marks a directory whose scan is in flight", async () => {
		const loading = workspaceReducer(workspace, {
			type: "loading",
			path: "/root/src",
		});
		const frame = await frameOf(
			<FileTree
				workspace={loading}
				width={30}
				height={10}
				focused
				theme={darkTheme}
				onMove={() => {}}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			30,
			10,
		);
		expect(frame).toContain("src …");
	});

	test("marks a directory that failed to scan", async () => {
		const failed = workspaceReducer(workspace, {
			type: "children",
			path: "/root/src",
			children: [],
			error: "EACCES",
		});
		const frame = await frameOf(
			<FileTree
				workspace={failed}
				width={30}
				height={10}
				focused
				theme={darkTheme}
				onMove={() => {}}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			30,
			10,
		);
		expect(frame).toContain("⚠");
	});

	test("says so when no folder is open", async () => {
		const frame = await frameOf(
			<FileTree
				workspace={emptyWorkspace}
				width={30}
				height={10}
				focused
				theme={darkTheme}
				onMove={() => {}}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			30,
			10,
		);
		expect(frame).toContain("no folder open");
	});

	test("ignores keys when unfocused, since useKeyboard is global", async () => {
		const moves: number[] = [];
		const setup = await testRender(
			<FileTree
				workspace={workspace}
				width={30}
				height={10}
				focused={false}
				theme={darkTheme}
				onMove={(delta) => moves.push(delta)}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			{ width: 30, height: 10 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.ARROW_DOWN);
			});
			expect(moves).toEqual([]);
		} finally {
			setup.renderer.destroy();
		}
	});

	test("moves the selection when focused", async () => {
		const moves: number[] = [];
		const setup = await testRender(
			<FileTree
				workspace={workspace}
				width={30}
				height={10}
				focused
				theme={darkTheme}
				onMove={(delta) => moves.push(delta)}
				onSelect={() => {}}
				onToggle={() => {}}
				onOpen={() => {}}
			/>,
			{ width: 30, height: 10 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.ARROW_DOWN);
			});
			expect(moves).toEqual([1]);
		} finally {
			setup.renderer.destroy();
		}
	});
});

describe("OutputPanel", () => {
	test("prompts when there is nothing to show", async () => {
		const frame = await frameOf(
			<OutputPanel
				output={[]}
				running={false}
				width={40}
				height={8}
				focused={false}
				theme={darkTheme}
			/>,
			40,
			8,
		);
		expect(frame).toContain("ctrl+r to run");
	});

	test("renders streamed output", async () => {
		const frame = await frameOf(
			<OutputPanel
				output={[
					{ stream: "stdout", text: "hello\n" },
					{ stream: "stderr", text: "a warning\n" },
				]}
				running={false}
				summary="ok · 12ms"
				width={40}
				height={8}
				focused={false}
				theme={darkTheme}
			/>,
			40,
			8,
		);
		expect(frame).toContain("hello");
		expect(frame).toContain("a warning");
		expect(frame).toContain("ok · 12ms");
	});

	test("joins chunks split mid-line by the pipe", async () => {
		// A process can flush mid-line; wrapping each chunk separately would break
		// the line wherever the OS happened to end the read.
		const frame = await frameOf(
			<OutputPanel
				output={[
					{ stream: "stdout", text: "one two " },
					{ stream: "stdout", text: "three four" },
				]}
				running={false}
				width={40}
				height={8}
				focused={false}
				theme={darkTheme}
			/>,
			40,
			8,
		);
		expect(frame).toContain("one two three four");
	});

	test("strips ANSI escapes rather than printing them as cells", async () => {
		const frame = await frameOf(
			<OutputPanel
				output={[{ stream: "stdout", text: "[31mred text[0m\n" }]}
				running={false}
				width={40}
				height={8}
				focused={false}
				theme={darkTheme}
			/>,
			40,
			8,
		);
		expect(frame).toContain("red text");
		expect(frame).not.toContain("[31m");
	});

	test("shows a scroll position once output overflows", async () => {
		const output = [
			{
				stream: "stdout" as const,
				text: `${Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n")}\n`,
			},
		];
		const frame = await frameOf(
			<OutputPanel
				output={output}
				running={false}
				width={40}
				height={8}
				focused={false}
				theme={darkTheme}
			/>,
			40,
			8,
		);
		expect(frame).toContain("/40");
	});
});

describe("StatusBar", () => {
	const available: DetectedLanguage = {
		language: python,
		toolchain: python.toolchains[0],
		binaries: { python3: "/usr/bin/python3" },
		version: "Python 3.12.0",
	};

	test("names the language of the active buffer", async () => {
		const frame = await frameOf(
			<StatusBar
				tab={tab()}
				detected={available}
				lspActive={false}
				width={80}
				theme={darkTheme}
			/>,
			80,
			1,
		);
		expect(frame).toContain("Python");
	});

	test("warns when the machine cannot run the buffer's language", async () => {
		const frame = await frameOf(
			<StatusBar
				tab={tab({ language: rust })}
				detected={{ language: rust, binaries: {} }}
				lspActive={false}
				width={80}
				theme={darkTheme}
			/>,
			80,
			1,
		);
		expect(frame).toContain("no toolchain");
	});

	test("shows the last run's summary and the unsaved marker", async () => {
		const frame = await frameOf(
			<StatusBar
				tab={tab({
					text: "edited",
					savedText: "",
					runSummary: "ok · 9ms",
					runStatus: "success",
				})}
				detected={available}
				lspActive
				width={100}
				theme={darkTheme}
			/>,
			100,
			1,
		);
		expect(frame).toContain("ok · 9ms");
		expect(frame).toContain("unsaved");
		expect(frame).toContain("lsp");
	});

	test("drops the key hints before the message on a narrow terminal", async () => {
		const frame = await frameOf(
			<StatusBar
				tab={tab()}
				detected={available}
				lspActive={false}
				message="saved"
				width={34}
				theme={darkTheme}
			/>,
			34,
			1,
		);
		expect(frame).toContain("saved");
		expect(frame).not.toContain("^R run");
	});
});

describe("LanguagePicker", () => {
	const languages: DetectedLanguage[] = [
		{
			language: python,
			toolchain: python.toolchains[0],
			binaries: { python3: "/usr/bin/python3" },
			version: "Python 3.12.0",
		},
		{ language: rust, binaries: {} },
	];

	test("shows uninstalled languages rather than hiding them", async () => {
		// The point of the picker: you learn code-repl supports Rust and that this
		// machine lacks rustc. Hiding it would look identical to no support.
		const frame = await frameOf(
			<LanguagePicker
				languages={languages}
				width={56}
				height={12}
				theme={darkTheme}
				onChoose={() => {}}
				onCancel={() => {}}
			/>,
			56,
			12,
		);
		expect(frame).toContain("Python");
		expect(frame).toContain("Rust");
		expect(frame).toContain("not installed");
	});

	test("typing filters the list", async () => {
		const setup = await testRender(
			<LanguagePicker
				languages={languages}
				width={56}
				height={12}
				theme={darkTheme}
				onChoose={() => {}}
				onCancel={() => {}}
			/>,
			{ width: 56, height: 12 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.typeText("rus");
			});
			await setup.renderOnce();
			const frame = setup.captureCharFrame();
			expect(frame).toContain("Rust");
			expect(frame).not.toContain("Python");
		} finally {
			setup.renderer.destroy();
		}
	});

	test("enter cannot choose a language with no toolchain", async () => {
		const chosen: string[] = [];
		const setup = await testRender(
			<LanguagePicker
				// Rust first, so the initial cursor sits on the unavailable entry.
				languages={[{ language: rust, binaries: {} }]}
				width={56}
				height={12}
				theme={darkTheme}
				onChoose={(d) => chosen.push(d.language.id)}
				onCancel={() => {}}
			/>,
			{ width: 56, height: 12 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.RETURN);
			});
			expect(chosen).toEqual([]);
		} finally {
			setup.renderer.destroy();
		}
	});

	test("escape cancels", async () => {
		let cancelled = false;
		const setup = await testRender(
			<LanguagePicker
				languages={languages}
				width={56}
				height={12}
				theme={darkTheme}
				onChoose={() => {}}
				onCancel={() => {
					cancelled = true;
				}}
			/>,
			{ width: 56, height: 12 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.ESCAPE);
				// A lone ESC is ambiguous with the start of an escape sequence, so
				// the parser holds it briefly before deciding it is the Escape key.
				await new Promise((resolve) => setTimeout(resolve, 100));
			});
			expect(cancelled).toBe(true);
		} finally {
			setup.renderer.destroy();
		}
	});
});

describe("HelpOverlay", () => {
	test("lists the run and buffer keys", async () => {
		const frame = await frameOf(
			<HelpOverlay
				width={50}
				height={20}
				theme={darkTheme}
				onClose={() => {}}
			/>,
			50,
			20,
		);
		expect(frame).toContain("ctrl+r");
		expect(frame).toContain("run the buffer");
		expect(frame).toContain("ctrl+w");
	});

	test("any key dismisses it", async () => {
		let closed = false;
		const setup = await testRender(
			<HelpOverlay
				width={50}
				height={20}
				theme={darkTheme}
				onClose={() => {
					closed = true;
				}}
			/>,
			{ width: 50, height: 20 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.typeText("x");
			});
			expect(closed).toBe(true);
		} finally {
			setup.renderer.destroy();
		}
	});
});

describe("SavePrompt", () => {
	test("shows the destination and a suggested name", async () => {
		const frame = await frameOf(
			<SavePrompt
				directory="/home/me/project"
				initialName="scratch.py"
				width={56}
				theme={darkTheme}
				onSubmit={() => {}}
				onCancel={() => {}}
			/>,
			56,
			5,
		);
		expect(frame).toContain("/home/me/project");
		expect(frame).toContain("scratch.py");
	});

	test("truncates a long directory from the left, keeping its tail", async () => {
		// The identifying part of a path is its end.
		const frame = await frameOf(
			<SavePrompt
				directory="/a/very/deeply/nested/directory/that/will/not/fit/at/all/here"
				initialName="x.ts"
				width={40}
				theme={darkTheme}
				onSubmit={() => {}}
				onCancel={() => {}}
			/>,
			40,
			5,
		);
		expect(frame).toContain("here");
		expect(frame).toContain("…");
	});

	test("typing edits the name and enter submits it", async () => {
		const submitted: string[] = [];
		const setup = await testRender(
			<SavePrompt
				directory="/tmp"
				initialName=""
				width={56}
				theme={darkTheme}
				onSubmit={(name) => submitted.push(name)}
				onCancel={() => {}}
			/>,
			{ width: 56, height: 5 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.typeText("notes.md");
			});
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.RETURN);
			});
			expect(submitted).toEqual(["notes.md"]);
		} finally {
			setup.renderer.destroy();
		}
	});

	test("an empty name is not submitted", async () => {
		// It would resolve to the directory itself.
		const submitted: string[] = [];
		const setup = await testRender(
			<SavePrompt
				directory="/tmp"
				initialName="   "
				width={56}
				theme={darkTheme}
				onSubmit={(name) => submitted.push(name)}
				onCancel={() => {}}
			/>,
			{ width: 56, height: 5 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.RETURN);
			});
			expect(submitted).toEqual([]);
		} finally {
			setup.renderer.destroy();
		}
	});

	test("backspace deletes and escape cancels", async () => {
		const submitted: string[] = [];
		let cancelled = false;
		const setup = await testRender(
			<SavePrompt
				directory="/tmp"
				initialName="abc"
				width={56}
				theme={darkTheme}
				onSubmit={(name) => submitted.push(name)}
				onCancel={() => {
					cancelled = true;
				}}
			/>,
			{ width: 56, height: 5 },
		);
		try {
			await setup.renderOnce();
			await act(async () => {
				await setup.mockInput.pressBackspace();
			});
			await setup.renderOnce();
			expect(setup.captureCharFrame()).toContain("ab");

			await act(async () => {
				await setup.mockInput.pressKey(KeyCodes.ESCAPE);
				await new Promise((resolve) => setTimeout(resolve, 100));
			});
			expect(cancelled).toBe(true);
			expect(submitted).toEqual([]);
		} finally {
			setup.renderer.destroy();
		}
	});
});
