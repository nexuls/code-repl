/**
 * Root component: layout, pane focus, and the global keymap.
 *
 * `App` is the only place where state transitions meet side effects. Reducers in
 * `state/` decide *what* the session becomes; `core/` performs the IO; this
 * component sequences the two — read a file, then dispatch what was read.
 *
 * It deliberately holds no derived state of its own. Anything that can be
 * computed from the session is computed on render, so there is one source of
 * truth and no pair of fields that can disagree.
 */

import {
	useKeyboard,
	useRenderer,
	useTerminalDimensions,
} from "@opentui/react";
import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { CodeEditor } from "../components/CodeEditor";
import { FileTree } from "../components/FileTree";
import { HelpOverlay } from "../components/HelpOverlay";
import { LanguagePicker } from "../components/LanguagePicker";
import { OutputPanel } from "../components/OutputPanel";
import { StatusBar } from "../components/StatusBar";
import { TabBar } from "../components/TabBar";
import { loadFile, saveFile } from "../core/fs/files";
import { scanDirectory } from "../core/fs/tree";
import {
	type DetectedLanguage,
	detectAll,
	isAvailable,
} from "../core/languages/detect";
import {
	type Language,
	languageById,
	languageForFilename,
} from "../core/languages/registry";
import { LspManager } from "../core/lsp/manager";
import {
	describeResult,
	NoToolchainError,
	type RunHandle,
	ScratchSpace,
	startRun,
} from "../core/runner";
import { darkTheme } from "../lib/theme";
import {
	initialSession,
	type SessionState,
	sessionReducer,
} from "./state/session";
import { activeTab, dirtyTabs, fileTab, scratchTab } from "./state/tabs";

export interface AppProps {
	/** Folder to open at startup, from argv. */
	readonly initialFolder?: string;
	/** File to open at startup, from argv. */
	readonly initialFile?: string;
	/** Language for the initial scratch buffer when no file was given. */
	readonly initialLanguage?: string;
}

/** Minimum terminal width before the tree pane is dropped to keep the editor usable. */
const TREE_MIN_TOTAL_WIDTH = 70;
const TREE_WIDTH = 28;
/** Fraction of the height given to output when it is visible. */
const OUTPUT_FRACTION = 0.32;

