/**
 * LaTeX-handling helpers for content authored by the LLM agent.
 *
 * Used by chat-surface render blocks (`<StepwiseSolutionCards>`,
 * `<HintLadderChip>`, etc.) that pipe an agent-authored field through
 * Streamdown's `remark-math` pipeline. The agent is *contractually*
 * supposed to wrap math in `$...$` / `$$...$$` delimiters, but in
 * practice it sometimes ships bare LaTeX with no delimiters at all —
 * `\sqrt{1^2 + 3} = 2` instead of `$\sqrt{1^2 + 3} = 2$`. Without
 * delimiters, `remark-math` doesn't see the math and the student sees
 * the raw source.
 *
 * Tightening the prompt isn't enough — defense-in-depth at render
 * matches the production-grade pattern Streamdown itself uses for
 * `\(...\)` / `\[...\]` rewriting.
 */

/**
 * If a string is *clearly* bare LaTeX (TeX commands present, but no
 * math delimiters at all), wrap the entire body in `$$...$$` so
 * `remark-math` will render it. Otherwise return the input unchanged.
 *
 * Two failure modes are auto-corrected:
 *
 *   1. Bare LaTeX with NO delimiters at all
 *      e.g. `\sqrt{4} = 2`            → `$$\sqrt{4} = 2$$`
 *
 *   2. Malformed delimiters — agent emitted unbalanced `$$` or `$`
 *      (one of the pair forgotten).
 *      e.g. `\begin{pmatrix}…\end{pmatrix}$$`  (trailing `$$`, no opener)
 *      In this case ALL stray delimiters are stripped and the content
 *      is rewrapped cleanly in `$$...$$`.
 *
 * When the agent already emitted balanced delimiters of any flavour,
 * we trust the contract and return the input unchanged — wrapping
 * mixed prose-plus-inline-math content would break the prose half.
 *
 * Recognised TeX-command shapes:
 *   - `\command{...}`  e.g. `\sqrt{...}`, `\frac{a}{b}`, `\mathbb{R}`
 *   - `\command\b`     for a small allowlist of bare-greek / operator
 *                       commands that legitimately appear without
 *                       braces (e.g. `x = \pi`, `\sum_{i=1}^n`).
 *
 * Things this does NOT touch (intentionally):
 *   - Pure prose (no backslash-commands).
 *   - Strings containing balanced `$...$` / `$$...$$` (contract OK).
 *   - Strings containing `\(` or `\[` (already-LaTeX-native, the
 *     existing `normaliseMathDelimiters` step in `<MessageResponse>`
 *     converts those).
 *   - Windows-style paths (`C:\Users\foo`) — no braces, not in the
 *     allowlist.
 *   - Markdown escapes (`\*foo\*`) — single non-alpha after `\`.
 *
 * Examples:
 *   wrapBareLatex("\\sqrt{4} = 2")                  === "$$\\sqrt{4} = 2$$"
 *   wrapBareLatex("x = \\pi")                        === "$$x = \\pi$$"
 *   wrapBareLatex("$\\sqrt{4}$")                     === "$\\sqrt{4}$"
 *   wrapBareLatex("$$\\sqrt{4}$$")                   === "$$\\sqrt{4}$$"
 *   wrapBareLatex("\\(\\sqrt{4}\\)")                 === "\\(\\sqrt{4}\\)"
 *   wrapBareLatex("\\begin{pmatrix}1\\end{pmatrix}$$")
 *                                                    === "$$\\begin{pmatrix}1\\end{pmatrix}$$"
 *   wrapBareLatex("Voici la résolution.")           === "Voici la résolution."
 *   wrapBareLatex("")                                === ""
 *   wrapBareLatex("path: C:\\Users\\foo")           === "path: C:\\Users\\foo"
 */
