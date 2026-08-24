import { expect, test } from "bun:test";
import { languageFor, sliceTokens, tokenize } from "../src/lib/highlight";

const ts = languageFor("typescript");

/** Helper: the kind covering `column` on `line`, or "plain". */
function kindAt(source: string, line: number, column: number): string {
	const token = tokenize(source, ts)[line]?.find((t) => t.start <= column && column < t.end);
	return token?.kind ?? "plain";
}

test("classifies keywords, control flow, numbers, and calls", () => {
	const src = `const n = 42\nif (n) render(n)`;
	expect(kindAt(src, 0, 0)).toBe("keyword");
	expect(kindAt(src, 0, 10)).toBe("number");
	expect(kindAt(src, 1, 0)).toBe("control");
	expect(kindAt(src, 1, 7)).toBe("function");
});

test("block comments span lines", () => {
	const src = `a\n/* one\n   two */ b`;
	expect(kindAt(src, 1, 0)).toBe("comment");
	expect(kindAt(src, 2, 3)).toBe("comment");
	expect(kindAt(src, 2, 11)).toBe("plain");
});

test("template literals keep interpolations as code", () => {
	const src = "const s = `hi ${name.first} !`";
	expect(kindAt(src, 0, 11)).toBe("template"); // "hi "
	expect(kindAt(src, 0, 16)).toBe("plain"); // name
	expect(kindAt(src, 0, 21)).toBe("property"); // first
	expect(kindAt(src, 0, 27)).toBe("template"); // " !`"
});

test("distinguishes regex literals from division", () => {
	expect(kindAt("const re = /a\\/b[/]c/g", 0, 11)).toBe("regex");
	expect(kindAt("const q = total / count", 0, 16)).toBe("operator");
});

test("unterminated strings stop at the line break", () => {
	const src = `const s = "oops\nconst t = 1`;
	expect(kindAt(src, 0, 12)).toBe("string");
	expect(kindAt(src, 1, 0)).toBe("keyword");
});

test("python and json use their own grammars", () => {
	const py = tokenize("def go():\n    # note\n    return None", languageFor("python"));
	expect(py[0]![0]!.kind).toBe("keyword");
	expect(py[1]![0]!.kind).toBe("comment");
	const js = tokenize('{"a": true}', languageFor("json"));
	expect(js[0]!.find((t) => t.start === 6)!.kind).toBe("literal");
});

test("sliceTokens clips to the horizontal window", () => {
	const tokens = [
		{ start: 0, end: 5, kind: "keyword" as const },
		{ start: 6, end: 12, kind: "string" as const },
	];
	expect(sliceTokens(tokens, 3, 8)).toEqual([
		{ start: 0, end: 2, kind: "keyword" },
		{ start: 3, end: 5, kind: "string" },
	]);
});
