# Code comments and doc comments

Rules for `//`, `#`, `/* */`, docstrings, JSDoc/TSDoc, GoDoc, Rustdoc and similar. Read `style.md` first.

## What a comment is for

A comment says what the code cannot. It works at a different level than the code. Higher: intent, the reason for this approach, the invariant the code maintains. Lower: units, bounds, what null means, ownership, thread safety. A comment at the same level as the code repeats it and should go.

Keep a comment that records:

- a constraint the code cannot express: an ordering requirement, an external contract, a limit and where it comes from;
- a reason for a non-obvious choice, including what the alternative was and why it lost;
- a workaround: what it works around, the trigger, and when it can be removed;
- a warning about a consequence the reader would not expect;
- a pointer to the one place a cross-module decision is written down.

Delete a comment that:

- restates the line below it ("increment the counter", "return the result");
- restates the signature ("takes a user and returns their name");
- narrates the change ("updated to", "now uses", "no longer", "refactored", "added to address review");
- describes the author's process or feelings ("this was tricky", "the whole point");
- explains language or library behaviour the reader is expected to know;
- is a section banner or a `Note:` with nothing after it that the code does not say.

If the only way to make code clear is a comment, first ask whether a name, a constant or a small extraction would do it. Suggest that in the report when it is beyond a prose edit.

## Doc comments (interface comments)

A doc comment is for the caller. It documents the contract, not the implementation.

- First sentence is a summary that stands alone; tooltips and index pages show only that sentence. Do not start it with the symbol's name or "This function".
- Say what the caller must know: preconditions, what each argument means when the type does not say, what is returned, what null or an empty value means, side effects, errors thrown and when, blocking or async behaviour, thread safety, and anything that must be cleaned up.
- Do not say how it is done inside. If the implementation matters to the caller (for example a cost or a caching behaviour), state the observable effect, not the mechanism.
- Do not list parameters with tautological text (`@param name the name`). Either the description adds information or the tag goes.
- Booleans: "True if ...; false otherwise." Defaults: "Default: 30." Deprecations: "Deprecated. Use X instead." in the first sentence.
- Keep the language's convention: Go comments start with the symbol name; Python docstrings are one summary line then a blank line; Rust uses `# Examples`, `# Errors`, `# Panics` sections.

## Implementation comments

Inside a function body, a comment explains a reason the reader cannot see: why a check exists, where a magic number comes from, which case a branch handles. It does not describe what the next line does.

- Put the comment above the code it explains, not at the end of a long line, unless the block's existing style is trailing comments.
- One comment per non-obvious decision. A comment on every line means the code needs restructuring, not more comments.
- `TODO` and `FIXME` carry an owner or a ticket and say what is to be done. A `TODO` with no action is deleted.
- A comment that has become false because of this change is a defect. Fix it or remove it.

## Tests

Comments in tests are in scope. A test name should say what is asserted; a comment above a test that repeats its name goes. Keep comments that explain a fixture's shape or why an odd value is used. Do not touch string fixtures unless they are wrong.

## Examples

<example>
Before: /** The scale this page was actually rendered at — below `PageRenderOptions.scale` when the page's geometry tripped the raster clamp. */
After: /** The scale used for this render. Lower than `PageRenderOptions.scale` when the raster clamp applied. */
</example>

<example>
Before: // The estimator's refusal thresholds are calibrated at ESTIMATION_SCALE, so its input is clamped by the same rule rather than left at the raw scale — otherwise the one render the clamp exists to prevent would be the measurement render.
After: // Clamp the estimator's input with the same rule. Its thresholds are calibrated at ESTIMATION_SCALE, and an unclamped measurement render would be the allocation the clamp exists to prevent.
</example>

<example>
Before: // A new tab, so a reader who opens a document does not leave the case they are working on. `noreferrer` severs `window.opener` as well as withholding the referrer.
After: // Open in a new tab so the case page stays open. `noreferrer` also clears `window.opener`.
</example>

<example>
Before: // increment the counter
After: (deleted)
</example>
