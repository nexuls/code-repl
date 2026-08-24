/**
 * The static table of languages code-repl knows how to run.
 *
 * This module is data, not behaviour: it declares *what could* run a snippet,
 * never checks whether it is installed, and never spawns anything. Probing
 * `PATH` is `./detect.ts`; turning a plan into processes is `../runner/`.
 *
 * Adding a language means adding one entry here. Nothing else needs to change.
 */

/** A single process to run, in order, as part of executing a snippet. */
export interface RunStep {
	/** Label shown in the output pane while the step runs, e.g. "compile". */
	readonly label: string;
	/** Executable name; resolved against PATH by the runner. */
	readonly command: string;
	readonly args: readonly string[];
}

/** Everything a toolchain needs to know to build its run steps. */
export interface PlanContext {
	/** Absolute path of the written source file. */
	readonly file: string;
	/** Absolute path of the scratch directory holding it. */
	readonly dir: string;
	/** File name without its extension — used for compiler output names. */
	readonly stem: string;
	/** Platform-appropriate name for a compiled binary (`.exe` on Windows). */
	readonly binary: string;
}

/**
 * One way to run a language. A language lists several in preference order —
 * TypeScript may be run by `bun`, `deno`, or `tsx`, and whichever is installed
 * first wins.
 */
export interface Toolchain {
	/** Short identifier, unique within its language. */
	readonly id: string;
	/**
	 * Executables that must *all* be present for this toolchain to be usable.
	 * Java needs `javac` and `java`; Python needs only `python3`.
	 */
	readonly requires: readonly string[];
	/** Arguments that make the primary executable print its version. */
	readonly versionArgs: readonly string[];
	/**
	 * Steps to compile and run the snippet. A single step means the language is
	 * interpreted; two or more mean it is compiled first.
	 */
	plan(ctx: PlanContext): readonly RunStep[];
}

/** One language: how to recognise it, highlight it, and run it. */
export interface Language {
	/** Stable identifier used in state, tab metadata, and tests. */
	readonly id: string;
	/** Name shown in the UI. */
	readonly name: string;
	/** Extension used when writing a scratch file, without the dot. */
	readonly extension: string;
	/**
	 * Extensions that map to this language when opening a file. Includes
	 * `extension` itself.
	 */
	readonly extensions: readonly string[];
	/** Grammar name passed to `lib/highlight.ts`. */
	readonly highlight: string;
	/** Line-comment token, used for the generated scratch-file header. */
	readonly lineComment: string;
	/** Toolchains in preference order; the first fully installed one is used. */
	readonly toolchains: readonly Toolchain[];
	/** A minimal runnable snippet, used when opening a fresh scratch tab. */
	readonly template: string;
}

/** Shorthand for the common case: one executable, one step, no compilation. */
function interpreted(
	id: string,
	bin: string,
	options: {
		versionArgs?: readonly string[];
		/** Arguments before the file path, e.g. `["-e"]` or `["run"]`. */
		leading?: readonly string[];
		requires?: readonly string[];
	} = {},
): Toolchain {
	return {
		id,
		requires: options.requires ?? [bin],
		versionArgs: options.versionArgs ?? ["--version"],
		plan: ({ file }) => [
			{
				label: "run",
				command: bin,
				args: [...(options.leading ?? []), file],
			},
		],
	};
}

