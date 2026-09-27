// Selection-language front end: MolScript, PyMOL, VMD and Jmol text -> a plain
// MolQL expression tree that @molgpu/select compiles (decision molgpu-sept-922.1).
//
// Only Mol*'s parsers are used (mol-script/language, mol-script/transpilers and
// mol-util/monadic-parser). None of them import Mol*'s structure model. They are
// loaded lazily, like the rest of this package's Mol* use.
import { IoError, type IoErrorCode } from "./error.ts";

/** Selection syntaxes `parseSelection` accepts. */
export type SelectionLanguage = "mol-script" | "pymol" | "vmd" | "jmol";

/**
 * A MolQL expression as plain JSON: a literal, a symbol `{ name }`, or a call
 * `{ head, args }`. The same shape as `@molgpu/select`'s SelectionExpr, so the
 * result of `parseSelection` can be passed straight to its `compile`.
 */
export type SelectionExpr =
  | string
  | number
  | boolean
  | { readonly name: string }
  | {
    readonly head: SelectionExpr;
    readonly args?:
      | readonly SelectionExpr[]
      | { readonly [name: string]: SelectionExpr };
  };

const selectionError = (
  language: SelectionLanguage,
  message: string,
  code: IoErrorCode,
  cause?: unknown,
) =>
  new IoError(
    `@molgpu/io parseSelection (${language}): ${message}`,
    "selection",
    code,
    cause,
  );

const LANGUAGES: readonly SelectionLanguage[] = [
  "mol-script",
  "pymol",
  "vmd",
  "jmol",
];

// Mol* expression values, as far as this module reads them.
type MolExpr =
  | string
  | number
  | boolean
  | { name: string }
  | { head: MolExpr; args?: MolExpr[] | Record<string, MolExpr> };

let knownSymbols: Promise<ReadonlySet<string>> | null = null;

/** Every symbol id in Mol*'s MolQL symbol table. */
function molqlSymbols(): Promise<ReadonlySet<string>> {
  return knownSymbols ??= import(
    "molstar/lib/mol-script/language/symbol-table.js"
  ).then(({ MolScriptSymbolTable }) => {
    const ids = new Set<string>();
    // Symbols are callable MSymbol functions carrying `id` and `args`.
    const walk = (node: unknown): void => {
      if (!node || (typeof node !== "object" && typeof node !== "function")) {
        return;
      }
      const id = (node as { id?: unknown }).id;
      if (typeof id === "string" && "args" in node) {
        ids.add(id);
        return;
      }
      for (const [key, child] of Object.entries(node)) {
        if (!key.startsWith("@")) walk(child);
      }
    };
    walk(MolScriptSymbolTable);
    return ids;
  });
}

async function molExpression(
  language: SelectionLanguage,
  text: string,
): Promise<MolExpr> {
  if (language === "mol-script") {
    const [{ parseMolScript }, { transpileMolScript }] = await Promise.all([
      import("molstar/lib/mol-script/language/parser.js"),
      import("molstar/lib/mol-script/script/mol-script/symbols.js"),
    ]);
    const parsed = parseMolScript(text);
    if (parsed.length !== 1) {
      throw new Error(`expected one expression, got ${parsed.length}`);
    }
    return transpileMolScript(parsed[0]) as MolExpr;
  }
  // The transpiler table directly: Mol*'s parse() wrapper also console.errors.
  const { _transpiler } = await import(
    "molstar/lib/mol-script/transpilers/all.js"
  );
  return _transpiler[language](text) as MolExpr;
}

/**
 * Copy Mol*'s tree into plain JSON and normalise it:
 * - properties written as bare symbols (MolScript) become zero-argument calls,
 *   the form the transpilers emit;
 * - bare names that are not MolQL symbols (MolScript's `HEM` in
 *   `(= atom.label_comp_id HEM)`) become strings, which is how Mol*'s runtime
 *   reads them;
 * - argument defaults are NOT filled in: Mol* branches on whether some
 *   arguments are present at all (filter.within's :min-radius, :atom-radius).
 */
function normalise(
  e: MolExpr,
  known: ReadonlySet<string>,
  check: (name: string) => void,
): SelectionExpr {
  if (typeof e !== "object" || e === null) return e;
  if (!("head" in e)) {
    if (!known.has(e.name)) return e.name;
    check(e.name);
    return { head: { name: e.name } };
  }
  const head = e.head;
  if (typeof head !== "object" || head === null || "head" in head) {
    throw new Error("can only apply symbols");
  }
  check(head.name);
  const out = { head: { name: head.name } };
  if (e.args === undefined) return out;
  const args = Array.isArray(e.args)
    ? e.args.map((a) => normalise(a, known, check))
    : Object.fromEntries(
      Object.entries(e.args).map(([k, a]) => [k, normalise(a, known, check)]),
    );
  return { ...out, args };
}

/**
 * Parse selection text with Mol*'s MolScript, PyMOL, VMD or Jmol front end into
 * a plain MolQL expression tree, for `@molgpu/select`'s `compile`. "PyMOL
 * semantics" here means Mol*'s transpiler's reading of PyMOL, not PyMOL's own.
 */
export async function parseSelection(
  language: SelectionLanguage,
  text: string,
  options: {
    /**
     * Symbol names the caller can evaluate, for example `@molgpu/select`'s
     * `supportedSymbols`. Any other symbol fails with an `IoError` (code
     * `UNSUPPORTED_SYMBOL`) that names the source language, rather than a
     * later compile error.
     */
    readonly symbols?: readonly string[];
  } = {},
): Promise<SelectionExpr> {
  if (!LANGUAGES.includes(language)) {
    throw new TypeError(
      `@molgpu/io parseSelection: language must be one of ${
        LANGUAGES.join(", ")
      }`,
    );
  }
  if (typeof text !== "string" || !text.trim()) {
    throw selectionError(language, "empty selection", "INVALID_SELECTION");
  }
  const allowed = options.symbols ? new Set(options.symbols) : null;
  const check = (name: string) => {
    if (allowed && !allowed.has(name)) {
      throw selectionError(
        language,
        `'${text}' uses symbol '${name}', which is not supported`,
        "UNSUPPORTED_SYMBOL",
      );
    }
  };
  const known = await molqlSymbols();
  let parsed: MolExpr;
  try {
    parsed = await molExpression(language, text);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : JSON.stringify(error);
    throw selectionError(
      language,
      `cannot parse: ${message}`,
      "INVALID_SELECTION",
      error,
    );
  }
  try {
    return normalise(parsed, known, check);
  } catch (error) {
    if (error instanceof IoError) throw error;
    throw selectionError(
      language,
      (error as Error).message,
      "INVALID_SELECTION",
      error,
    );
  }
}
