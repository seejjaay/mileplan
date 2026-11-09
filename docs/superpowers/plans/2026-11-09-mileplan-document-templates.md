# Document templates implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the four client document templates and an `npm run doc` exporter. It fills the templates from `plan.json`, `doc.json` and per-client prose, and writes PDF and DOCX files that are guaranteed to be Times New Roman only.

**Architecture:** A Node script under `scripts/doc/` runs TypeScript directly through Node 24's type stripping. It runs a fixed pipeline: load and validate, money rules, render context, Handlebars to Markdown, `marked` tokens, then the DOCX writer (`docx`) and the PDF writer (Playwright Chromium), then a font check on both output files. Pure stages are unit-tested in CI. Export and font tests need Chromium and Times New Roman, so they run under their own command.

**Tech stack:** Node 24, TypeScript (strict), Handlebars, marked, docx, jszip, pdf-lib, @playwright/test (Chromium), Ajv 2020, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-09-mileplan-document-templates-design.md` (the section numbers below are the spec's).

## Global constraints

- **Font:** Times New Roman only, in every exported file. The exporter fails, and deletes that run's files, on any other font (spec §7).
- **Page and type:** Letter, 1-inch margins, body 12pt at 1.15 line spacing, headings bold at 16 / 14 / 12pt, footer "Page X of Y".
- **Amounts:** written `PHP 21,000.00`, never `₱`. Dates written `16 November 2026`.
- **Money maths:** integer centavos throughout. Buyout = round(total × multiplier, 2 dp, half up).
- **Code under `scripts/doc/`** must be erasable TypeScript, because Node runs it by type stripping:
  - no enums, parameter properties or namespaces
  - relative imports end in `.ts`
  - JSON is read with `fs`, not `import`
- **Client data:** `clients/` is gitignored. Only `scripts/doc/fixtures/` holds committed sample data.
- **Templates:** every one starts with `{{!-- Drafting aid, not legal advice. … --}}`, which is never rendered.
- **Strict data:** Handlebars runs with `{ strict: true, noEscape: true }`, so a missing value throws. Every key a template reads must exist in the render context, even if it's `false` or `''`.
- **No app changes:** nothing under `src/` changes, and `schemas/plan.example.json` is untouched.

## Review focus

1. **Times New Roman missing or substituted.** On a machine without the font, Chromium falls back silently. Expected: the export fails, and the message says Times New Roman may not be installed. Covered in Task 5, `pdfFontViolations flags a non-Times font`.
2. **Characters the font lacks** in client prose (an emoji, for example) make Chromium pull a fallback font for that glyph. Expected: the export fails naming the font, not a silently mixed PDF. Covered in Task 6, `fails and leaves no files when prose has an emoji`.
3. **Markdown-significant characters in data:**
   - A client named `Dela Cruz & Sons *Inc*`, or a payment titled `Phase 1 | Build`, must print literally, without breaking emphasis or splitting a table cell. Covered in Task 3, `escapes markdown in data values`.
   - Prose files are raw Markdown, so they are not escaped.
4. **Floating-point money.** Payments of 10,000.10 + 10,000.20 must total exactly `PHP 20,000.30`, and a buyout of 1.5 × 33,333.33 must be `PHP 50,000.00`. Covered in Task 2.
5. **Timezone date shift.** `2026-11-16` must print `16 November 2026` in any timezone, not 15 November. Covered in Task 2, `formatDate ignores timezone`.

---

### Task 1: Data files, doc.json schema and loading

**Files:**
- Modify: `package.json` (dev dependencies `handlebars`, `marked`, `docx`, `jszip`, `pdf-lib`; scripts `"doc": "node scripts/doc/main.ts"`, `"test:doc": "vitest run --config vitest.doc.config.ts"`)
- Modify: `tsconfig.json` (add `"scripts"` to `include`, and `"allowImportingTsExtensions": true`)
- Modify: `.gitignore` (add `clients/`)
- Create: `templates/prices.json`, `templates/developer.json`, `schemas/doc.schema.json`
- Create: `scripts/doc/types.ts`, `scripts/doc/load.ts`
- Create: the fixture client `scripts/doc/fixtures/acme/` containing:
  - `plan.json`: 50-50 plan. Start 2026-11-16. Three milestones, the last due 2027-02-26. Payments `deposit` 35000 due 2026-11-16 and `final` 35000 tied to the last milestone.
  - `doc.json`: package `custom-web-app`. Fees `[{label:"Custom web application",amount:63000},{addon:"extra-page",qty:2},{label:"Domain and hosting setup",amount:800},{label:"UI/UX mockups",amount:4200}]`, which totals 70000. Multiplier 1.5. Dispute city "Quezon City".
  - The eight prose files.
- Test: `tests/unit/doc/load.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  - `Plan`, `Milestone`, `Payment`: the shape of `schemas/plan.schema.json`.
  - `FeeLine = { label: string; amount: number } | { addon: string; qty: number } | { rush: true }`.
  - `DocJson`: the fields in spec §4.1. Optional fields are optional.
  - `Prices = { packages: { key: string; name: string; from: number; inclusions: string[] }[]; addons: { key: string; name: string; price?: number; from?: number; per?: string; percent?: number }[]; source_code_multiplier: { min: number; max: number } }`.
  - `Developer = { name: string; title: string; email: string; phone: string; portfolio: string }`.
  - `PROSE_NAMES = ['scope','requirements','users','nfr','constraints','assumptions','out-of-scope','glossary'] as const`, and `ProseName`.
  - `ClientInput = { slug: string; dir: string; plan: Plan; doc: DocJson; prose: Record<ProseName, string> }`.
  - `class DocError extends Error { errors: string[] }`, which joins `errors` with newlines in `message`.
