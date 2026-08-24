#!/usr/bin/env bun
/**
 * Entry point: parse argv, create the renderer, mount the app, and make sure
 * every exit path puts the terminal back.
 *
 * The renderer is created here, so cleaning it up is this file's job — including
 * on signals and on an uncaught error. A TUI that dies without restoring the
 * terminal leaves the user with no echo and no cursor, which is a genuinely bad
 * way to end a session.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app/App";

interface Argv {
	readonly folder?: string;
	readonly file?: string;
	readonly language?: string;
	readonly help: boolean;
	readonly version: boolean;
}

const USAGE = `code-repl — write a snippet in any language on this machine and run it

usage:
  code-repl                  start with an empty scratch buffer
  code-repl <file>           open a file
  code-repl <folder>         open a folder in the file tree
  code-repl -l <language>    start a scratch buffer in a language

options:
  -l, --language <id>   language for the initial scratch buffer (default: typescript)
  -h, --help            show this message
  -v, --version         print the version

code-repl runs whatever is already installed. It never downloads or installs a
compiler, interpreter, or language server; a language with nothing on PATH is
shown greyed out in the picker (ctrl+p).
`;

const VERSION = "0.1.0";

/**
 * Parse argv. A bare positional is classified as a file or a folder by asking
 * the filesystem — guessing from the presence of a dot would misread `Makefile`
 * and `~/src/v0.1`.
 */
async function parseArgv(args: readonly string[]): Promise<Argv> {
	let language: string | undefined;
	let positional: string | undefined;
	let help = false;
	let version = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "-h" || arg === "--help") help = true;
		else if (arg === "-v" || arg === "--version") version = true;
		else if (arg === "-l" || arg === "--language") language = args[++i];
		else if (arg.startsWith("--language=")) language = arg.slice(11);
		else if (!arg.startsWith("-")) positional ??= arg;
	}

	if (!positional) return { language, help, version };

	const path = resolve(positional);
	try {
		const info = await stat(path);
		return info.isDirectory()
			? { folder: path, language, help, version }
			: { file: path, language, help, version };
	} catch {
		// A path that does not exist yet is treated as a file to create, which is
		// what someone typing `code-repl notes.py` almost certainly means.
		return { file: path, language, help, version };
	}
}

const argv = await parseArgv(process.argv.slice(2));

if (argv.help) {
	process.stdout.write(USAGE);
	process.exit(0);
}
if (argv.version) {
	process.stdout.write(`${VERSION}\n`);
	process.exit(0);
}

// `exitOnCtrlC: false` because the app handles ctrl+c itself: it must be able to
// stop and confirm when buffers are unsaved.
const renderer = await createCliRenderer({ exitOnCtrlC: false });

let shuttingDown = false;

/** Restore the terminal exactly once, whatever triggered the exit. */
function shutdown(code = 0): void {
	if (shuttingDown) return;
	shuttingDown = true;
	try {
		renderer.destroy();
	} catch {
		// The renderer may already be gone; the exit still has to happen.
	}
	process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
	process.on(signal, () => shutdown(0));
}
// Without these the terminal is left in raw mode with no cursor after a crash,
// and the stack trace is invisible because the alternate screen is still up.
process.on("uncaughtException", (error) => {
	shutdown(1);
	console.error(error);
});
process.on("unhandledRejection", (reason) => {
	shutdown(1);
	console.error(reason);
});

createRoot(renderer).render(
	<App
		initialFolder={argv.folder}
		initialFile={argv.file}
		initialLanguage={argv.language}
	/>,
);
