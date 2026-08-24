import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadFile,
	looksBinary,
	MAX_FILE_BYTES,
	saveFile,
} from "../src/core/fs/files";
import {
	findNode,
	flatten,
	replaceChildren,
	scanDirectory,
	type TreeNode,
} from "../src/core/fs/tree";

const roots: string[] = [];

/** A throwaway directory tree, removed after each test. */
async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "code-repl-fs-"));
	roots.push(root);
	return root;
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("scanDirectory", () => {
	test("lists one level, directories first then alphabetical", async () => {
		const root = await fixture();
		await mkdir(join(root, "zeta"));
		await mkdir(join(root, "alpha"));
		await writeFile(join(root, "b.txt"), "");
		await writeFile(join(root, "A.txt"), "");

		const tree = await scanDirectory(root);
		expect(tree.children?.map((c) => c.name)).toEqual([
			"alpha",
			"zeta",
			"A.txt",
			"b.txt",
		]);
	});

	test("does not recurse: nested directories are left unscanned", async () => {
		const root = await fixture();
		await mkdir(join(root, "outer", "inner"), { recursive: true });

		const tree = await scanDirectory(root);
		const outer = tree.children?.[0];
		expect(outer?.name).toBe("outer");
		// `undefined`, not `[]` — the distinction is "not scanned" vs "empty".
		expect(outer?.children).toBeUndefined();
	});

	test("distinguishes an empty directory from an unscanned one", async () => {
		const root = await fixture();
		const tree = await scanDirectory(root);
		expect(tree.children).toEqual([]);
	});

	test("ignores version-control and dependency directories", async () => {
		const root = await fixture();
		for (const name of [".git", "node_modules", "target", "__pycache__"]) {
			await mkdir(join(root, name));
		}
		await writeFile(join(root, "keep.ts"), "");

		const tree = await scanDirectory(root);
		expect(tree.children?.map((c) => c.name)).toEqual(["keep.ts"]);
	});

	test("hides dotfiles unless asked", async () => {
		const root = await fixture();
		await writeFile(join(root, ".env"), "");
		await writeFile(join(root, "main.ts"), "");

		expect((await scanDirectory(root)).children?.map((c) => c.name)).toEqual([
			"main.ts",
		]);
		expect(
			(await scanDirectory(root, { showHidden: true })).children?.map(
				(c) => c.name,
			),
		).toEqual([".env", "main.ts"]);
	});

	test("accepts extra ignore names", async () => {
		const root = await fixture();
		await writeFile(join(root, "keep.ts"), "");
		await writeFile(join(root, "skip.ts"), "");

		const tree = await scanDirectory(root, { ignore: ["skip.ts"] });
		expect(tree.children?.map((c) => c.name)).toEqual(["keep.ts"]);
	});

	test("follows a symlink to a directory and classifies it as one", async () => {
		const root = await fixture();
		await mkdir(join(root, "real"));
		await symlink(join(root, "real"), join(root, "link"));

		const tree = await scanDirectory(root);
		const link = tree.children?.find((c) => c.name === "link");
		expect(link?.kind).toBe("directory");
	});

	test("skips a broken symlink rather than offering an unopenable file", async () => {
		const root = await fixture();
		await symlink(join(root, "gone"), join(root, "dangling"));
		await writeFile(join(root, "real.ts"), "");

		const tree = await scanDirectory(root);
		expect(tree.children?.map((c) => c.name)).toEqual(["real.ts"]);
	});

	test("reports an unreadable directory instead of rejecting", async () => {
		const tree = await scanDirectory("/definitely/not/a/directory");
		expect(tree.error).toBeTruthy();
		expect(tree.children).toEqual([]);
	});
});

describe("replaceChildren", () => {
	const tree: TreeNode = {
		path: "/root",
		name: "root",
		kind: "directory",
		children: [
			{ path: "/root/a", name: "a", kind: "directory" },
			{ path: "/root/b", name: "b", kind: "file" },
		],
	};

	test("fills in a nested directory's children", () => {
		const next = replaceChildren(tree, "/root/a", [
			{ path: "/root/a/x", name: "x", kind: "file" },
		]);
		expect(findNode(next, "/root/a")?.children?.[0]?.name).toBe("x");
	});

	test("shares untouched branches so React sees identity changes only where they happened", () => {
		const next = replaceChildren(tree, "/root/a", []);
		expect(next).not.toBe(tree);
		// The sibling was not rebuilt.
		expect(next.children?.[1]).toBe(tree.children?.[1]);
	});

	test("returns the tree unchanged for a path it does not contain", () => {
		expect(replaceChildren(tree, "/elsewhere", [])).toBe(tree);
	});

	test("records a scan error on the node", () => {
		const next = replaceChildren(tree, "/root/a", [], "EACCES");
		expect(findNode(next, "/root/a")?.error).toBe("EACCES");
	});
});

