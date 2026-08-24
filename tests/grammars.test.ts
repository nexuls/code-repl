import { describe, expect, test } from "bun:test";
import { LANGUAGES as REGISTRY } from "../src/core/languages/registry";
import * as grammars from "../src/lib/grammars";
import { LANGUAGES, languageFor, tokenize } from "../src/lib/highlight";

/** The token kind covering `column` on `line`, or "plain". */
function kindAt(
	source: string,
	language: string,
	line: number,
	column: number,
): string {
	const token = tokenize(source, languageFor(language))[line]?.find(
		(t) => t.start <= column && column < t.end,
	);
	return token?.kind ?? "plain";
}

/** Every kind present on a line, for coarse assertions. */
function kindsOn(source: string, language: string, line: number): string[] {
	return (tokenize(source, languageFor(language))[line] ?? []).map(
		(t) => t.kind,
	);
}

describe("grammar coverage", () => {
	test("every registry language resolves to its own grammar, not the fallback", () => {
		// A language highlighted with someone else's keyword list is worse than one
		// highlighted with none, so this must not silently regress.
		const missing = REGISTRY.filter(
			(lang) => languageFor(lang.highlight) === grammars.plainText,
		).map((lang) => `${lang.id} -> ${lang.highlight}`);
		expect(missing).toEqual([]);
	});

	test("an unknown language falls back to plain text, not TypeScript", () => {
		expect(languageFor("brainfuck")).toBe(grammars.plainText);
		// `const` must not be highlighted as a keyword in an unknown language.
		expect(kindAt("const x = 1", "brainfuck", 0, 0)).toBe("plain");
	});

	test("the fallback still highlights strings and numbers", () => {
		expect(kindsOn('"text" 42', "brainfuck", 0)).toEqual(["string", "number"]);
	});

	test("every grammar in the lookup table has a name", () => {
		for (const [key, spec] of Object.entries(LANGUAGES)) {
			expect(spec.name.length).toBeGreaterThan(0);
			expect(key).toBe(key.toLowerCase());
		}
	});
});

describe("comment syntax per language", () => {
	test.each([
		["python", "# note", 0],
		["ruby", "# note", 0],
		["bash", "# note", 0],
		["lua", "-- note", 0],
		["haskell", "-- note", 0],
		["clojure", "; note", 0],
		["go", "// note", 0],
		["rust", "// note", 0],
	])("%s treats %p as a comment", (language, source, column) => {
		expect(kindAt(source, language, 0, column as number)).toBe("comment");
	});

	test("Lua block comments span lines", () => {
		const source = "--[[ spanning\nstill comment ]]\nx = 1";
		expect(kindAt(source, "lua", 1, 0)).toBe("comment");
		expect(kindAt(source, "lua", 2, 0)).toBe("plain");
	});

	test("Haskell block comments use {- -}", () => {
		expect(kindAt("{- note -}", "haskell", 0, 1)).toBe("comment");
	});

	test("OCaml has no line comment, only (* *)", () => {
		expect(kindAt("(* note *)", "ocaml", 0, 1)).toBe("comment");
		// `//` is division in OCaml-ish code, not a comment.
		expect(kindAt("// note", "ocaml", 0, 0)).not.toBe("comment");
	});

	test("Julia uses #= =# for blocks", () => {
		expect(kindAt("#= note =#", "julia", 0, 1)).toBe("comment");
	});

	test("Nim uses #[ ]# for blocks", () => {
		expect(kindAt("#[ note ]#", "nim", 0, 1)).toBe("comment");
	});
});

describe("triple-quoted strings", () => {
	test("a Python docstring spans lines", () => {
		const source = '"""line one\nline two"""\nx = 1';
		expect(kindAt(source, "python", 0, 0)).toBe("string");
		expect(kindAt(source, "python", 1, 0)).toBe("string");
		// The string ends; the next line is code again.
		expect(kindAt(source, "python", 2, 0)).toBe("plain");
	});

	test("single-quoted triples work too", () => {
		const source = "'''doc'''";
		expect(kindAt(source, "python", 0, 3)).toBe("string");
	});

	test("an unterminated docstring runs to end of file rather than derailing", () => {
		const source = '"""never closed\nmore text';
		expect(kindAt(source, "python", 1, 0)).toBe("string");
	});

	test("a triple quote is not read as two empty strings", () => {
		// The bug this guards: `"""` scanning as `""` plus an unterminated `"`,
		// which mis-colours the entire rest of the file.
		const kinds = kindsOn('"""a"""', "python", 0);
		expect(kinds).toEqual(["string"]);
	});

	test("languages without the flag keep single-line string semantics", () => {
		const source = '"""a"""';
		// Go has no triple-quoted form, so this is three separate strings.
		expect(kindsOn(source, "go", 0).length).toBeGreaterThan(1);
	});
});

describe("keyword classification", () => {
	test("Go distinguishes declarations, control flow, and types", () => {
		const source = "func main() {\n\tfor i := range xs {\n\t}\n}";
		expect(kindAt(source, "go", 0, 0)).toBe("keyword"); // func
		expect(kindAt(source, "go", 1, 1)).toBe("control"); // for
	});

	test("Rust marks Option/Result variants as literals", () => {
		expect(kindAt("let x = Some(1)", "rust", 0, 8)).toBe("literal");
		expect(kindAt("let x = None", "rust", 0, 8)).toBe("literal");
	});

	test("R's TRUE/NA are literals, not identifiers", () => {
		expect(kindAt("x <- TRUE", "r", 0, 5)).toBe("literal");
		expect(kindAt("y <- NA", "r", 0, 5)).toBe("literal");
	});

	test("C types and keywords are separated", () => {
		expect(kindAt("static int main(void)", "c", 0, 0)).toBe("keyword");
		expect(kindAt("static int main(void)", "c", 0, 7)).toBe("type");
	});

	test("Clojure def forms are keywords despite the punctuation", () => {
		expect(kindAt("(defn f [] 1)", "clojure", 0, 1)).toBe("keyword");
	});

	test("shell keywords are recognised in both branches of an if", () => {
		const source = "if [ -f x ]; then\n\techo hi\nfi";
		expect(kindAt(source, "bash", 0, 0)).toBe("control"); // if
		expect(kindAt(source, "bash", 2, 0)).toBe("control"); // fi
		expect(kindAt(source, "bash", 1, 1)).toBe("keyword"); // echo
	});

	test("zsh and fish reuse the Bash grammar", () => {
		expect(languageFor("zsh")).toBe(grammars.bash);
		expect(languageFor("fish")).toBe(grammars.bash);
	});
});

describe("regex literals", () => {
	test("Perl allows them; Go does not", () => {
		expect(kindAt("$x =~ /ab+c/;", "perl", 0, 6)).toBe("regex");
		// In Go a bare `/` is division, and treating it as a regex would swallow
		// the rest of the line.
		expect(kindAt("a := b / c", "go", 0, 7)).toBe("operator");
	});
});
