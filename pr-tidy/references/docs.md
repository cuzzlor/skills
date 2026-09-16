# Markdown and other documentation

Rules for README files, `docs/`, decision records, guides and any `.md`, `.mdx`, `.rst` or `.adoc` file. Read `style.md` first.

## Shape

- Reference-shaped, not essay-shaped. A reader arrives with a question and leaves with the answer. Put the answer first, then the conditions, then the detail.
- Paragraphs of one to three sentences. Six is the maximum.
- Anything enumerable goes in a table: options, commands, routes, environment variables, files and what they own. A bulleted list of "**Label**: value" rows is a table that has not been drawn yet.
- Numbered lists for sequences, bullets for unordered items, prose for a single point or an argument.
- A fact lives in one place. Elsewhere, link to it. Do not restate a fact another page owns.
- No section that exists only to introduce the next section. No closing summary.
- Headings in sentence case. A noun phrase or an imperative, not a gerund: "Configuration", "Run the tests", not "Configuring" or "Running the tests". No heading with a single paragraph under it unless it is a navigation target.
- Contents list on a page longer than about two screens. Update it when you add or remove a heading.

## Content

- Write for the reader the page names. A README is for someone who has not seen the code; a `docs/architecture.md` is for someone about to change it. Do not explain the language or the framework to either.
- Describe the current state. History goes in decision records or the commit log. When a decision record exists, the doc page states the decision and links the record; it does not repeat the rationale.
- Rationale is short: the constraint and the choice. A decision record may hold more, but it too is plain: context, decision, consequences.
- Second person for instructions ("run", "set"), third person for descriptions ("the job retries"). Do not use "we" for the software.
- Conditions before instructions: "If the cache is cold, run the warm-up script", not the reverse.
- Do not pre-announce features or describe planned work as if it existed.
- Every command and path is in code font and is real. Check that an example command still runs after this change.
- Links to code use relative paths and stay accurate after a rename in this branch.

## Format

- Run the repository's Markdown formatter on files you edited if one is configured (Prettier, oxfmt, dprint, markdownlint). Do not hand-align tables.
- Bold only for UI labels and the one warning a reader must not miss. Do not bold lead-in phrases.
- No emphasis by italics in reference material.
- No `---` thematic breaks between sections; headings separate sections.
- Keep front matter and admonition syntax that the site generator needs.

## Examples

<example>
Before: **The per-view controls travel.** They sit at the end of the tab row, which is the frame's, so each view portals its buttons there ([case-actions.tsx](...)), as the breadcrumb already does for its own.
After: Each view renders its buttons into the tab row through a portal ([case-actions.tsx](...)). The breadcrumb uses the same mechanism.
</example>

<example>
Before: A switch still costs one `case.viewed` audit row, plus one for the frame per case; Traces no longer reads the case, so a walk through all four is unchanged.
After: Switching views writes one `case.viewed` audit row. Opening a case writes one more for the layout. Visiting all four views writes five rows, the same as before this change.
</example>

<example>
Before:
- **Scope**: all widgets
- **Format**: CSV
- **Schedule**: nightly at 02:00
After:
| Setting | Value |
| --- | --- |
| Scope | All widgets |
| Format | CSV |
| Schedule | Nightly at 02:00 |
</example>
