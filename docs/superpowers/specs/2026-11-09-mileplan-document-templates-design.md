# MilePlan document templates: design

Supersedes §10 of `2026-11-05-mileplan-design.md`. Decided with CJ on 2026-11-09.

## 1. Purpose

Four documents that CJ shares with a client before a project starts:

- the service contract
- the project agreement
- the SRS (software requirements specification)
- the milestone plan

They're drafted per client with Claude, exported to PDF and DOCX, signed off-platform, and the signed PDFs are uploaded to MilePlan. These documents are off-platform tooling, not app screens, and nothing ships in the app bundle.

**Hard rules**
- Every exported document uses **Times New Roman** only. The exporter checks its own output and fails otherwise (§7).
- Scope is the SRS and nothing else (§5.1, item 3).
- The money in the documents always matches the `plan.json` that gets imported into MilePlan (§4).

## 2. Layout

```
templates/                        committed
  service-contract.md             Handlebars + Markdown
  project-agreement.md
  srs.md
  milestone-plan.md
  developer.json                  CJ's name, title, email, phone, portfolio URL
  prices.json                     packages, add-ons, rates (from the 2026 price list)
schemas/doc.schema.json           validates a client's doc.json
scripts/doc/                      the exporter
clients/<slug>/                   gitignored: client data never reaches GitHub
  plan.json                       the same file imported into MilePlan
  doc.json                        everything plan.json doesn't carry
  scope.md, requirements.md, …    per-client prose, included by name
  out/                            exported files
```

`.gitignore` gets `clients/`. A committed fixture client lives under `scripts/doc/fixtures/` for tests.

Each template starts with a Handlebars comment `{{!-- Drafting aid, not legal advice … --}}`. It never appears in an exported document.

## 3. Command

`npm run doc -- clients/<slug> [--only contract,agreement,srs,plan] [--format pdf,docx]`

The defaults are all four documents in both formats. Output goes to `clients/<slug>/out/<slug>-<document>.<ext>`. Any validation, render or font failure exits non-zero, prints every error with its path, and leaves no partial files behind.

## 4. Data and validation

### 4.1 Sources
- **`plan.json`**: validated against `schemas/plan.schema.json` (the existing Ajv setup). Provides the project title, summary, currency, dates, milestones (description, acceptance criteria, tasks) and payments. Milestone `amount` is ignored and never printed.
- **`doc.json`**: validated against `schemas/doc.schema.json`, with unknown keys rejected at every level, the same as plan.json. Fields:
  - `client`: name, address, email. For an organisation, also `representative` and `representative_title`.
  - `academic`: boolean, default `false`. Optional `school` and `course`.
  - `payment_method`: text, for example "GCash or bank transfer".
  - `payment_plan`: `"50-50"` (default) or `"milestones"`.
  - `package`: a key from `prices.json` packages.
  - `fees`: fee breakdown lines (§4.3).
  - `source_code.multiplier`: a number in [1.5, 3]. Required. It prices the optional buyout line.
  - `dispute_city`: the city named for mediation and small claims.
  - `agreement_date`: optional, the date printed on the documents.
  - Optional per-project overrides: `revision_rounds` (default 2, minimum 2, a total for the whole project), `warranty_days` (default 30), `acceptance_days` (default 7).
- **Per-client `.md` files**: prose the templates include by name: `scope.md`, `requirements.md`, `users.md`, `nfr.md`, `constraints.md`, `assumptions.md`, `out-of-scope.md`, `glossary.md`. A missing file is an error.
- **`templates/prices.json`**:
  - Packages, each with a key, a name, a "from" price and an inclusions list:
    - Landing page: 3,500
    - Business / portfolio site: 10,000
    - Custom web application: 35,000
    - Tools and automation: 5,000
    - Desktop / mobile app: 40,000
    - System / SaaS platform: 60,000
    - Simple website: 1,500
    - Basic web app: 5,000
    - Basic app: 8,000
  - Add-ons:
    - Extra page: 1,000
    - Extra revision round: 800
    - Domain and hosting setup: 800
    - UI/UX mockups: from 2,500
    - Maintenance: from 1,500 per month
    - Rush: +30%
    - Bug fix: from 500 per issue
  - `source_code_multiplier: { "min": 1.5, "max": 3 }`.
