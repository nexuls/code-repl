/**
 * Grammar data for the highlighter.
 *
 * Split from `highlight.ts` so that file stays the tokenizer and this one stays
 * word lists. Adding a language is a few lines here and nothing else.
 *
 * These are *approximations*, on purpose. A hand-written tokenizer will never
 * match a real parser, and it does not need to: the job is making a scratch
 * buffer readable, and a keyword list plus correct string and comment handling
 * gets almost all of the way there for almost no cost. See artifacts/DECISIONS.md
 * (D2) for why this is not Tree-sitter.
 */

import type { LanguageSpec } from "./highlight";

const set = (words: string) => new Set(words.split(/\s+/).filter(Boolean));

/**
 * Build a spec from the defaults most languages share, overriding only what
 * differs. Defaults are C-family: `//` line comments, `/* *\/` blocks, no
 * template literals, no regex literals.
 */
function grammar(
	name: string,
	options: {
		lineComment?: string;
		blockComment?: [string, string];
		templates?: boolean;
		tripleQuoted?: boolean;
		regex?: boolean;
		keywords?: string;
		control?: string;
		literals?: string;
		types?: string;
	} = {},
): LanguageSpec {
	return {
		name,
		lineComment: "lineComment" in options ? options.lineComment : "//",
		blockComment:
			"blockComment" in options ? options.blockComment : ["/*", "*/"],
		templates: options.templates ?? false,
		tripleQuoted: options.tripleQuoted ?? false,
		regex: options.regex ?? false,
		keywords: set(options.keywords ?? ""),
		control: set(options.control ?? ""),
		literals: set(options.literals ?? "true false null"),
		types: set(options.types ?? ""),
	};
}

/** Control-flow words nearly every C-family language shares. */
const C_CONTROL =
	"break case continue default do else for goto if return switch while";

export const ruby = grammar("ruby", {
	lineComment: "#",
	blockComment: undefined,
	tripleQuoted: false,
	keywords: `alias and begin class def end ensure in module not or rescue retry self
		super then undef yield attr_accessor attr_reader attr_writer require
		require_relative lambda proc puts print`,
	control:
		"break case else elsif for if next redo return unless until when while",
	literals: "true false nil __FILE__ __LINE__",
	types:
		"Array Hash String Symbol Integer Float Range Proc Struct Comparable Enumerable",
});

export const go = grammar("go", {
	keywords: `break chan const defer func go import interface map package range select
		struct type var`,
	control: "case continue default else fallthrough for goto if return switch",
	literals: "true false nil iota",
	types: `bool byte complex64 complex128 error float32 float64 int int8 int16 int32
		int64 rune string uint uint8 uint16 uint32 uint64 uintptr any`,
});

export const rust = grammar("rust", {
	keywords: `as async await const crate dyn enum extern fn impl in let mod move mut
		pub ref self Self static struct super trait type unsafe use where`,
	control: "break continue else for if loop match return while yield",
	literals: "true false None Some Ok Err",
	types: `bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize
		String Vec Option Result Box Rc Arc HashMap`,
});

export const c = grammar("c", {
	keywords: `auto const extern inline register restrict signed sizeof static struct
		typedef union unsigned volatile _Atomic _Bool`,
	control: C_CONTROL,
	literals: "NULL true false",
	types: "char double enum float int long short void size_t FILE",
});

export const cpp = grammar("cpp", {
	keywords: `alignas alignof auto catch class concept const consteval constexpr
		constinit const_cast decltype delete dynamic_cast explicit export extern friend
		inline mutable namespace new noexcept operator private protected public
		reinterpret_cast requires sizeof static static_assert static_cast struct
		template this thread_local throw try typedef typeid typename union using
		virtual volatile`,
	control: `${C_CONTROL} co_await co_return co_yield`,
	literals: "true false nullptr NULL",
	types: `bool char char8_t char16_t char32_t double enum float int long short signed
		unsigned void wchar_t size_t string vector map set optional variant unique_ptr
		shared_ptr`,
});

export const java = grammar("java", {
	keywords: `abstract assert class enum extends final finally implements import
		instanceof interface native new package private protected public record sealed
		static strictfp super synchronized this throw throws transient try var volatile
		yield permits`,
	control:
		"break case catch continue default do else for if return switch while",
	literals: "true false null",
	types: `boolean byte char double float int long short void Boolean Byte Character
		Double Float Integer Long Object Short String List Map Set Optional Stream`,
});