- Produces, in `load.ts`:
  - `loadClient(dir: string): ClientInput`. Collects every error first, then throws one `DocError`.
  - `loadPrices(): Prices`.
  - `loadDeveloper(): Developer`.

`prices.json` values come from spec §4.1, using these keys:
- Packages: `landing-page`, `business-site`, `custom-web-app`, `tools-automation`, `desktop-mobile-app`, `saas-platform`, `simple-website`, `basic-web-app`, `basic-app`. Each package's inclusions are copied from the price list.
- Add-ons:
  - `extra-page`: price 1000
  - `extra-revision`: price 800
  - `domain-hosting-setup`: price 800
  - `ui-ux-mockups`: from 2500
  - `maintenance`: from 1500, per "month"
  - `rush`: percent 30
  - `bug-fix`: from 500, per "issue"

`doc.schema.json` is draft 2020-12, with `additionalProperties: false` at every level. `multiplier` has a minimum of 1.5 and a maximum of 3. `payment_plan` is the enum `["50-50","milestones"]`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/doc/load.test.ts`. Put `// @vitest-environment node` at the top.
  - `loads the fixture client`: `loadClient('scripts/doc/fixtures/acme').plan.payments.length === 2`, and `prose.scope` is non-empty.
  - `reports schema errors with paths`: a temp copy whose doc.json has `source_code.multiplier: 4` and an extra key `foo`. The thrown `DocError.errors` include one string containing `doc.json` and `/source_code/multiplier`, and one containing `foo`.
  - `reports plan.json errors with the plan prefix`: a plan with no `milestones` gives an error string starting `plan.json`.
  - `reports every missing prose file`: delete `glossary.md` and `users.md`. Both paths appear in `errors`, and the error is thrown only once.