- **`templates/developer.json`**: CJ Nicko Rosales, Full Stack Developer, cjnickorosales@gmail.com, 0992-882-0559, portfolio-nickode.vercel.app.

### 4.2 Payment rules (checked before rendering)
In these rules, "project payments" means every payment except the one keyed `source-code`. The project total is the sum of the project payments.

- **`50-50`**: exactly 2 project payments of equal amount. The first is due on or before `project.start_date`. The second is tied to the last milestone.
- **`milestones`**: 2 or more project payments. The first is due on or before `project.start_date`. The last is tied to the last milestone.
- **Deposit:** whatever the plan, the first project payment is the deposit that the refund rule (§5.3) applies to.
- **`source-code` payment:** optional. It's present only when the client buys the source. Its amount must equal the total × `source_code.multiplier`, rounded to 2 decimals. It must be due on or after the last project payment.
- **Currency:** must be `PHP`. Other currencies are out of scope (§9).

### 4.3 Fee breakdown
`fees` is a list of lines. Each line takes one of three forms:
- `{ "label": "...", "amount": n }`: free-priced, for example the package price.
- `{ "addon": "<key>", "qty": n }`: a fixed-price add-on from `prices.json`. The amount is the add-on price × `qty`.
- `{ "rush": true }`: 30% of the sum of the lines above it. Allowed at most once, as the last line.

The breakdown total must equal the project total. Add-ons in the breakdown are part of the agreed scope.

### 4.4 Formatting
- Amounts are written `PHP 21,000.00`, never `₱`. Some versions of Times New Roman lack the peso glyph, and a fallback font would break §7.
- Dates are written `16 November 2026`.
- Handlebars runs in strict mode, so a missing value is an error, never a blank.

## 5. Document contents

### 5.1 service-contract.md
These terms are the same for every project. Sections, in order:

