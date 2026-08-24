/**
 * Which language servers to try for each language.
 *
 * Same rule as toolchains: code-repl does not install servers. It lists the
 * usual candidates in preference order and uses the first one on `PATH`. A
 * language with no server installed simply has no completion — every LSP-backed
 * feature degrades to nothing rather than erroring.
 */

/** How to start one language server. */
export interface ServerSpec {
	readonly id: string;
	/** Executable that must be on PATH. */
	readonly command: string;
	readonly args: readonly string[];
	/**
	 * Language ids (from `languages/registry.ts`) this server handles. One server
	 * commonly covers several: `tsserver` does TS and JS, `clangd` does C and C++.
	 */
	readonly languages: readonly string[];
	/**
	 * LSP `languageId` to send in `textDocument/didOpen`, keyed by our language
	 * id. These are the protocol's own names and do not always match ours.
	 */
	readonly languageIds: Readonly<Record<string, string>>;
}

/**
 * Known servers, in preference order within each language. Presence on `PATH`
 * is the only thing that decides which is used.
 */
export const SERVERS: readonly ServerSpec[] = [
	{
		id: "typescript-language-server",
		command: "typescript-language-server",
		args: ["--stdio"],
		languages: ["typescript", "javascript"],
		languageIds: { typescript: "typescript", javascript: "javascript" },
	},
	{
		id: "deno",
		command: "deno",
		args: ["lsp"],
		languages: ["typescript", "javascript"],
		languageIds: { typescript: "typescript", javascript: "javascript" },
	},
	{
		id: "pyright",
		command: "pyright-langserver",
		args: ["--stdio"],
		languages: ["python"],
		languageIds: { python: "python" },
	},
	{
		id: "basedpyright",
		command: "basedpyright-langserver",
		args: ["--stdio"],
		languages: ["python"],
		languageIds: { python: "python" },
	},
	{
		id: "ruff",
		command: "ruff",
		args: ["server"],
		languages: ["python"],
		languageIds: { python: "python" },
	},
	{
		id: "pylsp",
		command: "pylsp",
		args: [],
		languages: ["python"],
		languageIds: { python: "python" },
	},
	{
		id: "gopls",
		command: "gopls",
		args: [],
		languages: ["go"],
		languageIds: { go: "go" },
	},
	{
		id: "rust-analyzer",
		command: "rust-analyzer",
		args: [],
		languages: ["rust"],
		languageIds: { rust: "rust" },
	},
	{
		id: "clangd",
		command: "clangd",
		args: [],
		languages: ["c", "cpp"],
		languageIds: { c: "c", cpp: "cpp" },
	},
	{
		id: "solargraph",
		command: "solargraph",
		args: ["stdio"],
		languages: ["ruby"],
		languageIds: { ruby: "ruby" },
	},
	{
		id: "ruby-lsp",
		command: "ruby-lsp",
		args: [],
		languages: ["ruby"],
		languageIds: { ruby: "ruby" },
	},
	{
		id: "lua-language-server",
		command: "lua-language-server",
		args: [],
		languages: ["lua"],
		languageIds: { lua: "lua" },
	},
	{
		id: "zls",
		command: "zls",
		args: [],
		languages: ["zig"],
		languageIds: { zig: "zig" },
	},
	{
		id: "jdtls",
		command: "jdtls",
		args: [],
		languages: ["java"],
		languageIds: { java: "java" },
	},
	{
		id: "omnisharp",
		command: "omnisharp",
		args: ["-lsp"],
		languages: ["csharp"],
		languageIds: { csharp: "csharp" },
	},
	{
		id: "intelephense",
		command: "intelephense",
		args: ["--stdio"],
		languages: ["php"],
		languageIds: { php: "php" },
	},
	{
		id: "elixir-ls",
		command: "elixir-ls",
		args: [],
		languages: ["elixir"],
		languageIds: { elixir: "elixir" },
	},
	{
		id: "haskell-language-server",
		command: "haskell-language-server-wrapper",
		args: ["--lsp"],
		languages: ["haskell"],
		languageIds: { haskell: "haskell" },
	},
	{
		id: "sourcekit-lsp",
		command: "sourcekit-lsp",
		args: [],
		languages: ["swift"],
		languageIds: { swift: "swift" },
	},
	{
		id: "kotlin-language-server",
		command: "kotlin-language-server",
		args: [],
		languages: ["kotlin"],
		languageIds: { kotlin: "kotlin" },
	},
	{
		id: "dart",
		command: "dart",
		args: ["language-server", "--protocol=lsp"],
		languages: ["dart"],
		languageIds: { dart: "dart" },
	},
	{
		id: "nimlangserver",
		command: "nimlangserver",
		args: [],
		languages: ["nim"],
		languageIds: { nim: "nim" },
	},
	{
		id: "bash-language-server",
		command: "bash-language-server",
		args: ["start"],
		languages: ["bash", "zsh"],
		languageIds: { bash: "shellscript", zsh: "shellscript" },
	},
	{
		id: "perlnavigator",
		command: "perlnavigator",
		args: ["--stdio"],
		languages: ["perl"],
		languageIds: { perl: "perl" },
	},
	{
		id: "vscode-json-languageserver",
		command: "vscode-json-languageserver",
		args: ["--stdio"],
		languages: ["json"],
		languageIds: { json: "json" },
	},
	{
		id: "clojure-lsp",
		command: "clojure-lsp",
		args: [],
		languages: ["clojure"],
		languageIds: { clojure: "clojure" },
	},
	{
		id: "ocamllsp",
		command: "ocamllsp",
		args: [],
		languages: ["ocaml"],
		languageIds: { ocaml: "ocaml" },
	},
	{
		id: "metals",
		command: "metals",
		args: [],
		languages: ["scala"],
		languageIds: { scala: "scala" },
	},
	{
		id: "julia-lsp",
		command: "julia-lsp",
		args: [],
		languages: ["julia"],
		languageIds: { julia: "julia" },
	},
];

/** Candidate servers for a language, in preference order. */
export function serversFor(languageId: string): readonly ServerSpec[] {
	return SERVERS.filter((spec) => spec.languages.includes(languageId));
}

/** The LSP `languageId` a server expects for one of our languages. */
export function protocolLanguageId(
	spec: ServerSpec,
	languageId: string,
): string {
	return spec.languageIds[languageId] ?? languageId;
}