- [ ] **Step 2:** Run `npx vitest run tests/unit/doc/load.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement.** Install the dependencies, add the data files, types and `load.ts`. Ajv2020 `allErrors: true`. Error format: `` `${file}: ${instancePath || '/'} ${message}` ``, plus `params.additionalProperty` when present.
- [ ] **Step 4:** Run `npx vitest run tests/unit/doc/load.test.ts`. Expected: PASS. Then run `npm run typecheck`. Expected: no errors.
- [ ] **Step 5: Commit** with `feat(doc): data files, doc.json schema and client loading`.

### Task 2: Money rules and formatting

**Files:**
- Create: `scripts/doc/money.ts`
- Test: `tests/unit/doc/money.test.ts`

**Interfaces:**
- Consumes: `ClientInput`, `Prices`, `Payment`, `DocError` (Task 1).
- Produces:
  - `formatPHP(amount: number): string` → `"PHP 21,000.00"`.
  - `formatDate(iso: string): string` → `"16 November 2026"`. It parses the `YYYY-MM-DD` parts itself and never uses `Date` with a timezone.
  - `checkMoney(input: ClientInput, prices: Prices): Money`, which throws a `DocError` listing every rule broken.
  - `Money = { total: number; deposit: Payment; projectPayments: Payment[]; sourcePayment: Payment | null; buyoutPrice: number; fees: { label: string; amount: number }[]; finalDeadline: string }`.

The rules are spec §4.2 and §4.3, plus these:
- The plan needs `project.start_date`. Error: `plan.json: project.start_date is required for documents`.
- `project.currency` must be absent or `"PHP"`.
- `doc.package` must be a `prices.json` package key.
- An `addon` line's key must be a fixed-price add-on, meaning one that has `price`.
- `finalDeadline` is `project.end_date`, or the last milestone's `due_date` when there's no end date.

- [ ] **Step 1: Write the failing tests.** Each builds on the fixture via a `withPlan`/`withDoc` override helper.
  - `fixture passes`: total 70000, the deposit key is `deposit`, `buyoutPrice` is 105000, `finalDeadline` is `2027-02-26`.
  - `50-50 rejects unequal`: 30000 + 40000 gives an error containing `equal`.
  - `50-50 rejects three project payments`.
  - `deposit due after start`: deposit due 2026-11-17 gives an error containing `start_date`.
  - `last payment must be tied to last milestone`.
  - `milestones mode allows 30/40/30`: with `payment_plan: 'milestones'` and the example 3-payment schedule (re-tied so the last is tied to the final milestone), it passes.
  - `source-code payment amount must equal total × multiplier`: 100000 against an expected 105000 gives an error that includes `105,000.00`.
  - `source-code payment due before the final payment is rejected`.
  - `non-PHP currency rejected`: `USD` gives an error containing `PHP`.
  - Fee breakdown:
    - `addon lines priced from prices.json`: `{addon:'extra-page',qty:2}` gives 2000.
    - `rush is 30% of lines above`: `[{label:'X',amount:10000},{rush:true}]` gives a rush line `{label:'Rush delivery (+30%)', amount:3000}`.
    - `rush not last rejected`.
    - `rush twice rejected`.
    - `unknown package rejected`.
    - `non-fixed addon rejected`: `{addon:'maintenance',qty:1}`.
    - `fees must equal total`: the error shows both amounts, formatted.
  - `exact cents`: payments of 10000.10 and 10000.20 in milestones mode give `formatPHP(total) === 'PHP 20,000.30'`.
  - `buyout rounds half up`: a total of 33333.33 × 1.5 gives a `buyoutPrice` of 50000.
  - `formatDate ignores timezone`: with `process.env.TZ = 'America/Los_Angeles'` set before import (or via `vi.stubEnv`), `formatDate('2026-11-16') === '16 November 2026'`.
  - `formatPHP` cases: 0 → `PHP 0.00`, 1234567.5 → `PHP 1,234,567.50`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/doc/money.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `money.ts`. Convert to centavos once (`Math.round(n * 100)`), compare and sum integers, and convert back only when formatting.
- [ ] **Step 4:** Run `npx vitest run tests/unit/doc/money.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(doc): payment rules, fee breakdown and PHP/date formatting`.

### Task 3: Render context and the four templates

**Files:**
- Create: `scripts/doc/context.ts`, `scripts/doc/render.ts`
- Create: `templates/service-contract.md`, `templates/project-agreement.md`, `templates/srs.md`, `templates/milestone-plan.md`
- Test: `tests/unit/doc/render.test.ts`

**Interfaces:**
- Consumes: `ClientInput`, `Prices`, `Developer` (Task 1). `checkMoney`, `formatPHP`, `formatDate`, `Money` (Task 2).
- Produces:
  - `mdEscape(s: string): string`. Backslash-escapes `\ * _ [ ] < > | #` and backticks, and an initial `-`, `+` or digit-dot.
  - `parseRequirements(md: string): string[]`. Each top-level `- ` item is one requirement, and indented continuation lines join with a space.
  - `buildContext(input: ClientInput, prices: Prices, developer: Developer): RenderContext`.
  - `RenderContext` has these keys, all always defined:
    - `developer`, `client`
    - `project{title,summary}`
    - `academic` (boolean), `school`, `course`
    - `package{name,inclusions[]}`
    - `fees[{label,amount}]` (formatted)
    - `total`, `deposit`
    - `payments[{title,amount,due}]`
    - `source{price,purchased,multiplier}`
    - `startDate`, `finalDeadline`
    - `milestones[{title,due,description,criteria[],tasks[]}]`
    - `terms{revisionRounds,warrantyDays,acceptanceDays,extraRound,bugFix,maintenance}`
    - `paymentMethod`, `disputeCity`, `agreementDate`
    - `requirements[]`, `prose`

    Every string that comes from plan.json or doc.json goes through `mdEscape`. Prose doesn't.
  - `DocName = 'contract' | 'agreement' | 'srs' | 'plan'`.
  - `renderDocument(name: DocName, ctx: RenderContext): string`. It uses an isolated `Handlebars.create()` with `{strict: true, noEscape: true}`, and helpers `prose name` (returns `ctx.prose[name]`) and `inc n` (n + 1).