const LANGUAGE_LIST: readonly Language[] = [
	{
		id: "typescript",
		name: "TypeScript",
		extension: "ts",
		extensions: ["ts", "mts", "cts", "tsx"],
		highlight: "typescript",
		lineComment: "//",
		// Bun and Deno run TypeScript directly; ts-node/tsx are the Node fallbacks.
		toolchains: [
			interpreted("bun", "bun", { leading: ["run"] }),
			interpreted("deno", "deno", { leading: ["run", "-A"] }),
			interpreted("tsx", "tsx"),
			interpreted("ts-node", "ts-node"),
		],
		template: 'console.log("hello from TypeScript")\n',
	},
	{
		id: "javascript",
		name: "JavaScript",
		extension: "js",
		extensions: ["js", "mjs", "cjs", "jsx"],
		highlight: "javascript",
		lineComment: "//",
		toolchains: [
			interpreted("node", "node"),
			interpreted("bun", "bun", { leading: ["run"] }),
			interpreted("deno", "deno", { leading: ["run", "-A"] }),
		],
		template: 'console.log("hello from JavaScript")\n',
	},
	{
		id: "python",
		name: "Python",
		extension: "py",
		extensions: ["py", "pyw"],
		highlight: "python",
		lineComment: "#",
		toolchains: [
			interpreted("python3", "python3"),
			interpreted("python", "python"),
		],
		template: 'print("hello from Python")\n',
	},
	{
		id: "ruby",
		name: "Ruby",
		extension: "rb",
		extensions: ["rb"],
		highlight: "ruby",
		lineComment: "#",
		toolchains: [interpreted("ruby", "ruby")],
		template: 'puts "hello from Ruby"\n',
	},
	{
		id: "go",
		name: "Go",
		extension: "go",
		extensions: ["go"],
		highlight: "go",
		lineComment: "//",
		// `go run` compiles to its own cache, so one step is enough.
		toolchains: [
			{
				id: "go",
				requires: ["go"],
				versionArgs: ["version"],
				plan: ({ file }) => [
					{ label: "run", command: "go", args: ["run", file] },
				],
			},
		],
		template:
			'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hello from Go")\n}\n',
	},
	{
		id: "rust",
		name: "Rust",
		extension: "rs",
		extensions: ["rs"],
		highlight: "rust",
		lineComment: "//",
		toolchains: [
			{
				id: "rustc",
				requires: ["rustc"],
				versionArgs: ["--version"],
				plan: ({ file, binary }) => [
					{
						label: "compile",
						command: "rustc",
						args: [file, "-o", binary, "--edition", "2021", "-A", "warnings"],
					},
					{ label: "run", command: binary, args: [] },
				],
			},
		],
		template: 'fn main() {\n    println!("hello from Rust");\n}\n',
	},
	{
		id: "c",
		name: "C",
		extension: "c",
		extensions: ["c", "h"],
		highlight: "c",
		lineComment: "//",
		toolchains: [
			{
				id: "cc",
				requires: ["cc"],
				versionArgs: ["--version"],
				plan: ({ file, binary }) => [
					{
						label: "compile",
						command: "cc",
						args: [file, "-o", binary, "-std=c17", "-lm"],
					},
					{ label: "run", command: binary, args: [] },
				],
			},
			{
				id: "gcc",
				requires: ["gcc"],
				versionArgs: ["--version"],
				plan: ({ file, binary }) => [
					{
						label: "compile",
						command: "gcc",
						args: [file, "-o", binary, "-std=c17", "-lm"],
					},
					{ label: "run", command: binary, args: [] },
				],
			},
			{
				id: "clang",
				requires: ["clang"],
				versionArgs: ["--version"],
				plan: ({ file, binary }) => [
					{
						label: "compile",
						command: "clang",
						args: [file, "-o", binary, "-std=c17", "-lm"],
					},
					{ label: "run", command: binary, args: [] },
				],
			},
		],
		template:
			'#include <stdio.h>\n\nint main(void) {\n    printf("hello from C\\n");\n    return 0;\n}\n',
	},
	{
		id: "cpp",
		name: "C++",
		extension: "cpp",
		extensions: ["cpp", "cc", "cxx", "hpp", "hh"],
		highlight: "cpp",
		lineComment: "//",
		toolchains: [
			{
				id: "c++",
				requires: ["c++"],
				versionArgs: ["--version"],
				plan: ({ file, binary }) => [
					{
						label: "compile",
						command: "c++",
						args: [file, "-o", binary, "-std=c++20"],
					},
					{ label: "run", command: binary, args: [] },
				],
			},
			{
				id: "g++",
				requires: ["g++"],
				versionArgs: ["--version"],
				plan: ({ file, binary }) => [
					{
						label: "compile",
						command: "g++",
						args: [file, "-o", binary, "-std=c++20"],
					},
					{ label: "run", command: binary, args: [] },
				],
			},
			{
				id: "clang++",
				requires: ["clang++"],
				versionArgs: ["--version"],
				plan: ({ file, binary }) => [
					{
						label: "compile",
						command: "clang++",
						args: [file, "-o", binary, "-std=c++20"],
					},
					{ label: "run", command: binary, args: [] },
				],
			},
		],
		template:
			'#include <iostream>\n\nint main() {\n    std::cout << "hello from C++" << std::endl;\n}\n',
	},
	{
		id: "java",
		name: "Java",
		extension: "java",
		extensions: ["java"],
		highlight: "java",
		lineComment: "//",
		toolchains: [
			// Java 11+ runs a single-file source program directly, which sidesteps
			// the public-class-name-must-match-the-file rule entirely.
			//
			// `javac` is required even though the plan never invokes it: single-file
			// mode compiles in-process and needs the `jdk.compiler` module, which a
			// JRE-only install does not have. Its `java` runs fine and then dies with
			// "Module jdk.compiler not in boot Layer". The presence of `javac` is the
			// cheap proxy for "this is a JDK".
			{
				id: "java-single-file",
				requires: ["java", "javac"],
				versionArgs: ["-version"],
				plan: ({ file }) => [{ label: "run", command: "java", args: [file] }],
			},
			{
				id: "javac",
				requires: ["javac", "java"],
				versionArgs: ["-version"],
				plan: ({ file, dir, stem }) => [
					{ label: "compile", command: "javac", args: ["-d", dir, file] },
					{ label: "run", command: "java", args: ["-cp", dir, stem] },
				],
			},
		],
		template:
			'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hello from Java");\n    }\n}\n',
	},
	{
		id: "csharp",
		name: "C#",
		extension: "cs",
		extensions: ["cs"],
		highlight: "csharp",
		lineComment: "//",
		toolchains: [
			// `dotnet run` needs a project; the single-file `dotnet <file>` form
			// exists only in .NET 10+, so scripting hosts come first.
			interpreted("dotnet-script", "dotnet-script"),
			interpreted("csi", "csi"),
			interpreted("mcs", "mono", { requires: ["mono"] }),
		],
		template: 'System.Console.WriteLine("hello from C#");\n',
	},
	{
		id: "php",
		name: "PHP",
		extension: "php",
		extensions: ["php"],
		highlight: "php",
		lineComment: "//",
		toolchains: [interpreted("php", "php")],
		template: '<?php\necho "hello from PHP\\n";\n',
	},
	{
		id: "lua",
		name: "Lua",
		extension: "lua",
		extensions: ["lua"],
		highlight: "lua",
		lineComment: "--",
		toolchains: [
			interpreted("lua", "lua", { versionArgs: ["-v"] }),
			interpreted("luajit", "luajit", { versionArgs: ["-v"] }),
		],
		template: 'print("hello from Lua")\n',
	},
	{
		id: "perl",
		name: "Perl",
		extension: "pl",
		extensions: ["pl", "pm"],
		highlight: "perl",
		lineComment: "#",
		toolchains: [interpreted("perl", "perl", { versionArgs: ["-v"] })],
		template: 'print "hello from Perl\\n";\n',
	},
	{
		id: "bash",
		name: "Bash",
		extension: "sh",
		extensions: ["sh", "bash"],
		highlight: "bash",
		lineComment: "#",
		toolchains: [interpreted("bash", "bash"), interpreted("sh", "sh")],
		template: 'echo "hello from Bash"\n',
	},
	{
		id: "zsh",
		name: "Zsh",
		extension: "zsh",
		extensions: ["zsh"],
		highlight: "bash",
		lineComment: "#",
		toolchains: [interpreted("zsh", "zsh")],
		template: 'echo "hello from Zsh"\n',
	},
	{
		id: "fish",
		name: "Fish",
		extension: "fish",
		extensions: ["fish"],
		highlight: "bash",
		lineComment: "#",
		toolchains: [interpreted("fish", "fish")],
		template: 'echo "hello from Fish"\n',
	},
	{
		id: "elixir",
		name: "Elixir",
		extension: "exs",
		extensions: ["ex", "exs"],
		highlight: "elixir",
		lineComment: "#",
		toolchains: [interpreted("elixir", "elixir")],
		template: 'IO.puts("hello from Elixir")\n',
	},
	{
		id: "haskell",
		name: "Haskell",
		extension: "hs",
		extensions: ["hs", "lhs"],
		highlight: "haskell",
		lineComment: "--",
		toolchains: [
			interpreted("runghc", "runghc"),
			interpreted("runhaskell", "runhaskell"),
		],
		template: 'main :: IO ()\nmain = putStrLn "hello from Haskell"\n',
	},
	{
		id: "kotlin",
		name: "Kotlin",
		extension: "kts",
		extensions: ["kt", "kts"],
		highlight: "kotlin",
		lineComment: "//",
		toolchains: [
			interpreted("kotlin-script", "kotlin", { leading: ["-script"] }),
		],
		template: 'println("hello from Kotlin")\n',
	},
	{
		id: "swift",
		name: "Swift",
		extension: "swift",
		extensions: ["swift"],
		highlight: "swift",
		lineComment: "//",
		toolchains: [interpreted("swift", "swift")],
		template: 'print("hello from Swift")\n',
	},
	{
		id: "zig",
		name: "Zig",
		extension: "zig",
		extensions: ["zig"],
		highlight: "zig",
		lineComment: "//",
		toolchains: [
			{
				id: "zig",
				requires: ["zig"],
				versionArgs: ["version"],
				plan: ({ file }) => [
					{ label: "run", command: "zig", args: ["run", file] },
				],
			},
		],
		template:
			'const std = @import("std");\n\npub fn main() void {\n    std.debug.print("hello from Zig\\n", .{});\n}\n',
	},
	{
		id: "dart",
		name: "Dart",
		extension: "dart",
		extensions: ["dart"],
		highlight: "dart",
		lineComment: "//",
		toolchains: [interpreted("dart", "dart", { leading: ["run"] })],
		template: 'void main() {\n  print("hello from Dart");\n}\n',
	},
	{
		id: "julia",
		name: "Julia",
		extension: "jl",
		extensions: ["jl"],
		highlight: "julia",
		lineComment: "#",
		toolchains: [interpreted("julia", "julia")],
		template: 'println("hello from Julia")\n',
	},
	{
		id: "r",
		name: "R",
		extension: "R",
		extensions: ["r", "R"],
		highlight: "r",
		lineComment: "#",
		toolchains: [interpreted("rscript", "Rscript")],
		template: 'cat("hello from R\\n")\n',
	},
	{
		id: "nim",
		name: "Nim",
		extension: "nim",
		extensions: ["nim"],
		highlight: "nim",
		lineComment: "#",
		toolchains: [
			{
				id: "nim",
				requires: ["nim"],
				versionArgs: ["--version"],
				plan: ({ file }) => [
					{ label: "run", command: "nim", args: ["r", "--hints:off", file] },
				],
			},
		],
		template: 'echo "hello from Nim"\n',
	},
	{
		id: "ocaml",
		name: "OCaml",
		extension: "ml",
		extensions: ["ml", "mli"],
		highlight: "ocaml",
		lineComment: "(*",
		toolchains: [interpreted("ocaml", "ocaml")],
		template: 'let () = print_endline "hello from OCaml"\n',
	},
	{
		id: "scala",
		name: "Scala",
		extension: "scala",
		extensions: ["scala", "sc"],
		highlight: "scala",
		lineComment: "//",
		toolchains: [interpreted("scala", "scala")],
		template: '@main def run(): Unit = println("hello from Scala")\n',
	},
	{
		id: "clojure",
		name: "Clojure",
		extension: "clj",
		extensions: ["clj", "cljs", "cljc", "edn"],
		highlight: "clojure",
		lineComment: ";",
		toolchains: [
			interpreted("bb", "bb"),
			{
				id: "clojure",
				requires: ["clojure"],
				versionArgs: ["--version"],
				plan: ({ file }) => [
					{ label: "run", command: "clojure", args: ["-M", file] },
				],
			},
		],
		template: '(println "hello from Clojure")\n',
	},
	{
		id: "json",
		name: "JSON",
		extension: "json",
		extensions: ["json", "jsonc"],
		highlight: "json",
		lineComment: "//",
		// JSON is not executable; "running" it means validating and pretty-printing.
		toolchains: [
			{
				id: "jq",
				requires: ["jq"],
				versionArgs: ["--version"],
				plan: ({ file }) => [
					{ label: "format", command: "jq", args: [".", file] },
				],
			},
		],
		template: '{\n  "hello": "from JSON"\n}\n',
	},
];

/** Every known language, in the order shown in the language picker. */
export const LANGUAGES: readonly Language[] = LANGUAGE_LIST;

const BY_ID = new Map(LANGUAGE_LIST.map((lang) => [lang.id, lang]));

const BY_EXTENSION = new Map<string, Language>();
for (const lang of LANGUAGE_LIST) {
	for (const ext of lang.extensions) {
		// First declaration wins, so `LANGUAGE_LIST` order resolves collisions
		// (e.g. `.h` belongs to C, not C++).
		if (!BY_EXTENSION.has(ext.toLowerCase()))
			BY_EXTENSION.set(ext.toLowerCase(), lang);
	}
}

/** Look up a language by its id, or `undefined` if the id is unknown. */
export function languageById(id: string): Language | undefined {
	return BY_ID.get(id);
}

/**
 * Guess a language from a file name. Returns `undefined` for extensions no
 * language claims, which the caller should treat as plain text rather than
 * silently mislabelling.
 */
export function languageForFilename(filename: string): Language | undefined {
	const base = filename.slice(filename.lastIndexOf("/") + 1);
	const dot = base.lastIndexOf(".");
	if (dot <= 0) return undefined;
	return BY_EXTENSION.get(base.slice(dot + 1).toLowerCase());
}
