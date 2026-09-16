# Public API schema descriptions

Rules for GraphQL SDL block strings, `description:` and `deprecationReason:` in code-first builders (Pothos, Nexus, TypeGraphQL, NestJS, graphql-js), `@deprecated(reason:)`, OpenAPI `summary` and `description`, and doc comments in `.proto` files. Read `style.md` first.

A schema description is a contract. The reader is a consumer of the API: a front-end developer, a partner, a script author. They see the description in a schema explorer, in generated docs and in editor tooltips. They cannot see the code, and they must not need to. Treat every schema as public unless the project's docs say which schemas are internal.

## Write what the consumer needs

For each type, field, argument, input field and enum value, the description answers what the name and type do not:

- **Meaning.** What the value is in the domain. "Total sales for the period, in cents."
- **Units and format.** Currency, timezone, precision, encoding, the date format, the ID format.
- **Null and empty.** What null means as distinct from zero or an empty list. "Null when no case was approved in the period."
- **Ordering, paging, limits.** Sort order, page size bounds, cursor stability, maximum length.
- **Permissions and visibility.** Who can read or set it and what a caller without permission sees: null, an empty list, or an error. Say the effect, not the role name from the code.
- **Effect of a mutation.** What changes, what is returned, and what error codes a caller should handle.
- **Enum values.** When each applies, not how it is stored.
- **Deprecation.** The replacement and the migration, in the first sentence: "Deprecated. Use `totalSales`." If there is a removal date the project has committed to, state it.

Start a field or type description with a noun phrase, a mutation with a verb. Do not repeat the field name or type. Do not write "This field ...". One to three sentences; use a fourth only for a permission or null rule.

## Remove what leaks the implementation

A consumer cannot use these and must not depend on them. Remove them from public descriptions even when they are true:

- names of services, classes, resolvers, loaders, tables, columns, indexes, caches, queues, jobs, workers, cron schedules and storage engines;
- how the value is computed or where it is read from ("computed from the usage ledger", "cached in Redis for an hour");
- which UI screen, tile or control uses the field, and how the UI expresses it;
- internal role tiers, feature flags and configuration keys by their code names;
- ticket numbers, team names, "we", "our", "the team";
- the words "legacy", "hack", "workaround", "for now", "temporary", "eventually", and history ("renamed from", "used to be");
- comments about the codebase or the review addressed to colleagues.

When a leaked sentence carries a fact the consumer does need, keep the fact and drop the mechanism. "Cached for an hour" becomes "May be up to one hour old." "Only honoured for callers with the `CROSS_INSTANCE` tier" becomes "Ignored unless the caller can read all instances." "The cost panel is computed from the usage ledger rather than from cases, so it is unaffected" becomes "Does not affect cost figures."

Where the field is public but the fact is for maintainers, move the sentence to a code comment next to the resolver, or to the project's docs. Say in the report that you moved it.

## Format

- CommonMark is allowed. Use code spans for field, type and enum names. No headings, no bold, no lists in a field description. A type description may use a short list when it enumerates states.
- Keep the description a block string (`"""`) when it was one; keep a single-line string when it was one. Do not change quoting style across a file.
- Do not touch names, types, nullability, directives, default values or argument order. Do not add or remove `@deprecated`; propose it in the report.
- Every public type, field, argument and enum value should have a description. Do not write one that repeats the name ("The ID of the widget" on `Widget.id`). Report missing descriptions only if the project's lint requires them.
- OpenAPI: `summary` is a short imperative phrase with the same verb per method ("Get a widget", "List widgets"), under about 50 characters, without the path. `description` covers effect, side effects, auth and errors.

## Examples

<example>
Before:
"""
Total sales in cents. Computed by the ReportService from the sales table in Postgres and cached in Redis for
an hour, so the UI's dashboard tile can render without a round trip. See ticket WID-123.
"""
totalSales: Int!
After:
"""
Total sales for the period, in cents. May be up to one hour old.
"""
totalSales: Int!
</example>

<example>
Before:
"""
Narrow a cross-instance (staff) view to a single instance. Only honoured for callers with the `CROSS_INSTANCE` tier — ignored for everyone else, so it can never widen a narrower caller's access. This is how the UI's tier switcher is expressed: the "instance" tier pins this to the caller's own instance, the "all instances" tier leaves it absent.
"""
instanceId: UUID
After:
"""
Limit results to one instance. Ignored unless the caller can read all instances, so it can never widen access.
"""
instanceId: UUID
</example>

<example>
Before: sales: Int @deprecated(reason: "Renamed; the resolver just proxies totalSales now.")
After: sales: Int @deprecated(reason: "Use `totalSales`.")
</example>

<example>
Before: description: "A nightly report. Our worker generates this via the BullMQ queue at 02:00."
After: description: "A report generated once a day."
</example>

<example>
Before:
"""
`value` is null on days the metric has no meaningful figure (e.g. an average-turnaround day with no
approvals) — distinct from a genuine zero — so a trend line can bridge the gap rather than dip to 0.
"""
After:
"""
Null on days with no data for the metric, for example a day with no approvals when the metric is an average. Zero is a measured value.
"""
</example>
