import { describe, expect, test } from "bun:test";
import {
	type DetectEnvironment,
	detectAll,
	detectLanguage,
	isAvailable,
} from "../src/core/languages/detect";
import {
	LANGUAGES,
	languageById,
	languageForFilename,
} from "../src/core/languages/registry";

/** A fake PATH: only the named binaries exist, each reporting "1.2.3". */
function fakeEnv(available: string[]): DetectEnvironment {
	const set = new Set(available);
	return {
		async which(bin) {
			return set.has(bin) ? `/usr/bin/${bin}` : null;
		},
		async probeVersion(bin) {
			return `${bin} 1.2.3\nextra line`;
		},
	};
}

describe("registry", () => {
	test("every language declares at least one toolchain", () => {
		for (const lang of LANGUAGES) {
			expect(lang.toolchains.length).toBeGreaterThan(0);
		}
	});

	test("language ids are unique", () => {
		const ids = LANGUAGES.map((l) => l.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	test("a language's write extension is one it also recognises", () => {
		for (const lang of LANGUAGES) {
			expect(lang.extensions.map((e) => e.toLowerCase())).toContain(
				lang.extension.toLowerCase(),
			);
		}
	});

	test("toolchain ids are unique within a language", () => {
		for (const lang of LANGUAGES) {
			const ids = lang.toolchains.map((t) => t.id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	test("plans always end in an executable step", () => {
		const ctx = {
			file: "/tmp/x/main.ext",
			dir: "/tmp/x",
			stem: "main",
			binary: "/tmp/x/main",
		};
		for (const lang of LANGUAGES) {
			for (const toolchain of lang.toolchains) {
				const steps = toolchain.plan(ctx);
				expect(steps.length).toBeGreaterThan(0);
				expect(steps[steps.length - 1]?.command).toBeTruthy();
			}
		}
	});

	test("looks up by id", () => {
		expect(languageById("python")?.name).toBe("Python");
		expect(languageById("nope")).toBeUndefined();
	});

	describe("languageForFilename", () => {
		test("maps known extensions", () => {
			expect(languageForFilename("a/b/main.rs")?.id).toBe("rust");
			expect(languageForFilename("script.PY")?.id).toBe("python");
			expect(languageForFilename("x.tsx")?.id).toBe("typescript");
		});

		test("returns undefined rather than guessing", () => {
			expect(languageForFilename("README")).toBeUndefined();
			expect(languageForFilename("archive.xyz")).toBeUndefined();
		});

		test("does not treat a dotfile as an extension", () => {
			expect(languageForFilename(".gitignore")).toBeUndefined();
		});
	});
});

describe("detect", () => {
	test("picks the first fully installed toolchain", async () => {
		const ts = languageById("typescript")!;
		// `deno` is listed after `bun`, so with only deno present it must win.
		const detected = await detectLanguage(ts, fakeEnv(["deno"]));
		expect(detected.toolchain?.id).toBe("deno");
		expect(detected.binaries.deno).toBe("/usr/bin/deno");
	});

	test("prefers earlier toolchains when several are installed", async () => {
		const ts = languageById("typescript")!;
		const detected = await detectLanguage(ts, fakeEnv(["deno", "bun", "tsx"]));
		expect(detected.toolchain?.id).toBe("bun");
	});

	test("skips a toolchain missing any of its requirements", async () => {
		const java = languageById("java")!;
		// `javac` alone cannot satisfy either toolchain: the single-file form needs
		// `java`, and the compile form needs both.
		const detected = await detectLanguage(java, fakeEnv(["javac"]));
		expect(isAvailable(detected)).toBe(false);
	});

	test("multi-requirement toolchains resolve every binary", async () => {
		const java = languageById("java")!;
		const detected = await detectLanguage(java, fakeEnv(["javac", "java"]));
		// The single-file `java <file>` toolchain is declared first.
		expect(detected.toolchain?.id).toBe("java-single-file");
		expect(detected.binaries.java).toBe("/usr/bin/java");
	});

	test("reports an unavailable language instead of omitting it", async () => {
		const rust = languageById("rust")!;
		const detected = await detectLanguage(rust, fakeEnv([]));
		expect(detected.language.id).toBe("rust");
		expect(detected.toolchain).toBeUndefined();
		expect(isAvailable(detected)).toBe(false);
	});

	test("keeps only the first line of a version banner", async () => {
		const py = languageById("python")!;
		const detected = await detectLanguage(py, fakeEnv(["python3"]));
		// Probed via the resolved absolute path, not the bare name.
		expect(detected.version).toBe("/usr/bin/python3 1.2.3");
	});

	test("detectAll covers the whole registry in order", async () => {
		const all = await detectAll(fakeEnv(["node"]));
		expect(all.length).toBe(LANGUAGES.length);
		expect(all.map((d) => d.language.id)).toEqual(LANGUAGES.map((l) => l.id));
		expect(all.filter(isAvailable).map((d) => d.language.id)).toEqual([
			"javascript",
		]);
	});
});