export function App({
	initialFolder,
	initialFile,
	initialLanguage = "typescript",
}: AppProps) {
	const renderer = useRenderer();
	const { width, height } = useTerminalDimensions();
	const [session, dispatch] = useReducer(sessionReducer, initialSession);
	const [languages, setLanguages] = useState<readonly DetectedLanguage[]>([]);

	// Long-lived, non-render state. Refs rather than state because changing them
	// must not trigger a render — a run handle changing is not a visual event.
	const scratch = useRef<ScratchSpace | undefined>(undefined);
	const lsp = useRef<LspManager | undefined>(undefined);
	const runs = useRef(new Map<string, RunHandle>());

	const tab = activeTab(session.tabs);
	const detected = useMemo(
		() => languages.find((d) => d.language.id === tab?.language.id),
		[languages, tab?.language.id],
	);

	// ---------------------------------------------------------------- lifecycle

	// Detection runs once, in the background. The UI paints immediately and the
	// language list fills in — probing ~40 binaries must not delay first draw.
	useEffect(() => {
		let cancelled = false;
		detectAll().then((result) => {
			if (!cancelled) setLanguages(result);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		scratch.current = new ScratchSpace();
		lsp.current = new LspManager({
			root: initialFolder ?? process.cwd(),
			onDiagnostics: (path, diagnostics) =>
				dispatch({
					type: "tabs",
					action: { type: "diagnostics", path, diagnostics },
				}),
		});

		const space = scratch.current;
		const manager = lsp.current;
		return () => {
			// Every exit path must clean up: scratch files removed, servers stopped.
			for (const handle of runs.current.values()) handle.cancel();
			void space.dispose();
			void manager.dispose();
		};
	}, [initialFolder]);

	// Open whatever argv asked for, once the language table is available so the
	// buffer gets the right grammar from its first frame.
	const bootstrapped = useRef(false);
	// Runs exactly once, guarded by `bootstrapped`. Listing the argv props and the
	// open callbacks would re-fire it whenever a callback identity changed, which
	// is every render.
	// biome-ignore lint/correctness/useExhaustiveDependencies: one-shot bootstrap
	useEffect(() => {
		if (bootstrapped.current || languages.length === 0) return;
		bootstrapped.current = true;

		if (initialFolder) void openFolder(initialFolder);
		if (initialFile) {
			void openPath(initialFile);
		} else {
			const language = languageById(initialLanguage) ?? languages[0]?.language;
			if (language) {
				dispatch({
					type: "tabs",
					action: { type: "open", tab: scratchTab(language) },
				});
			}
		}
	}, [languages.length]);

	// ------------------------------------------------------------------ actions

	const setStatus = useCallback((message?: string) => {
		dispatch({ type: "status", message });
	}, []);

	const openFolder = useCallback(async (path: string) => {
		const tree = await scanDirectory(path);
		dispatch({ type: "workspace", action: { type: "set-root", tree } });
	}, []);

	const openPath = useCallback(
		async (path: string) => {
			const result = await loadFile(path);
			if (!result.ok) {
				// A binary or oversized file is an ordinary thing to click on, so it
				// reports in the status bar rather than as an error.
				setStatus(`${path.split("/").pop()}: ${result.message}`);
				return;
			}
			const language =
				languageForFilename(path) ??
				languageById("text") ??
				languages[0]?.language;
			if (!language) return;

			const created = fileTab(path, language, result.text);
			dispatch({ type: "tabs", action: { type: "open", tab: created } });
			dispatch({ type: "focus", pane: "editor" });
			void lsp.current?.openDocument(path, language.id, result.text);
		},
		[languages, setStatus],
	);

	const expandDirectory = useCallback(
		async (path: string) => {
			const state = session.workspace;
			// Collapsing needs no IO; only a first expansion does.
			if (state.expanded.has(path)) {
				dispatch({ type: "workspace", action: { type: "collapse", path } });
				return;
			}
			dispatch({ type: "workspace", action: { type: "expand", path } });

			const node = findExpanded(state, path);
			if (node?.children) return; // Already scanned.

			dispatch({ type: "workspace", action: { type: "loading", path } });
			const scanned = await scanDirectory(path, {
				showHidden: state.showHidden,
			});
			dispatch({
				type: "workspace",
				action: {
					type: "children",
					path,
					children: scanned.children ?? [],
					error: scanned.error,
				},
			});
		},
		[session.workspace],
	);

	const save = useCallback(async () => {
		if (!tab) return;
		if (!tab.path) {
			// A scratch buffer has nowhere to go. Rather than inventing a path, say
			// so — the file tree is how you choose one.
			setStatus("scratch buffer has no path — open a folder to save into it");
			return;
		}
		const result = await saveFile(tab.path, tab.text);
		if (!result.ok) {
			setStatus(`could not save: ${result.message}`);
			return;
		}
		dispatch({
			type: "tabs",
			action: {
				type: "saved",
				id: tab.id,
				path: tab.path,
				title: tab.path.slice(tab.path.lastIndexOf("/") + 1),
			},
		});
		setStatus("saved");
	}, [tab, setStatus]);

	const run = useCallback(async () => {
		if (!tab || !scratch.current) return;

		// A second run of the same buffer replaces the first rather than racing it.
		runs.current.get(tab.id)?.cancel();

		const languageDetection = languages.find(
			(d) => d.language.id === tab.language.id,
		);
		if (!languageDetection || !isAvailable(languageDetection)) {
			setStatus(`no installed toolchain for ${tab.language.name}`);
			return;
		}

		dispatch({ type: "tabs", action: { type: "run-started", id: tab.id } });
		setStatus(undefined);

		try {
			const handle = await startRun(scratch.current, {
				slot: tab.id,
				detected: languageDetection,
				source: tab.text,
				onOutput: (chunk) =>
					dispatch({
						type: "tabs",
						action: { type: "run-output", id: tab.id, chunk },
					}),
			});
			runs.current.set(tab.id, handle);

			const result = await handle.done;
			runs.current.delete(tab.id);
			dispatch({
				type: "tabs",
				action: {
					type: "run-finished",
					id: tab.id,
					status: result.status,
					summary: describeResult(result),
				},
			});
		} catch (error) {
			const message =
				error instanceof NoToolchainError
					? error.message
					: `run failed: ${error instanceof Error ? error.message : String(error)}`;
			dispatch({
				type: "tabs",
				action: {
					type: "run-finished",
					id: tab.id,
					status: "spawn-error",
					summary: message,
				},
			});
			setStatus(message);
		}
	}, [tab, languages, setStatus]);

	/**
	 * Completion source for the editor.
	 *
	 * Returns `[]` for an unsaved buffer as well as for a missing server: LSP
	 * addresses documents by URI, and a scratch buffer has no path to build one
	 * from. Empty is the correct answer either way — the popup simply does not
	 * appear.
	 */
	const completionProvider = useCallback(
		async (line: number, character: number) => {
			if (!tab?.path || !lsp.current) return [];
			return lsp.current.completion(tab.path, tab.language.id, {
				line,
				character,
			});
		},
		[tab?.path, tab?.language.id],
	);

	const quit = useCallback(() => {
		renderer.destroy();
		process.exit(0);
	}, [renderer]);

	// ------------------------------------------------------------- global keymap

	useKeyboard((key) => {
		// An overlay owns the keyboard while it is up, apart from the quit key.
		if (session.overlay.kind !== "none") {
			if (key.ctrl && key.name === "c") quit();
			return;
		}

		if (key.ctrl) {
			switch (key.name) {
				case "c":
				case "q": {
					const dirty = dirtyTabs(session.tabs);
					if (dirty.length > 0) {
						dispatch({
							type: "overlay",
							overlay: { kind: "confirm-quit", dirtyCount: dirty.length },
						});
						return;
					}
					quit();
					return;
				}
				case "r":
					void run();
					return;
				case "s":
					void save();
					return;
				case "n":
					dispatch({
						type: "tabs",
						action: {
							type: "open",
							tab: scratchTab(tab?.language ?? languages[0]!.language),
						},
					});
					return;
				case "w":
					if (tab) {
						runs.current.get(tab.id)?.cancel();
						runs.current.delete(tab.id);
						if (tab.path) lsp.current?.closeDocument(tab.path, tab.language.id);
						dispatch({ type: "tabs", action: { type: "close", id: tab.id } });
					}
					return;
				case "p":
					dispatch({ type: "overlay", overlay: { kind: "languages" } });
					return;
				case "b":
					dispatch({ type: "toggle-tree" });
					return;
				case "j":
					dispatch({ type: "toggle-output" });
					return;
				case "l":
					if (tab)
						dispatch({
							type: "tabs",
							action: { type: "clear-output", id: tab.id },
						});
					return;
				case "e":
					// Cancel a run in progress. Distinct from ctrl+c, which quits.
					if (tab) {
						runs.current.get(tab.id)?.cancel();
						setStatus("cancelled");
					}
					return;
			}
			// Ctrl+/ arrives as a control character rather than a named key.
			if (key.sequence === "" || key.name === "/") {
				dispatch({ type: "overlay", overlay: { kind: "help" } });
				return;
			}
			return;
		}

		if (key.name === "tab" && key.shift) {
			dispatch({ type: "cycle-pane" });
			return;
		}
		// Alt+arrow switches tabs from anywhere, including mid-edit, since plain
		// arrows belong to whichever pane has focus.
		if (key.meta && key.name === "left") {
			dispatch({ type: "tabs", action: { type: "previous" } });
			return;
		}
		if (key.meta && key.name === "right") {
			dispatch({ type: "tabs", action: { type: "next" } });
			return;
		}
	});

	// --------------------------------------------------------------------- layout

	// The tree is dropped on a narrow terminal: 28 columns of file names are not
	// worth an unusable editor.
	const showTree = session.treeVisible && width >= TREE_MIN_TOTAL_WIDTH;
	const treeWidth = showTree ? TREE_WIDTH : 0;
	const mainWidth = width - treeWidth;

	const tabBarHeight = 1;
	const statusHeight = 1;
	const bodyHeight = Math.max(1, height - tabBarHeight - statusHeight);
	const outputHeight = session.outputVisible
		? Math.max(4, Math.round(bodyHeight * OUTPUT_FRACTION))
		: 0;
	const editorHeight = Math.max(3, bodyHeight - outputHeight);

	return (
		<box
			width={width}
			height={height}
			flexDirection="column"
			backgroundColor={darkTheme.background}
		>
			<TabBar
				tabs={session.tabs.tabs}
				active={session.tabs.active}
				width={width}
				theme={darkTheme}
				onSelect={(index) => {
					dispatch({ type: "tabs", action: { type: "select", index } });
					dispatch({ type: "focus", pane: "editor" });
				}}
				onClose={(id) =>
					dispatch({ type: "tabs", action: { type: "close", id } })
				}
			/>

			<box flexDirection="row" width={width} height={bodyHeight}>
				{showTree ? (
					<FileTree
						workspace={session.workspace}
						width={treeWidth}
						height={bodyHeight}
						focused={session.pane === "tree"}
						theme={darkTheme}
						onMove={(delta) =>
							dispatch({
								type: "workspace",
								action: { type: "move-selection", delta },
							})
						}
						onSelect={(path) =>
							dispatch({ type: "workspace", action: { type: "select", path } })
						}
						onToggle={(path) => void expandDirectory(path)}
						onOpen={(path) => void openPath(path)}
					/>
				) : null}

				<box flexDirection="column" width={mainWidth} height={bodyHeight}>
					{tab ? (
						<CodeEditor
							// Keying by tab id gives each buffer its own editor state, so
							// switching tabs restores the cursor rather than sharing one.
							key={tab.id}
							value={tab.text}
							language={tab.language.highlight}
							filename={tab.title}
							width={mainWidth}
							height={editorHeight}
							focused={session.pane === "editor"}
							theme={darkTheme}
							diagnostics={tab.diagnostics}
							completionProvider={completionProvider}
							onChange={(text) => {
								dispatch({
									type: "tabs",
									action: { type: "edit", id: tab.id, text },
								});
								if (tab.path) {
									lsp.current?.changeDocument(tab.path, tab.language.id, text);
								}
							}}
							onSave={() => void save()}
						/>
					) : (
						<box
							width={mainWidth}
							height={editorHeight}
							border
							borderColor={darkTheme.border}
							backgroundColor={darkTheme.background}
						/>
					)}

					{session.outputVisible ? (
						<OutputPanel
							output={tab?.output ?? []}
							running={tab?.running ?? false}
							summary={tab?.runSummary}
							width={mainWidth}
							height={outputHeight}
							focused={session.pane === "output"}
							theme={darkTheme}
						/>
					) : null}
				</box>
			</box>

			<StatusBar
				tab={tab}
				detected={detected}
				lspActive={(lsp.current?.runningServers().length ?? 0) > 0}
				message={session.status}
				width={width}
				theme={darkTheme}
			/>

			{session.overlay.kind === "languages" ? (
				<box
					position="absolute"
					left={Math.max(0, Math.floor((width - 60) / 2))}
					top={2}
				>
					<LanguagePicker
						languages={languages}
						width={Math.min(60, width)}
						height={Math.min(20, height - 4)}
						theme={darkTheme}
						onChoose={(chosen) => {
							dispatch({ type: "overlay", overlay: { kind: "none" } });
							changeLanguage(chosen.language);
						}}
						onCancel={() =>
							dispatch({ type: "overlay", overlay: { kind: "none" } })
						}
					/>
				</box>
			) : null}

			{session.overlay.kind === "help" ? (
				<box
					position="absolute"
					left={Math.max(0, Math.floor((width - 54) / 2))}
					top={2}
				>
					<HelpOverlay
						width={Math.min(54, width)}
						height={Math.min(22, height - 4)}
						theme={darkTheme}
						onClose={() =>
							dispatch({ type: "overlay", overlay: { kind: "none" } })
						}
					/>
				</box>
			) : null}

			{session.overlay.kind === "confirm-quit" ? (
				<ConfirmQuit
					count={session.overlay.dirtyCount}
					width={width}
					height={height}
					onConfirm={quit}
					onCancel={() =>
						dispatch({ type: "overlay", overlay: { kind: "none" } })
					}
				/>
			) : null}
		</box>
	);

	/** Retarget the active buffer at a different language. */
	function changeLanguage(language: Language) {
		if (!tab) {
			dispatch({
				type: "tabs",
				action: { type: "open", tab: scratchTab(language) },
			});
			return;
		}
		dispatch({
			type: "tabs",
			action: { type: "set-language", id: tab.id, language },
		});
	}
}

/** Locate a node in the current tree, for deciding whether a scan is needed. */
function findExpanded(state: SessionState["workspace"], path: string) {
	if (!state.tree) return undefined;
	const stack = [state.tree];
	while (stack.length > 0) {
		const node = stack.pop()!;
		if (node.path === path) return node;
		if (node.children) stack.push(...node.children);
	}
	return undefined;
}

interface ConfirmQuitProps {
	readonly count: number;
	readonly width: number;
	readonly height: number;
	readonly onConfirm: () => void;
	readonly onCancel: () => void;
}

/**
 * Quit confirmation. Deliberately modal and deliberately not defaulted to quit:
 * losing unsaved work to a mistyped ctrl+c is the one unrecoverable thing this
 * app can do.
 */
function ConfirmQuit({
	count,
	width,
	height,
	onConfirm,
	onCancel,
}: ConfirmQuitProps) {
	useKeyboard((key) => {
		if (key.name === "y") onConfirm();
		else if (key.name === "n" || key.name === "escape") onCancel();
	});

	const boxWidth = Math.min(52, width);
	return (
		<box
			position="absolute"
			left={Math.max(0, Math.floor((width - boxWidth) / 2))}
			top={Math.max(0, Math.floor(height / 2) - 2)}
			width={boxWidth}
			height={5}
			border
			borderColor={darkTheme.warning}
			backgroundColor={darkTheme.elevated}
			flexDirection="column"
			zIndex={20}
		>
			<text
				content={` ${count} buffer${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} unsaved changes.`}
				fg={darkTheme.text}
				bg={darkTheme.elevated}
			/>
			<text
				content=" quit anyway?  y / n "
				fg={darkTheme.warning}
				bg={darkTheme.elevated}
			/>
		</box>
	);
}