**Template content:**
- The templates follow spec §5.1 to §5.6 section by section and in the same order, with the defaults coming from `terms`.
- The contract's §12 (academic) is wrapped in `{{#if academic}}`.
- Signature blocks are plain paragraphs: a line of underscores, then name and title, then `Date: ____________`. There's no table, so both writers render them the same.
- The milestone plan and the agreement's payment and timeline tables are GFM tables.

- [ ] **Step 1: Write the failing tests.** All build from the fixture.
  - `contract has every section heading in order`: assert the 19 headings from §5.1 appear in order. Academic is included only when the flag is set, so check it with `academic: true`.
  - `academic section only when academic`: `false` means no `Academic` heading, and `true` means the heading plus `walkthrough` and `technical guide`.
  - `agreement always shows the buyout line`: contains `PHP 105,000.00` even when there's no `source-code` payment.
  - `agreement payment table gains a buyout row when bought`.
  - `fees and total in agreement`: every fee label and `PHP 70,000.00`.
  - `srs numbers requirements`: given 3 items in `requirements.md`, it contains `FR-1`, `FR-2`, `FR-3`, and no `FR-4`.
  - `milestone plan lists every milestone's criteria and tasks`.
  - `strict render throws on a missing key`: rendering with a context missing `disputeCity` throws.
  - `escapes markdown in data values`: client name `Dela Cruz & Sons *Inc*` and payment title `Phase 1 | Build`. Run the agreement through `marked.lexer`. The payment table rows still have 3 cells, and the paragraph text contains the literal `*Inc*`.
  - `template comments never render`: the output contains no `not legal advice`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/doc/render.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `context.ts`, `render.ts` and the four templates.