export function wrapBareLatex(input: string): string {
  if (!input || input.length === 0) return input;
  // Already-LaTeX-native delimiters — `normaliseMathDelimiters` in
  // `<MessageResponse>` rewrites these to `$...$` / `$$...$$` upstream
  // of remark-math, so we don't touch them here.
  if (input.includes("\\(") || input.includes("\\[")) return input;

  // Detect malformed/half-emitted delimiters (one of the pair missing).
  // An odd number of `$$` tokens means at least one stray opener or
  // closer — `remark-math` will then either render the wrong span as
  // display-math or (more commonly) fail the block and emit raw text,
  // which is the failure mode that motivated this util.
  const dollarDollarCount = (input.match(/\$\$/g) || []).length;
  if (dollarDollarCount % 2 !== 0) {
    if (!looksLikeTeX(input)) return input;
    // Strip ALL math delimiters from the body (both `$$` pairs and
    // any single `$` tokens that aren't backslash-escaped) and
    // rewrap the whole thing in one clean `$$...$$` block.
    return `$$${stripAllMathDelimiters(input)}$$`;
  }

  // After balanced `$$...$$` pairs have been accounted for, check
  // residual single-`$` tokens for the same imbalance.
  const withoutDisplayBlocks = input.replace(/\$\$[\s\S]*?\$\$/g, "");
  const singleDollarCount = (withoutDisplayBlocks.match(SINGLE_DOLLAR_RE) || [])
    .length;
  if (singleDollarCount % 2 !== 0) {
    if (!looksLikeTeX(input)) return input;
    return `$$${stripAllMathDelimiters(input)}$$`;
  }

  // Delimiters are balanced — trust the agent if any `$` is present.
  if (input.includes("$")) return input;
  // Bare LaTeX with no delimiters at all.
  if (!looksLikeTeX(input)) return input;
  return `$$${input}$$`;
}

// Matches a single `$` not preceded by a backslash. Used to count
// inline-math tokens after stripping balanced `$$...$$` blocks.
const SINGLE_DOLLAR_RE = /(?<!\\)\$/g;

function stripAllMathDelimiters(input: string): string {
  return input.replace(/\$\$/g, "").replace(SINGLE_DOLLAR_RE, "").trim();
}

// Allowlist of bare-greek / operator commands that legitimately appear
// without braces in LaTeX math (e.g. `x = \pi`, `\sum_{i=0}^n`,
// `a \cdot b`). Anything not in this list AND not followed by `{` is
// treated as not-TeX (e.g. a Windows path like `\Users`).
const BARE_TEX_COMMANDS = new Set([
  // Greek letters
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "pi",
  "varpi",
  "rho",
  "varrho",
  "sigma",
  "varsigma",
  "tau",
  "upsilon",
  "phi",
  "varphi",
  "chi",
  "psi",
  "omega",
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
  // Big operators
  "sum",
  "int",
  "prod",
  "coprod",
  "oint",
  "lim",
  "limsup",
  "liminf",
  "max",
  "min",
  "sup",
  "inf",
  // Functions
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  "log",
  "ln",
  "exp",
  "det",
  "dim",
  "deg",
  "ker",
  "gcd",
  // Relations & operators
  "cdot",
  "cdots",
  "ldots",
  "vdots",
  "ddots",
  "times",
  "div",
  "pm",
  "mp",
  "ast",
  "star",
  "leq",
  "geq",
  "neq",
  "ne",
  "le",
  "ge",
  "equiv",
  "sim",
  "simeq",
  "cong",
  "approx",
  "propto",
  "in",
  "notin",
  "subset",
  "supset",
  "subseteq",
  "supseteq",
  "cap",
  "cup",
  "wedge",
  "vee",
  "to",
  "rightarrow",
  "leftarrow",
  "Rightarrow",
  "Leftarrow",
  "leftrightarrow",
  "Leftrightarrow",
  "mapsto",
  // Symbols
  "infty",
  "partial",
  "nabla",
  "forall",
  "exists",
  "neg",
  "emptyset",
  "varnothing",
  "ell",
  "Re",
  "Im",
  "circ",
  "perp",
  "parallel",
]);

function looksLikeTeX(s: string): boolean {
  // Strong signal: any `\command{...}` form. Pure prose almost never
  // uses backslash-name-brace; this catches \sqrt{}, \frac{}{},
  // \mathbb{R}, \begin{align}, \text{...}, etc.
  if (/\\[a-zA-Z]+\s*\{/.test(s)) return true;
  // Weaker signal: bare command from the allowlist. Have to scan
  // every match because we want at least one to land in the set
  // (a single `\Users` doesn't count; `\pi` does).
  const re = /\\([a-zA-Z]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (BARE_TEX_COMMANDS.has(m[1])) return true;
  }
  return false;
}
