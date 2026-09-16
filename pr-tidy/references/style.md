# Writing style

Plain technical English for a technical reader. Read this before you edit any prose. The other references add rules for one type of text. This one applies to all of them.

Contents: [What mannered prose is](#what-mannered-prose-is) · [Core rules](#core-rules) · [Word substitutions](#word-substitutions) · [Tells and their fixes](#tells-and-their-fixes) · [Examples](#examples) · [How to edit](#how-to-edit)

## What mannered prose is

Mannered prose substitutes metaphor and flourish for direct statement. Instead of "a parameter worth varying" it says "a dial worth turning". Instead of "the progress bar is hidden once conversion finishes" it says "the measure of the work has gone". The reader must translate before they can use the sentence, and the translation can be wrong. The fix is to say what you mean. When a literal phrase is available, use it.

Mannered prose also includes padding: preambles, closing summaries, hedges, self-praise, and words that carry no information. A passage is padded when removing a word or sentence loses nothing the reader needs.

Both come from the same habit: writing to sound a certain way rather than to inform. Edit for the reader who has one question and wants the answer.

## Core rules

Adapted from ASD-STE100 Simplified Technical English (Issue 9), the Google developer documentation style guide, and GOV.UK content guidance. The rules are the checklist; the reasons are there so that you can handle a case the rule does not name.

1. **One meaning per word, one word per meaning.** Use the same term for the same thing everywhere in the change. Do not vary a term to avoid repetition; repetition is how a reader knows two sentences describe the same thing.
2. **Active voice, present tense.** "The job retries three times", not "three retries will be attempted". Passive is acceptable only when the actor is unknown or irrelevant.
3. **Short sentences.** At most 20 words for an instruction, 25 for a description. Split a long sentence at its conjunction. One instruction per sentence.
4. **One topic per paragraph, at most six sentences.** Put the topic in the first sentence.
5. **No figurative language.** No metaphor, idiom, personification of code beyond the conventional ("the function returns"), rhetorical questions, or wordplay.
6. **No filler.** Delete "in order to", "note that", "it is worth noting", "basically", "simply", "just", "actually", "really", "of course", "as mentioned above". Delete a sentence that announces the next sentence.
7. **No self-praise or intensifiers.** Delete "robust", "seamless", "comprehensive", "elegant", "clean", "powerful", "highly", "very". State the property instead: "handles a null body" rather than "robust".
8. **No hedges where the fact is known.** "Returns null when the user has no plan", not "may return null in some cases". Where behaviour is conditional, name the condition.
9. **Commit to a number.** "Retries 3 times", not "retries a few times".
10. **Literal over clever.** If two phrasings are available and one is literal, use the literal one.
11. **Standard punctuation, sparingly.** Commas, full stops, colons, parentheses. Replace a spaced em-dash aside with a comma, a colon, parentheses or a new sentence. Avoid semicolons; start a new sentence. No exclamation marks.
12. **No change narration in code or docs.** "Updated to use X", "now returns Y", "previously Z" belong in the commit message. Describe the current state only.
13. **Articles and full words.** Do not drop "the" or "a" to save space. No contractions in reference material; contractions are fine in UI text.
14. **Follow the repository's spelling variant.** Do not change "behaviour" to "behavior" or the reverse.
15. **Code, identifiers, commands, paths and quoted strings are exempt** from the word rules. Put them in code font in Markdown and keep them exact.

## Word substitutions

Prefer the right column. The left column is a signal to look, not a banned list; a word is fine when it is the exact technical term.

| Instead of | Write |
| --- | --- |
| utilise, utilize, leverage, employ | use |
| ensure, guarantee (when not literal) | make sure, check, or state the mechanism |
| facilitate, enable (a person) | let, help, or the specific verb |
| allows you to, enables you to | lets you, or the imperative |
| in order to | to |
| prior to, subsequent to | before, after |
| in the event that, should X occur | if |
| regarding, with regard to, in terms of | about, for |
| a number of, a variety of | several, or the number |
| initiate, commence, terminate | start, stop |
| perform a check, make a determination | check, determine |
| via | through, with, or name the mechanism |
| e.g., i.e., etc. | for example, that is, and name the rest or stop |
| delve, dive into | look at, or delete |
| crucial, pivotal, vital, key, essential | important, or delete |
| streamline, enhance, bolster, foster | the measured change, or delete |
| serves as, acts as, functions as, represents | is |
| is responsible for, is designed to, is intended to, is used to | the verb: "parses", "stores" |
| please (in instructions) | delete |
| Note that, Please note, It is worth noting | delete; state the fact |
| going forward, at this point in time | from now on, now |
| in most cases, typically, generally | name the condition, or delete |

## Tells and their fixes

Patterns that mark mannered or machine-padded prose. Each is a frequency, not a proof; look for clusters. The gather script flags some of these; the rest need reading.

**Structure**

- Bold lead-in sentence used as a paragraph label ("**The frame owns the case.** ..."). Fix: make it a heading if the section needs one, or a plain first sentence.
- Bulleted "**Label**: value" lists with three or more rows. Fix: a table, or prose.
- Headings for every paragraph, headings in Title Case, gerund headings ("Generating reports"). Fix: fewer headings, sentence case, noun or imperative ("Reports", "Generate a report").
- Preamble ("This section describes...") and closing summary ("In summary..."). Fix: delete.
- Rule of three: "clear, concise and actionable"; three adjectives where one is true. Fix: keep the true one.
- Sentence fragment for emphasis ("Every time."). Fix: join it or delete it.
- A thematic break `---` between sections. Fix: delete.

**Rhetoric**

- Antithesis: "not just X but Y", "X isn't Y, it's Z", "rather than X, Y". Fix: state Y.
- Rhetorical question followed by its answer. Fix: the answer.
- Trailing participle that adds commentary: "..., ensuring consistency", "..., highlighting the need for X". Fix: delete, or a separate factual sentence.
- Personification and metaphor: "the clamp declines to act", "the header travels", "a guard that takes down the thing it guards", "the whole point of". Fix: the literal event.
- Aphorism or maxim as a justification. Fix: the specific reason, with its condition.
- Chat residue: "Great question", "I hope this helps", "Let's". Fix: delete.

**Vocabulary**

- Words from the substitution table above, and: tapestry, landscape, realm, journey, ecosystem, paradigm, holistic, nuanced, meticulous, myriad, plethora, bespoke, at its core, in essence, under the hood, behind the scenes.
- Sincerity markers: genuinely, honestly, truly, actually, straightforward. Fix: delete.
- Stacked adverbs: "significantly improves", "seamlessly integrates". Fix: the measurement, or the plain verb.

## Examples

Before and after pairs. Each "after" is what a plain rewrite looks like; match its register.

<example>
Before (comment): A guard that takes down the thing it guards is worse than no guard: the deadlines and the memory ceiling still stand behind it.
After: If the page size cannot be read, the clamp does nothing and the render continues. The deadline and memory ceiling still apply.
</example>

<example>
Before (comment): This is the render the clamp is really for: at 4× the pixels of the plain one, and rotated and resampled after, it is the largest allocation in the whole page path.
After: This render uses 4× the pixels of the plain render and is the largest allocation in the page path.
</example>

<example>
Before (comment): The whole point of the settled state: the measure of the work has gone.
After: In the settled state the progress indicator is hidden.
</example>

<example>
Before (doc): **The layout is a workbench.** This is the one view that fills the window instead of scrolling it. The height is the frame's — `100dvh − --header-height` — applied only when the route is active.
After: The case layout fills the window; other pages scroll. Its height is `100dvh − --header-height`, applied only while the route is active.
</example>

<example>
Before (doc): This section describes the comprehensive reporting feature. It leverages our robust pipeline in order to seamlessly deliver insights — not just data, but understanding. Note that reports are generated nightly.
After: Reports are generated nightly as CSV.
</example>

<example>
Before (comment): // This function is responsible for registering the report type. Updated to use the new builder API.
After: (deleted; the function name says this, and the history belongs in the commit)
</example>

<example>
Before (comment): // Reading the page's size neither rasterises nor consumes the handle, so this costs nothing and happens before any allocation — which is the point: the clamp has to be decided before PDFium is asked for the bytes, not after.
After: // Reading the page size does not rasterise or consume the handle. The clamp must be decided before PDFium allocates the raster, so it runs here.
</example>

## How to edit

1. Read the whole passage and the code it describes. Decide what the passage is for: a contract, a reason, a warning, a pointer, or nothing.
2. If nothing, delete it.
3. Otherwise write the literal statement in one or two short sentences. Start with the fact, not with the context.
4. Compare with the original. Every fact the original carried is either in your version or was false or useless. Nothing new is added.
5. Read your version once more for the tells above. Then stop; do not polish.

Edit the prose only. Never change identifiers, values, keys, types, directives or code structure while editing a passage. When a passage is wrong and fixing the prose is not enough, report it rather than changing the code.