- [ ] **Step 4:** Run `npx vitest run tests/unit/doc/render.test.ts`. Expected: PASS. Then run `npm test`. Expected: the whole unit suite passes.
- [ ] **Step 5: Commit** with `feat(doc): render context and the four templates`.

### Task 4: DOCX writer and DOCX font check

**Files:**
- Create: `scripts/doc/docx.ts`, `scripts/doc/fontcheck.ts` (the DOCX half)
- Create: `vitest.doc.config.ts` (environment `node`, include `tests/doc/**/*.test.ts`, `testTimeout: 60000`)
- Test: `tests/doc/docx.test.ts`

**Interfaces:**
- Consumes: `renderDocument`, `buildContext` (Task 3).
- Produces:
  - `markdownToDocx(markdown: string, title: string): Promise<Buffer>`.
  - `docxFontViolations(docx: Buffer): Promise<string[]>`. It returns human-readable strings such as `word/styles.xml: w:ascii="Calibri"`, and an empty array means clean.

**DOCX writer:**
- It maps `marked` tokens: heading 1–3, paragraph, strong, em, codespan as plain text, ordered and bullet lists (2 levels), GFM table with header row bold, hr, and space.
- Styles (`docx` options):
  - `styles.default.document.run = { font: 'Times New Roman', size: 24 }`, with paragraph `spacing.line = 276`.
  - Heading 1, 2 and 3 set the font explicitly, bold, with sizes 32 / 28 / 24.
  - Every other style used also sets the font explicitly.
- Page: Letter, `1440` twips on every margin. The footer is `Page {PageNumber.CURRENT} of {PageNumber.TOTAL_PAGES}`, centred, 10pt.
- If the `docx` package still emits other fonts in `word/fontTable.xml` or any theme-font attributes, post-process the zip with `jszip` to remove them. The check must pass on the real output, not on a mock.

**Font check:** it looks in `word/document.xml`, `word/styles.xml`, `word/footer*.xml`, `word/numbering.xml` and `word/fontTable.xml`.
- Any `w:(ascii|hAnsi|eastAsia|cs)="X"` where X ≠ `Times New Roman` is a violation.
- Any `w:\w+Theme=` attribute is a violation.
- Any `<w:font w:name="X">` where X ≠ `Times New Roman` is a violation.

- [ ] **Step 1: Write the failing tests.**
  - `fixture contract DOCX is Times New Roman only`: `docxFontViolations(await markdownToDocx(contractMd,'Contract'))` returns `[]`.
  - `every document type is clean`: the same check for the agreement, the SRS and the plan.
  - `docxFontViolations flags other fonts`: a zip built with jszip whose `word/styles.xml` contains `w:ascii="Calibri"` and `w:asciiTheme="minorHAnsi"` returns 2 violations.
  - `page is Letter with 1-inch margins`: `word/document.xml` contains `w:w="12240"`, `w:h="15840"` and `w:top="1440"`.
- [ ] **Step 2:** Run `npm run test:doc -- tests/doc/docx.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `docx.ts` and the DOCX half of `fontcheck.ts`.
- [ ] **Step 4:** Run `npm run test:doc -- tests/doc/docx.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(doc): DOCX writer with Times New Roman enforcement`.

### Task 5: PDF writer and PDF font check

**Files:**
- Create: `scripts/doc/pdf.ts`
- Modify: `scripts/doc/fontcheck.ts` (the PDF half)
- Test: `tests/doc/pdf.test.ts`

**Interfaces:**
- Consumes: `renderDocument`, `buildContext` (Task 3).
- Produces:
  - `markdownToHtml(markdown: string, title: string): string`.
  - `openPdfRenderer(): Promise<{ render(markdown: string, title: string): Promise<Buffer>; close(): Promise<void> }>`. It launches one Chromium per export run.
  - `pdfFontViolations(pdf: Buffer): Promise<string[]>`.

**HTML and print:**
- The HTML is `marked.parse` output inside a full document.
- The print CSS sets `* { font-family: "Times New Roman" !important; }`, with body 12pt / 1.15, h1, h2 and h3 at 16 / 14 / 12pt bold, and tables collapsed with 1px borders.
- Print options: `page.pdf({ format: 'Letter', margin: 1in on all sides, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate })`.
- The footer template is `<div style="font-family:'Times New Roman';font-size:10pt;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`.