1. **Parties.** CJ ("Developer") and the client ("Client"), with addresses, emails and the representative if there is one.
2. **Definitions.** Work, SRS, Milestone Plan, Project Agreement, Acceptance, Final Deadline (`project.end_date` if set, otherwise the last milestone's due date, as extended under 5.3).
3. **Scope.** The SRS, together with any add-ons in the Project Agreement's fee breakdown, is the complete scope. Anything not written there is out of scope, whatever was said in chats, calls or meetings.
4. **Additional features.** New features are taken on only after the project is completed and fully paid, under a separate agreement with its own payment.
5. **Fees and payment.** Fees follow the Project Agreement's payment schedule. The deposit is due before work begins. The balance is due on completion, before handover of the deployed Work and any credentials. Payment is made by `payment_method`. Domains, hosting, app-store fees and other paid third-party services are paid by the Client at cost. Work outside this agreement is priced from `prices.json`.
6. **Deposit, deadline and delays.** See 5.3.
7. **Revisions.** `revision_rounds` rounds (default 2, never fewer than 2) for the whole project across all milestones, within scope. The Project Agreement states the number. Each extra round costs PHP 800.00 and is agreed in writing before work starts.
8. **Acceptance.** Approving a milestone in MilePlan is acceptance. A milestone left in review with no client response for `acceptance_days` days (default 7) is deemed accepted.
9. **Client responsibilities.** Provide content, access and decisions on time.
10. **Ownership and license.**
    - The Developer owns the Work.
    - After full payment, the Client receives a permanent, non-transferable license to use the delivered, deployed Work for its own purposes. The Client may not copy, modify, resell or sublicense it.
    - The Developer may reuse its code, libraries and know-how in other work.
    - The Developer may show the Work in a portfolio, without confidential data.
11. **Source code buyout.**
    - The buyout is optional and priced in the Project Agreement at `source_code.multiplier` × the total.
    - Once that payment is confirmed, the Developer hands over the full source and ownership of the Work transfers to the Client.
    - The Developer keeps its pre-existing, reusable code. The Client receives a permanent license to that code as it's used in the Work.
    - No source code is handed over before the buyout payment.
12. **Academic projects.** Included only when `academic: true`. See 5.2.
13. **Cancellation by the Client.** The Developer keeps the deposit and nothing more is owed. No unfinished work, source code or IP is handed over.
14. **Confidentiality and personal data.** Each party keeps the other's private information confidential. Personal data is handled in line with the Data Privacy Act of 2012 (RA 10173).
15. **Warranty.** Bugs in the delivered Work are fixed free for `warranty_days` days (default 30) after final acceptance. New features are not covered. After the window, bug fixes start at PHP 500.00 per issue, and maintenance starts at PHP 1,500.00 per month.
16. **Limitation of liability.** The Work is delivered as is, built with reasonable care. Total liability is capped at the fees the Client has actually paid.
17. **Disputes.** Philippine law applies. Disputes go through three steps in order:
    1. 15 days of good-faith talks.
    2. Mediation: barangay conciliation where it applies, otherwise a mediator both parties agree on.
    3. Only then, small claims in `dispute_city` for money claims.
18. **Electronic signatures.** Electronic signatures and scanned or photographed signed copies are valid as originals (RA 8792, the E-Commerce Act of 2000).
19. **Signatures.** Both parties, with printed name, title and date. No witnesses and no notary.

### 5.2 Academic section (contract §12)
- The Developer is solely the developer. The Developer does not attend or take part in presentations, defenses, panel reviews or reports, and does not write thesis chapters, papers or other academic submissions.
- No grade, approval or academic result is guaranteed. Acceptance is measured only against the milestone acceptance criteria.
- Changes requested by a panel or adviser after delivery are additional work under a separate agreement.
- The Client alone is responsible for following their school's rules on outside help.
- **Included:**
  - one online walkthrough of up to 2 hours, explaining how the system works
  - a technical guide covering setup, architecture and how to run the system. It's a developer document, not an academic submission.
- **In-person walkthroughs** happen only if the Developer agrees. The parties agree on how, when and where. The Client covers reasonable transport and venue costs, agreed in advance.
- Schools often require the source code. The Client should consider the source code buyout (11) in time for their submission.

### 5.3 Deposit, deadline and delays (contract §6)
- The deposit is non-refundable, **except** when the Developer misses the Final Deadline. In that case, the Client chooses between:
  - a full refund of the deposit, or
  - a new deadline agreed in writing.
- The Final Deadline moves back one day for each day the Developer is waiting on the Client for feedback, content, access or approvals. MilePlan's activity log and messages are the record of those waits.

### 5.4 project-agreement.md
- References the service contract.
- Project title and summary. If `academic`, also school and course.
- Package name and its inclusions from `prices.json`.
- **Fee breakdown** (§4.3) and the total.
- **Payment schedule table:** one row per project payment, with title, amount and due date. If bought, a "Source code buyout" row follows.
- **Source code buyout, optional:** always printed, priced at the multiplier × the total, so the client sees it at quote time.
- **Timeline table:** milestones and due dates, with the final deadline highlighted.
- **Acceptance process** (contract §8).
- Signature blocks.

### 5.5 srs.md
- **Purpose:** from `project.summary`.
- **Scope:** from `scope.md`, plus the package inclusions and add-ons from the fee breakdown.
- **Users and roles:** from `users.md`.
- **Functional requirements:** from `requirements.md`, numbered FR-1, FR-2, …
- **Non-functional requirements:** from `nfr.md`.
- **Constraints:** from `constraints.md`.
- **Assumptions:** from `assumptions.md`.
- **Out of scope:** from `out-of-scope.md`.
- **Glossary:** from `glossary.md`.
- It states that it is the complete scope under the service contract. It's unsigned, because the contract makes it binding by reference.

### 5.6 milestone-plan.md
Fully generated from plan.json, with no hand-written parts:
- One section per milestone, with its due date, description, acceptance criteria and tasks.
- Then the payment schedule, the same as in the project agreement.

## 6. Export pipeline

1. Validate plan.json and doc.json, and check the per-client `.md` files exist.
2. Check the payment rules (§4.2) and the fee breakdown (§4.3).
3. Build the render context: data plus derived values (total, deposit, buyout price, formatted amounts and dates, numbered FRs).
4. Render each template with Handlebars, in strict mode, to Markdown.
5. Parse the Markdown once with `marked` into tokens. Two writers consume the same tokens:
   - **DOCX:** the `docx` package maps headings, paragraphs, bold, italic, lists, tables and signature blocks.
   - **PDF:** the tokens become HTML with print CSS, printed by Playwright's Chromium with `page.pdf({ format: 'Letter' })`.
6. Run the font check (§7) on both files. On failure, delete them and exit non-zero.

New dev dependencies: `handlebars`, `docx` and `marked`. The PDF uses the existing `@playwright/test`, and DOCX inspection uses `jszip`. The exporter runs from `package.json` as `doc`.

## 7. Typography and the Times New Roman rule

- **Page:** Letter (8.5 × 11 in), 1-inch margins.
- **Body:** Times New Roman 12pt, 1.15 line spacing.
- **Headings:** Times New Roman bold, 16 / 14 / 12pt.
- **Footer:** "Page X of Y", in Times New Roman.
- **DOCX:** Times New Roman is set in the document defaults (`w:rFonts` ascii, hAnsi, eastAsia and cs) and explicitly on every style used: Normal, Heading 1–3, Title, list, table and footer. Theme font attributes (`w:asciiTheme` and similar) are never written, so Word can't substitute Calibri or Aptos, and a client editing the file keeps typing in Times New Roman.
- **PDF:** the print CSS sets `font-family: "Times New Roman"` on every element, and on Chromium's separate footer template. Chromium embeds the font subsets.
- **Output check, on every export:**
  - **PDF:** every embedded font must be a Times New Roman face, regular, bold or italic. Any other font, including a fallback picked up for a missing glyph, fails the export.
  - **DOCX:** every font name in `word/document.xml`, `word/styles.xml`, the footers and `word/fontTable.xml` must be Times New Roman, and no theme font attributes may appear.

## 8. Testing

**Vitest:**
- doc.json schema errors report their paths.
- Payment rules: 50-50 equal amounts, a first payment due after the start date, a last payment not tied to the final milestone, milestones mode, a source-code payment with the wrong amount, a source-code payment due too early, a multiplier outside 1.5–3, and a non-PHP currency.
- Fee breakdown: add-on pricing, rush at 30% of the lines above, rush not last, and a breakdown that doesn't match the total.
- Formatting: PHP amounts and long dates.
- Strict render: a missing value or a missing per-client `.md` file fails.
- The academic section appears only when `academic: true`.
- **Font tests:** export the fixture client to both formats and assert Times New Roman is the only font present.

The fixture client has its own 50/50 plan, so `schemas/plan.example.json` and the e2e tests are untouched.

**Manual:**
- Open the DOCX in Word: click into the body, a heading, a table and the footer, and each shows Times New Roman.
- Open the PDF's Properties → Fonts: only Times New Roman faces are listed.
- Print one page at actual size to check the margins.

## 9. Out of scope
- Generating documents inside the MilePlan app.
- E-signing.
- Currencies other than PHP.
- Translations, for example Filipino.
- Editing the price list PDF. It stays as is, and the project agreement's optional buyout line makes the source code price visible at quote time.
- Legal review. The templates are drafting aids. A lawyer review is recommended once a project can pay for it.
