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
 * The heuristic is deliberately conservative: the auto-wrap only
 * triggers when the agent emitted ZERO delimiters of any flavour. As
 * soon as the agent does even one `$x$` we trust they followed the
 * contract and leave their content alone — wrapping mixed prose-plus-
 * inline-math content would break the prose half.
 *
 * Recognised TeX-command shapes:
 *   - `\command{...}`  e.g. `\sqrt{...}`, `\frac{a}{b}`, `\mathbb{R}`
 *   - `\command\b`     for a small allowlist of bare-greek / operator
 *                       commands that legitimately appear without
 *                       braces (e.g. `x = \pi`, `\sum_{i=1}^n`).
 *
 * Things this does NOT wrap (intentionally):
 *   - Pure prose (no backslash-commands).
 *   - Strings containing any `$` (agent followed the contract).
 *   - Strings containing `\(` or `\[` (already-LaTeX-native, the
 *     existing `normaliseMathDelimiters` step in `<MessageResponse>`
 *     converts those).
 *   - Windows-style paths (`C:\Users\foo`) — no braces, not in the
 *     allowlist.
 *   - Markdown escapes (`\*foo\*`) — single non-alpha after `\`.
 *
 * Examples:
 *   wrapBareLatex("\\sqrt{4} = 2")            === "$$\\sqrt{4} = 2$$"
 *   wrapBareLatex("x = \\pi")                  === "$$x = \\pi$$"
 *   wrapBareLatex("$\\sqrt{4}$")               === "$\\sqrt{4}$"
 *   wrapBareLatex("$$\\sqrt{4}$$")             === "$$\\sqrt{4}$$"
 *   wrapBareLatex("\\(\\sqrt{4}\\)")           === "\\(\\sqrt{4}\\)"
 *   wrapBareLatex("Voici la résolution.")     === "Voici la résolution."
 *   wrapBareLatex("")                          === ""
 *   wrapBareLatex("path: C:\\Users\\foo")     === "path: C:\\Users\\foo"
 */
export function wrapBareLatex(input: string): string {
  if (!input || input.length === 0) return input;
  // Already contains math delimiters of any kind — trust the agent.
  if (input.includes("$")) return input;
  if (input.includes("\\(") || input.includes("\\[")) return input;
  if (!looksLikeTeX(input)) return input;
  return `$$${input}$$`;
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