**Font check:**
- It loads the PDF with `pdf-lib` and walks `context.enumerateIndirectObjects()`. For every dict with `/Type /Font`, it reads `/BaseFont` and strips any six-letter subset prefix (`ABCDEF+`).
- A font is allowed when its name with non-alphanumerics removed starts with `TimesNewRoman`.
- Every other name is a violation: `PDF font "Arial-BoldMT" is not Times New Roman (is Times New Roman installed?)`.

- [ ] **Step 1: Write the failing tests.**
  - `fixture contract PDF is Times New Roman only`: returns `[]`.
  - `every document type is clean`.
  - `bold and italic stay Times`: a markdown string with `**bold** and *italic*` produces a clean PDF, and more than one Times New Roman face appears.
  - `pdfFontViolations flags a non-Times font`: render HTML through Playwright directly with `font-family: Arial`. The result has length ≥ 1 and its message contains `is Times New Roman installed?`.
  - `page is Letter`: the first page from `PDFDocument.load` has a size of 612 × 792.
- [ ] **Step 2:** Run `npm run test:doc -- tests/doc/pdf.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pdf.ts` and the PDF half of `fontcheck.ts`.
- [ ] **Step 4:** Run `npm run test:doc -- tests/doc/pdf.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(doc): PDF writer with embedded-font check`.

### Task 6: CLI, cleanup and a wording review with CJ

**Files:**
- Create: `scripts/doc/cli.ts`, `scripts/doc/main.ts`
- Modify: `README.md` (a short "Client documents" section with the command, the folder layout and the `test:doc` note)
- Test: `tests/doc/cli.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `runDoc(argv: string[], log?: (line: string) => void): Promise<number>`. It returns an exit code.
  - `main.ts` is `process.exit(await runDoc(process.argv.slice(2)))`.

**Arguments and output:**
- Arguments: `<client-dir> [--only contract,agreement,srs,plan] [--format pdf,docx]`. An unknown flag or document name exits with 2 and a usage line.
- Output files are `<dir>/out/<slug>-<service-contract|project-agreement|srs|milestone-plan>.<pdf|docx>`. The slug is the client folder's name.
- On any `DocError`, render error or font violation, it:
  - logs every error line
  - deletes every file written in this run
  - returns 1

  On success it logs each written path and returns 0.

- [ ] **Step 1: Write the failing tests.** Each test works on a temp copy of the fixture.
  - `writes 8 files by default`: exit 0, and `out/` holds 8 files with the expected names.
  - `--only contract --format pdf writes one file`.
  - `fails and leaves no files when prose has an emoji`: append `🎉` to `scope.md`. Expected: exit 1, `out/` is empty or absent, and the log contains `is not Times New Roman`.
  - `validation failure writes nothing`: a multiplier of 4 exits 1 with no `out/` files.
  - `unknown --only value exits 2`.
- [ ] **Step 2:** Run `npm run test:doc -- tests/doc/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `cli.ts`, `main.ts` and the README section.
- [ ] **Step 4:** Run `npm run test:doc`, then `npm test`, `npm run lint` and `npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Manual check.** Run `npm run doc -- scripts/doc/fixtures/acme`, then:
  - Open the DOCX in Word. The body, a heading, a table and the footer all show Times New Roman.
  - Check the PDF's Properties → Fonts, which should list only Times New Roman faces.
  - Hand the fixture contract and agreement PDFs to CJ to review the wording, and apply any edits to the templates before the final commit.
- [ ] **Step 6: Commit** with `feat(doc): npm run doc exporter with cleanup on failure`.
