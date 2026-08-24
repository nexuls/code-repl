/**
 * Toolchain detection.
 *
 * code-repl never installs anything. It asks the machine what it already has:
 * for each language it probes the candidate executables on `PATH`, keeps the
 * first toolchain whose requirements are all satisfied, and records the version
 * string so the UI can show it.
 *
 * Detection results are cached for the process lifetime — a compiler does not
 * appear halfway through a session, and probing every candidate costs one
 * process spawn each.
 */

import { LANGUAGES, type Language, type Toolchain } from "./registry";

/** How a language turned out on this machine. */
export interface DetectedLanguage {
	readonly language: Language;
	/**
	 * The winning toolchain, or `undefined` when nothing that can run this
	 * language is installed. Unavailable languages are still returned so the UI
	 * can show them greyed out rather than pretending they do not exist.
	 */
	readonly toolchain?: Toolchain;
	/** Absolute paths of the toolchain's required executables, keyed by name. */
	readonly binaries: Readonly<Record<string, string>>;
	/** First line of the toolchain's `--version` output, trimmed. */
	readonly version?: string;
}

/** Overridable process access, so tests need not depend on the host machine. */
export interface DetectEnvironment {
	/** Resolve an executable name to an absolute path, or `null` if absent. */
	which(bin: string): Promise<string | null>;
	/** Run a version probe and return its combined output, or `null` on failure. */
	probeVersion(bin: string, args: readonly string[]): Promise<string | null>;
}

/** Probe timeout. A version flag that hangs this long is a broken install. */
const VERSION_TIMEOUT_MS = 3_000;

/** The real environment, backed by Bun's process APIs. */
export const systemEnvironment: DetectEnvironment = {
	async which(bin) {
		return Bun.which(bin);
	},

	async probeVersion(bin, args) {
		try {
			const proc = Bun.spawn([bin, ...args], {
				stdout: "pipe",
				stderr: "pipe",
				stdin: "ignore",
			});
			const timer = setTimeout(() => proc.kill(), VERSION_TIMEOUT_MS);
			// Many tools print their version to stderr (`java -version`, `lua -v`),
			// so both streams are read and the first non-empty one wins.
			const [out, err] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
			]);
			await proc.exited;
			clearTimeout(timer);
			return out.trim() || err.trim() || null;
		} catch {
			// A binary that vanished between `which` and `spawn`, or is not
			// executable. Treated the same as absent.
			return null;
		}
	},
};

/**
 * Detect one language. Tries its toolchains in declaration order and returns as
 * soon as one is fully installed; the result always describes the language, even
 * when no toolchain was found.
 */
export async function detectLanguage(
	language: Language,
	env: DetectEnvironment = systemEnvironment,
): Promise<DetectedLanguage> {
	for (const toolchain of language.toolchains) {
		const resolved = await Promise.all(
			toolchain.requires.map(
				async (bin) => [bin, await env.which(bin)] as const,
			),
		);
		if (resolved.some(([, path]) => path === null)) continue;

		const binaries: Record<string, string> = {};
		for (const [bin, path] of resolved) binaries[bin] = path as string;

		const primary = toolchain.requires[0] as string;
		const raw = await env.probeVersion(
			binaries[primary] as string,
			toolchain.versionArgs,
		);
		return {
			language,
			toolchain,
			binaries,
			version: raw ? firstLine(raw) : undefined,
		};
	}
	return { language, binaries: {} };
}

let cache: Promise<readonly DetectedLanguage[]> | undefined;

/**
 * Detect every known language, concurrently. The returned array is in registry
 * order and includes unavailable languages.
 *
 * The result is memoised; pass a custom `env` to bypass the cache (which is what
 * tests do).
 */
export function detectAll(
	env?: DetectEnvironment,
): Promise<readonly DetectedLanguage[]> {
	if (env)
		return Promise.all(LANGUAGES.map((lang) => detectLanguage(lang, env)));
	cache ??= Promise.all(LANGUAGES.map((lang) => detectLanguage(lang)));
	return cache;
}

/** Drop the memoised detection result. Exists for tests and a manual rescan. */
export function resetDetectionCache(): void {
	cache = undefined;
}

/** True when the language has a usable toolchain on this machine. */
export function isAvailable(detected: DetectedLanguage): boolean {
	return detected.toolchain !== undefined;
}

/**
 * Compress a version banner to something that fits a status bar: the first line,
 * with the tool's own name stripped when it merely repeats the command.
 */
function firstLine(text: string): string {
	const line = text.split(/\r?\n/, 1)[0] ?? "";
	return line.trim().slice(0, 80);
}
