/**
 * Directory scanning for the file tree.
 *
 * Scanning is **one level at a time**. Opening a monorepo must feel instant, so
 * nothing recurses eagerly: a directory's children are read when it is expanded
 * and cached until it is collapsed or reloaded.
 *
 * The tree is also flattened on demand into a list of visible rows, which lets
 * the view be a simple virtualised list instead of a recursive component.
 */

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

/** One entry in the file tree. Directories are scanned lazily; see `children`. */
export interface TreeNode {
	/** Absolute path; also the node's identity in the expansion set. */
	readonly path: string;
	/** Final path segment, which is what the tree displays. */
	readonly name: string;
	readonly kind: "file" | "directory";
	/**
	 * Children, or `undefined` for a directory that has not been scanned yet.
	 * An empty array means "scanned, genuinely empty" — the distinction is what
	 * lets the view show a spinner exactly once.
	 */
	readonly children?: readonly TreeNode[];
	/** Set when scanning this directory failed, e.g. on a permission error. */
	readonly error?: string;
}

/** A flattened, renderable row. */
export interface TreeRow {
	readonly node: TreeNode;
	/** Nesting depth; the root is 0. */
	readonly depth: number;
	readonly expanded: boolean;
}

/**
 * Names never shown in the tree. Version-control and dependency directories
 * dominate the row count while almost never being what someone opened the folder
 * to look at.
 */
const IGNORED = new Set([
	".git",
	".hg",
	".svn",
	"node_modules",
	".venv",
	"venv",
	"__pycache__",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	"target",
	"dist",
	"build",
	".next",
	".turbo",
	".cache",
	".DS_Store",
	".idea",
]);

/** What to include when reading a directory. */
export interface ScanOptions {
	/** Show dot-files. Default false. */
	readonly showHidden?: boolean;
	/** Extra names to ignore, merged with the built-in list. */
	readonly ignore?: readonly string[];
}

/**
 * Read one directory level.
 *
 * Never rejects: an unreadable directory comes back as a node carrying `error`,
 * because a single permission-denied folder should not blank the whole tree.
 */
export async function scanDirectory(
	path: string,
	options: ScanOptions = {},
): Promise<TreeNode> {
	const name = basename(path) || path;
	const ignore = options.ignore
		? new Set([...IGNORED, ...options.ignore])
		: IGNORED;

	// Annotated explicitly: `readdir`'s overloads otherwise infer the Buffer-name
	// variant, and every `entry.name` becomes a Buffer.
	let entries: Dirent[];
	try {
		entries = await readdir(path, { withFileTypes: true });
	} catch (error) {
		return {
			path,
			name,
			kind: "directory",
			children: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}

	const children: TreeNode[] = [];
	for (const entry of entries) {
		if (ignore.has(entry.name)) continue;
		if (!options.showHidden && entry.name.startsWith(".")) continue;

		// A symlink reports neither file nor directory from the dirent, so its
		// target is stat'd. A broken link is skipped rather than shown as a file
		// that cannot be opened.
		let isDirectory = entry.isDirectory();
		if (entry.isSymbolicLink()) {
			try {
				isDirectory = (await stat(join(path, entry.name))).isDirectory();
			} catch {
				continue;
			}
		} else if (!entry.isFile() && !isDirectory) {
			continue; // Sockets, FIFOs, devices.
		}

		children.push({
			path: join(path, entry.name),
			name: entry.name,
			kind: isDirectory ? "directory" : "file",
		});
	}

	return { path, name, kind: "directory", children: sortNodes(children) };
}

/** Directories first, then case-insensitive by name — the familiar ordering. */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
	return nodes.sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
}

/**
 * Return a copy of `tree` with `path`'s children replaced.
 *
 * Structural sharing: only the nodes on the path from the root to `path` are
 * rebuilt, so React sees new identities exactly where something changed.
 * Returns `tree` unchanged when `path` is not in it.
 */
export function replaceChildren(
	tree: TreeNode,
	path: string,
	children: readonly TreeNode[],
	error?: string,
): TreeNode {
	if (tree.path === path) return { ...tree, children, error };
	if (!tree.children) return tree;
	// `path` can only be inside this subtree if it is prefixed by it, which saves
	// walking every sibling branch of a large tree.
	if (!path.startsWith(`${tree.path}/`)) return tree;

	let changed = false;
	const next = tree.children.map((child) => {
		const replaced = replaceChildren(child, path, children, error);
		if (replaced !== child) changed = true;
		return replaced;
	});
	return changed ? { ...tree, children: next } : tree;
}

/** Find a node by absolute path, or `undefined`. */
export function findNode(tree: TreeNode, path: string): TreeNode | undefined {
	if (tree.path === path) return tree;
	if (!tree.children || !path.startsWith(`${tree.path}/`)) return undefined;
	for (const child of tree.children) {
		const found = findNode(child, path);
		if (found) return found;
	}
	return undefined;
}

/**
 * Flatten the tree into the rows currently visible, given the set of expanded
 * directory paths. The root itself is included as the first row.
 */
export function flatten(
	tree: TreeNode,
	expanded: ReadonlySet<string>,
	depth = 0,
): TreeRow[] {
	const isExpanded = tree.kind === "directory" && expanded.has(tree.path);
	const rows: TreeRow[] = [{ node: tree, depth, expanded: isExpanded }];
	if (isExpanded && tree.children) {
		for (const child of tree.children) {
			rows.push(...flatten(child, expanded, depth + 1));
		}
	}
	return rows;
}