describe("flatten", () => {
	const tree: TreeNode = {
		path: "/root",
		name: "root",
		kind: "directory",
		children: [
			{
				path: "/root/src",
				name: "src",
				kind: "directory",
				children: [
					{ path: "/root/src/main.ts", name: "main.ts", kind: "file" },
				],
			},
			{ path: "/root/readme.md", name: "readme.md", kind: "file" },
		],
	};

	test("collapsed root yields a single row", () => {
		expect(flatten(tree, new Set()).map((r) => r.node.name)).toEqual(["root"]);
	});

	test("expanded directories contribute their children in order", () => {
		const rows = flatten(tree, new Set(["/root", "/root/src"]));
		expect(rows.map((r) => r.node.name)).toEqual([
			"root",
			"src",
			"main.ts",
			"readme.md",
		]);
	});

	test("depth reflects nesting", () => {
		const rows = flatten(tree, new Set(["/root", "/root/src"]));
		expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
	});

	test("expanding a directory whose children are unscanned adds no rows", () => {
		const unscanned: TreeNode = {
			path: "/root",
			name: "root",
			kind: "directory",
			children: [{ path: "/root/lazy", name: "lazy", kind: "directory" }],
		};
		const rows = flatten(unscanned, new Set(["/root", "/root/lazy"]));
		expect(rows.map((r) => r.node.name)).toEqual(["root", "lazy"]);
		expect(rows[1]?.expanded).toBe(true);
	});
});

describe("loadFile", () => {
	test("reads text", async () => {
		const root = await fixture();
		const path = join(root, "a.ts");
		await writeFile(path, "const x = 1\n");

		const result = await loadFile(path);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.text).toBe("const x = 1\n");
			expect(result.bytes).toBe(12);
		}
	});

	test("strips a UTF-8 BOM", async () => {
		const root = await fixture();
		const path = join(root, "bom.ts");
		await writeFile(path, "﻿const x = 1\n");

		const result = await loadFile(path);
		expect(result.ok && result.text.startsWith("const")).toBe(true);
	});

	test("refuses a binary file with a reason", async () => {
		const root = await fixture();
		const path = join(root, "blob.bin");
		await writeFile(path, new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]));

		const result = await loadFile(path);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("binary");
	});

	test("refuses an over-large file", async () => {
		const root = await fixture();
		const path = join(root, "big.txt");
		await writeFile(path, "x".repeat(MAX_FILE_BYTES + 1));

		const result = await loadFile(path);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("too-large");
	});

	test("reports a missing file rather than throwing", async () => {
		const result = await loadFile("/definitely/not/here.ts");
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unreadable");
	});

	test("keeps a mostly-UTF-8 file readable instead of refusing it", async () => {
		const root = await fixture();
		const path = join(root, "mixed.txt");
		// A stray invalid byte, no NUL: worth showing with a replacement char.
		await writeFile(path, new Uint8Array([0x68, 0x69, 0xff, 0x0a]));

		const result = await loadFile(path);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.text.startsWith("hi")).toBe(true);
	});
});

describe("saveFile", () => {
	test("writes, creating missing parent directories", async () => {
		const root = await fixture();
		const path = join(root, "deep", "nested", "a.ts");

		expect(await saveFile(path, "hello")).toEqual({ ok: true });
		expect(await Bun.file(path).text()).toBe("hello");
	});

	test("reports a failure instead of throwing, so the buffer can stay dirty", async () => {
		const result = await saveFile("/proc/definitely-not-writable/a.ts", "x");
		expect(result.ok).toBe(false);
	});
});

describe("looksBinary", () => {
	test("a NUL byte means binary", () => {
		expect(looksBinary(new Uint8Array([1, 2, 0, 3]))).toBe(true);
	});

	test("plain text is not binary", () => {
		expect(looksBinary(new TextEncoder().encode("hello\n\t世界"))).toBe(false);
	});

	test("empty input is not binary", () => {
		expect(looksBinary(new Uint8Array())).toBe(false);
	});
});