export const csharp = grammar("csharp", {
	keywords: `abstract as async await base checked class const delegate event explicit
		extern fixed get implicit in init interface internal is lock namespace new
		operator out override params partial private protected public readonly record
		ref sealed set sizeof stackalloc static struct this throw typeof unchecked
		unsafe using var virtual volatile where yield`,
	control: `break case catch continue default do else finally for foreach goto if
		return switch try while`,
	literals: "true false null value",
	types: `bool byte char decimal double dynamic float int long nint nuint object sbyte
		short string uint ulong ushort void List Dictionary Task IEnumerable`,
});

export const php = grammar("php", {
	keywords: `abstract and array as class clone const declare echo empty enum extends
		final fn function global implements include include_once instanceof insteadof
		interface isset list match namespace new or print private protected public
		readonly require require_once static trait unset use var xor yield`,
	control: `break case catch continue default do else elseif endif finally for foreach
		goto if return switch throw try while`,
	literals: "true false null TRUE FALSE NULL",
	types:
		"bool callable float int iterable mixed object self parent string void never",
});

export const lua = grammar("lua", {
	lineComment: "--",
	blockComment: ["--[[", "]]"],
	keywords: "and function in local not or require self",
	control:
		"break do else elseif end for goto if repeat return then until while",
	literals: "true false nil",
	types: "string table math io os coroutine debug",
});

export const perl = grammar("perl", {
	lineComment: "#",
	blockComment: undefined,
	regex: true,
	keywords: `bless do eval local my no our package ref require return sub use
		wantarray defined delete exists print printf say sort grep map join split push
		pop shift unshift keys values`,
	control: "elsif else for foreach if last next redo unless until while",
	literals: "undef",
});

export const bash = grammar("bash", {
	lineComment: "#",
	blockComment: undefined,
	keywords: `alias declare echo export eval exec function local printf read readonly
		return set shift source trap typeset unset cd pwd command builtin`,
	control: `break case continue do done elif else esac fi for if in select then until
		while`,
	literals: "true false",
});

export const elixir = grammar("elixir", {
	lineComment: "#",
	blockComment: undefined,
	tripleQuoted: true,
	keywords: `alias def defdelegate defexception defguard defimpl defmacro defmodule
		defp defprotocol defstruct do end fn import quote require unquote use when`,
	control:
		"after case catch cond else for if raise rescue throw try unless with",
	literals: "true false nil",
	types:
		"Atom Enum Integer Float List Map MapSet Stream String Tuple Keyword Process",
});

export const haskell = grammar("haskell", {
	lineComment: "--",
	blockComment: ["{-", "-}"],
	keywords: `class data deriving forall import infix infixl infixr instance let module
		newtype type where`,
	control: "case do else if in of then",
	literals: "True False Nothing Just Left Right",
	types:
		"Bool Char Double Either Float Int Integer IO Maybe Ordering String Word",
});

export const kotlin = grammar("kotlin", {
	tripleQuoted: true,
	keywords: `abstract actual annotation as by companion const constructor crossinline
		data delegate dynamic enum expect external final fun get import in infix init
		inline inner interface internal is lateinit noinline object open operator out
		override package private protected public reified sealed set suspend tailrec
		this throw typealias val var vararg where`,
	control: "break catch continue do else finally for if return try when while",
	literals: "true false null it",
	types: `Any Array Boolean Byte Char Double Float Int List Long Map Nothing Number
		Pair Set Short String Triple Unit`,
});

export const swift = grammar("swift", {
	keywords: `actor as associatedtype async await class deinit enum extension
		fileprivate func import in indirect inout internal is lazy let mutating
		nonisolated open operator override postfix precedencegroup prefix private
		protocol public required rethrows self Self some static struct subscript super
		throws typealias var weak where willSet didSet`,
	control: `break case catch continue default defer do else fallthrough for guard if
		repeat return switch throw try while`,
	literals: "true false nil",
	types: `Any Array Bool Character Dictionary Double Float Int Int8 Int32 Int64 Never
		Optional Set String UInt Void Result`,
});

