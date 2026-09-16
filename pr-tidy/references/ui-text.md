# UI text

Rules for strings a user sees: JSX text, labels, titles, placeholders, tooltips, helper text, empty states, toasts, dialog text, validation and error messages, and i18n resource files. Read `style.md` first.

Drawn from the Microsoft Writing Style Guide, Apple Human Interface Guidelines, Material Design writing guidance, GOV.UK Design System and Nielsen Norman Group error-message guidelines.

## Confirm the string is UI text

The gather script marks `ui text` for JSX text, common UI props, toast and notification calls, thrown user-facing errors and i18n files. It marks `ui text?` when a string only looks like a sentence. Before editing a `ui text?` string, follow it to where it is rendered. Do not edit log messages, test fixtures, internal error codes or developer-facing assertion text as UI text.

## General

- Front-load. The first two words carry the meaning; a user scans.
- Fewer words. Cut "you can", "there is", "in order to", "please", "simply".
- Sentence case for everything: titles, headings, labels, menu items, buttons. No end punctuation on titles, labels, buttons or list items. Full sentences end with a full stop.
- Present tense, second person, contractions allowed. Never mix "my" and "your" in one screen.
- One term per concept, the same term the rest of the product uses. Refer to a control by its label text, not its widget type ("select **Save**", not "click the Save button").
- No exclamation marks, no humour, no marketing adjectives, no absolutes ("never", "always") unless literally true.
- Numerals, not words. Units and formats the user knows.
- Keep interpolation tokens (`{count}`, `%s`, `{{name}}`), i18n keys, pluralisation syntax and HTML entities exactly as they are. Do not change a key; it is an identifier.

## Buttons and actions

- A verb, one or two words: "Save", "Delete report", "Try again". Not "OK" or "Yes" unless the dialog is purely informational.
- The cancel action is "Cancel". The destructive action names what it destroys.
- Input-neutral verbs: "select", "enter", "choose", "open", "turn on". Not "click", "tap", "hit".

## Errors and validation

Each message says what happened and what to do next, in the user's words, for one cause.

- Say the specific problem, not "Something went wrong" or "An error occurred". If the cause is unknown, say what the user can do: "Could not save the widget. Try again, or contact support if it keeps happening."
- State the fix as an instruction or a constraint: "Enter a name", "Name must be 35 characters or fewer". Match the field's label.
- No blame: not "you entered", "invalid", "illegal", "forbidden", "you forgot".
- No apology, no "Oops", no "Sorry" except for a serious product-caused loss.
- No technical terms: not "null", "undefined", "exception", "500", "server", "database", "API", "resolver", "timeout", "payload", "token". If a support code is needed, put it last and label it: "Reference: 4F2A".
- Keep the user's input. Place the message next to the field. Do not truncate.
- Titles of alerts state the problem; they are not "Error" or "Warning".

## Empty states, loading, confirmation

- Empty state: what is missing and the one action that fills it. "No reports yet. Generate a report to see it here."
- Loading: what is happening, present participle, no ellipsis needed for a single word ("Loading", "Detecting sections").
- Confirmation: what will happen, in the user's terms, with the consequence if it is irreversible. The confirm button repeats the verb.
- Success: short, past tense, no exclamation: "Report saved".

## Examples

<example>
Before: toast("Oops! Something went wrong. Please try again later!")
After: toast("The widget was not saved. Try again.")
</example>

<example>
Before: <p>Please select a widget below in order to view its comprehensive report.</p>
After: <p>Select a widget to view its report.</p>
</example>

<example>
Before: "report.empty": "Sorry, an unexpected error occurred while fetching your data from the server!"
After: "report.empty": "Could not load the report. Try again."
</example>

<example>
Before: title="Save the widget to the database"
After: title="Save the widget"
</example>

<example>
Before: "Simply click generate to seamlessly produce your report."
After: "Select Generate to create the report."
</example>
