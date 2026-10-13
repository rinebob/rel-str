# Robinhood MCP — SEC Filings

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 4 tools in this group.

### get_sec_filing

**Safety:** read-only · **Status:** probed

Read an SEC filing's table of contents or a specific section's text. Use get_sec_filing_index to find a filing_id first.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filing_id | string | yes | Filing identifier returned by get_sec_filing_index. |
| section | string | no | Section identifier from the table of contents (the id field). Omit to get the full table of contents; provide to get a specific section's text. |

**Response shape** (union over 2 success capture(s)):

```
data: object
data.table_of_contents: object
data.table_of_contents.filing_id: string
data.table_of_contents.form_type: string
data.table_of_contents.sections: array<object>
data.table_of_contents.sections[].id: string
data.table_of_contents.sections[].title: string
data.table_of_contents.sections[].level: number
data.section: object
data.section.filing_id: string
data.section.form_type: string
data.section.section_id: string
data.section.section_title: string
data.section.content: string
guide: string
```

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-sec-filing-01](captures/dep-sec-filing-01.json) — success — AAPL 10-K filed 2025-10-31 - source of section ids for wave-3.
- [dep-sec-filing-02](captures/dep-sec-filing-02.json) — success — section param - TOC section id harvested from dep-sec-filing-01.
- [err-sec-bad-id](captures/err-sec-bad-id.json) — error — Deliberate error: nonexistent filing id.

**Notes:**

- AAPL 10-K filed 2025-10-31 - source of section ids for wave-3.
- section param - TOC section id harvested from dep-sec-filing-01.
- Deliberate error: nonexistent filing id.

### get_sec_filing_facts

**Safety:** read-only · **Status:** probed

Get reported facts tagged under specific GAAP concept names in one or more SEC filings — financial figures (revenue, net income, assets, debt) and disclosures (e.g. debt schedules, related-party transactions, subsequent events) alike. Use get_sec_filing_index to find filing_ids first.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filing_ids | null \| array | yes | Filing identifiers to fetch facts for (1-3), from get_sec_filing_index. Default to a single filing_id — most questions are answered by periods already embedd… |
| concepts | null \| array | yes | GAAP concept names to fetch (1-10) — covers numeric line items (e.g. NetIncomeLoss, Assets, Revenues) and disclosure text blocks (e.g. ScheduleOfDebtTableTex… |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.facts: array<object>
data.facts[].filing_id: string
data.facts[].concept: string
data.facts[].entity: string
data.facts[].period: string
data.facts[].axises: array<string>
data.facts[].decimals: number
data.facts[].value: string
data.facts[].char_value: string
data.facts[].unit: string
data.facts[].start_date: string
data.facts[].end_date: string
guide: string
```

**Captures:**

- [dep-sec-facts-01](captures/dep-sec-facts-01.json) — success — Batch facts for 3 common GAAP concepts on the 10-K.

**Notes:**

- Batch facts for 3 common GAAP concepts on the 10-K.

### get_sec_filing_facts_catalog

**Safety:** read-only · **Status:** probed

List the distinct GAAP concept names tagged in an SEC filing, with their reporting periods and dimension breakdowns. Use this only after a direct get_sec_filing_facts guess comes back empty, or for open-ended "what's unusual/notable" questions — most common financial questions should guess concept names directly rather than calling this first.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filing_id | string | yes | Filing identifier to catalog, from get_sec_filing_index. |
| concept_contains | string | no | Case-insensitive substring filter on concept name, e.g. 'Debt'. Omit to return all concepts. |
| axis_name_in | null \| array | no | Only return concepts broken down by at least one of these dimension names. For 'what's unusual/notable in this filing' questions, try named-entity axes like … |
| offset | integer | no | Pagination offset. Omit for the first page; to fetch the next page, pass the value from the prior response's next_offset field. |

**Response shape** (union over 5 success capture(s)):

```
data: object
data.concepts: array<object>
data.concepts[].concept: string
data.concepts[].is_text_block: boolean
data.concepts[].periods: array<object>
data.concepts[].periods[].period: string
data.concepts[].periods[].end_date: string
data.concepts[].periods[].start_date: string
data.concepts[].axis_names: array<string>
data.count: number
data.next_offset: number
guide: string
```

**Captures:**

- [dep-sec-fcat-01](captures/dep-sec-fcat-01.json) — success — Fact catalog page 0 - source of next_offset + axis names for wave-3.
- [dep-sec-fcat-02](captures/dep-sec-fcat-02.json) — success — concept_contains substring filter.
- [dep-sec-fcat-03](captures/dep-sec-fcat-03.json) — success — OFFSET PAGINATION FOLLOW - next_offset=50 from dep-sec-fcat-01.
- [dep-sec-fcat-04](captures/dep-sec-fcat-04.json) — success — axis_name_in filter - axis name harvested from dep-sec-fcat-01 concept entries.
- [dep-sec-fcat-05](captures/dep-sec-fcat-05.json) — success — OFFSET FOLLOW p3 - next_offset=100 from dep-sec-fcat-03.

**Notes:**

- Fact catalog page 0 - source of next_offset + axis names for wave-3.
- concept_contains substring filter.
- OFFSET PAGINATION FOLLOW - next_offset=50 from dep-sec-fcat-01.
- axis_name_in filter - axis name harvested from dep-sec-fcat-01 concept entries.
- OFFSET FOLLOW p3 - next_offset=100 from dep-sec-fcat-03.

### get_sec_filing_index

**Safety:** read-only · **Status:** probed

List a company's SEC filings, optionally filtered by form type and date. Use this to find a specific annual report (10-K), quarterly report (10-Q), or material event disclosure (8-K).

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | yes | Stock ticker symbol, e.g. AAPL. Exact match — no partial or name-based lookup. Lowercase input is normalized to uppercase. |
| form_type | null \| array | no | One or more SEC form types to filter by, e.g. ['10-K'] or ['10-K','10-Q']. Omit to return all form types. |
| since | string | no | Earliest filing date to include, ISO format YYYY-MM-DD. Omit to return filings from all dates. |
| until | string | no | Latest filing date to include, ISO format YYYY-MM-DD. Omit to return filings up to the most recent. |
| cursor | string | no | Pagination cursor. Omit for the first page; to fetch the next page, pass the value from the prior response's next field. |

**Response shape** (union over 5 success capture(s)):

```
data: object
data.symbol: string
data.filings: array<object>
data.filings[].filing_id: string
data.filings[].form_type: string
data.filings[].description: string
data.filings[].date_filed: string
data.next: string
guide: string
```

**Captures:**

- [dep-sec-idx-cur-01](captures/dep-sec-idx-cur-01.json) — success — PAGINATION FOLLOW: cursor harvested from ro-sec-idx-01 data.next.
- [dep-sec-idx-cur-02](captures/dep-sec-idx-cur-02.json) — success — PAGINATION FOLLOW p3 - cursor from dep-sec-idx-cur-01 data.next.
- [ro-sec-idx-01](captures/ro-sec-idx-01.json) — success — All form types - source of filing_id + next_cursor.
- [ro-sec-idx-02](captures/ro-sec-idx-02.json) — success — form_type filter.
- [ro-sec-idx-03](captures/ro-sec-idx-03.json) — success — since+until window.

**Notes:**

- All form types - source of filing_id + next_cursor.
- form_type filter.
- since+until window.
- PAGINATION FOLLOW: cursor harvested from ro-sec-idx-01 data.next.
- PAGINATION FOLLOW p3 - cursor from dep-sec-idx-cur-01 data.next.