export const zig = grammar("zig", {
	keywords: `align allowzero and anyframe anytype asm async await callconv comptime
		const enum errdefer error export extern fn inline linksection noalias noinline
		nosuspend opaque or orelse packed pub resume struct suspend threadlocal try
		union unreachable usingnamespace var volatile`,
	control: "break catch continue defer else for if return switch while",
	literals: "true false null undefined",
	types: `bool c_int comptime_float comptime_int f16 f32 f64 f128 i8 i16 i32 i64 i128
		isize noreturn type u8 u16 u32 u64 u128 usize void anyerror`,
});

export const dart = grammar("dart", {
	keywords: `abstract as async await base class const covariant deferred dynamic enum
		export extends extension external factory final get hide implements import in
		interface is late library mixin new on operator part required rethrow sealed
		set show static super sync this typedef var with yield`,
	control: `assert break case catch continue default do else finally for if return
		switch throw try while`,
	literals: "true false null",
	types:
		"bool double Function int List Map num Object Set String Symbol Future Stream void",
});

export const julia = grammar("julia", {
	lineComment: "#",
	blockComment: ["#=", "=#"],
	tripleQuoted: true,
	keywords: `abstract baremodule begin const export function global import let local
		macro module mutable primitive quote struct type using where`,
	control:
		"break catch continue do else elseif end finally for if return try while",
	literals: "true false nothing missing Inf NaN",
	types: `Any AbstractArray Array Bool Char Complex Dict Float32 Float64 Int Int8 Int32
		Int64 Number Set String Symbol Tuple UInt Vector`,
});

export const r = grammar("r", {
	lineComment: "#",
	blockComment: undefined,
	keywords: "function library require return invisible attach detach source",
	control: "break else for if in next repeat while",
	literals: "TRUE FALSE NULL NA NaN Inf T F",
	types: `character complex data.frame double factor integer list logical matrix
		numeric vector`,
});

export const nim = grammar("nim", {
	lineComment: "#",
	blockComment: ["#[", "]#"],
	tripleQuoted: true,
	keywords: `addr and as asm bind concept const converter discard distinct div echo
		export from func import include is isnot iterator let macro method mixin mod
		not notin of or out proc ptr ref shl shr static template type using var when
		xor yield`,
	control: `block break case continue defer do elif else end except finally for if
		raise return try while`,
	literals: "true false nil",
	types: `array bool byte char cstring float float32 float64 int int8 int16 int32 int64
		object openArray seq set string tuple uint uint8 uint32 uint64 range`,
});

export const ocaml = grammar("ocaml", {
	// OCaml has no line comment at all; `(* *)` nests instead.
	lineComment: undefined,
	blockComment: ["(*", "*)"],
	keywords: `and as assert begin class constraint end exception external functor
		include inherit initializer lazy let method module mutable new nonrec object of
		open private rec sig struct type val virtual`,
	control: `do done downto else for if in match then to try when while with function
		fun`,
	literals: "true false",
	types:
		"array bool bytes char float int list option ref string unit exn Hashtbl Map Set",
});

export const scala = grammar("scala", {
	tripleQuoted: true,
	keywords: `abstract case class def enum export extends final forSome given implicit
		import lazy new object opaque override package private protected sealed super
		then this trait type using val var with yield`,
	control: "catch do else finally for if match return throw try while",
	literals: "true false null None Some",
	types: `Any AnyRef AnyVal Boolean Byte Char Double Either Float Int List Long Map
		Nothing Option Seq Set Short String Unit Vector Future`,
});

export const clojure = grammar("clojure", {
	lineComment: ";",
	blockComment: undefined,
	keywords: `def defn defn- defmacro defprotocol defrecord deftype defmulti defmethod
		fn let letfn loop ns require import in-ns binding var quote do declare atom
		swap! reset! deref`,
	control: `case cond condp if if-let if-not when when-let when-not recur try catch
		finally throw`,
	literals: "true false nil",
});

/**
 * Grammar for a language with no entry of its own. Strings, numbers, and
 * punctuation still highlight; identifiers stay plain. Better than colouring an
 * unknown language with someone else's keyword list, which produces confidently
 * wrong output.
 */
export const plainText = grammar("text", {
	lineComment: undefined,
	blockComment: undefined,
	literals: "",
});
