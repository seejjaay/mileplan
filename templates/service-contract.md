{{!-- Drafting aid, not legal advice. Have a lawyer review this once a project can pay for it. --}}
# Service Agreement

This Agreement is made on {{#if agreementDate}}{{agreementDate}}{{else}}{{blank 18}}{{/if}} between {{developer.name}} (the “Developer”) and {{client.name}} (the “Client”). Each is a “Party” and together they are the “Parties”.

## 1. Parties

**Developer:** {{developer.name}}, {{developer.title}}. Email {{developer.email}}, phone {{developer.phone}}.

**Client:** {{client.name}}, {{client.address}}. Email {{client.email}}.{{#if client.representative}} Represented by {{client.representative}}{{#if client.representativeTitle}}, {{client.representativeTitle}}{{/if}}.{{/if}}

## 2. Definitions

- **Work** means the project described in the SRS: {{project.title}}.
- **SRS** means the software requirements specification for the Work.
- **Milestone Plan** means the milestones, acceptance criteria and tasks for the Work.
- **Project Agreement** means the document that states the fee breakdown, the payment schedule and the timeline for the Work.
- **Acceptance** means the Client approves a milestone, or a milestone is deemed accepted under section 8.
- **Final Deadline** means {{finalDeadline}}, as moved under section 6.

## 3. Scope

The SRS, together with the add-ons listed in the fee breakdown of the Project Agreement, is the complete scope of the Work. Anything not written there is outside the Work, whatever was said in chats, calls or meetings.

## 4. Additional features

New features are taken on only after the Work is completed and fully paid. They need a separate agreement with its own scope and its own payment. A request for a new feature made while the Work is in progress is noted and handled under that separate agreement.

## 5. Fees and payment

The total fee for the Work is {{total}}, as set out in the Project Agreement. Payments follow the schedule in the Project Agreement.

The first payment, {{deposit}}, is the deposit. It is due before work begins. Each later payment is due on its due date. The last payment is due when the Work is complete and ready for delivery. The Developer hands over the deployed Work and any access credentials only after the last payment is received.

Payment is made by {{paymentMethod}}. If a payment is more than 7 days late, the Developer may pause work until it is paid, and the time paused does not count against the Final Deadline.

Domains, hosting, app-store fees and other paid third-party services are not part of the fee. The Client pays them at cost.

## 6. Deposit, deadline and delays

The deadline starts counting once the deposit is received and the Client has sent the content and information needed to start.

The Client will answer questions and give feedback within 3 days. Each day the Developer is waiting on the Client for feedback, content, access or an approval moves the Final Deadline back by one day. The activity log and messages in MilePlan are the record of those waits.

The deposit is non-refundable, except when the Developer misses the Final Deadline. In that case the Client chooses one of two options:

1. a full refund of the deposit, or
2. a new deadline, agreed in writing.

## 7. Revisions

{{terms.revisionRounds}} rounds of revisions per milestone are included, within the scope of the Work. A round is one set of changes sent together. Each extra round costs {{terms.extraRound}}, and is agreed in writing before work starts (chat or email is enough).

## 8. Acceptance

The Developer submits each milestone for review in MilePlan. Approving it there is Acceptance. A milestone left in review with no response from the Client for {{terms.acceptanceDays}} days is deemed accepted.

## 9. Client responsibilities

The Client provides content, access and decisions on time, and tells the Developer promptly about anything that affects the Work.

## 10. Ownership and license

The Developer owns the Work.

After every payment due under the Project Agreement is paid in full, the Client receives a permanent, non-transferable license to use the delivered and deployed Work for its own purposes. The Client may not copy, modify, resell or sublicense the Work.

The Developer may reuse its own code, libraries, tools and know-how in other work. The Developer may show the Work in a portfolio, without confidential data.

## 11. Source code buyout

The Client may buy the source code and full ownership of the Work. The buyout is optional. Its price is the total fee multiplied by {{source.multiplier}}, and the Project Agreement states the amount.

Once the buyout payment is confirmed, the Developer hands over the full source code, and ownership of the Work transfers to the Client. The Developer keeps its pre-existing, reusable code. The Client receives a permanent license to use that code as it is used in the Work.

The Developer hands over no source code before the buyout payment.

## 12. Cancellation by the Client

The Client may end this Agreement at any time by written notice. The Developer then keeps the deposit and nothing more is owed. The Developer does not have to hand over any unfinished work, source code or other rights in the Work.

## 13. Confidentiality and personal data

Each Party keeps the other’s private information confidential. Personal data is handled in line with the Data Privacy Act of 2012 (Republic Act No. 10173).

## 14. Warranty

The Developer fixes bugs in the delivered Work free of charge for {{terms.warrantyDays}} days after final acceptance. A bug is a case where the Work does not do what the SRS says it does. New features and changes are not bugs, and are not covered.

After that, bug fixes start at {{terms.bugFix}} per issue and maintenance starts at {{terms.maintenance}} per month, each quoted before work starts.

## 15. Limitation of liability

The Work is delivered as is, built with reasonable care and tested against the acceptance criteria. The Developer does not guarantee that it will be free of errors. The Developer’s total liability under this Agreement is limited to the fees the Client has actually paid.

## 16. Disputes

This Agreement is governed by the laws of the Republic of the Philippines. The Parties settle disputes in this order:

1. The Parties talk in good faith for 15 days.
2. If that does not settle it, the Parties go to mediation: barangay conciliation where it applies, otherwise a mediator both Parties agree on.
3. Only after mediation, either Party may bring a small claims case in {{disputeCity}} for money owed.
{{#if academic}}

## 17. Academic projects

The Developer is solely the developer of the Work. The Developer does not attend or take part in presentations, defenses, panel reviews or reports, and does not write thesis chapters, papers or other academic submissions.

The Developer does not guarantee any grade, approval or other academic result. Acceptance is measured only against the acceptance criteria of each milestone.

Changes requested by a panel or adviser after delivery are additional work, under a separate agreement.

The Client alone is responsible for following the rules of their school on outside help.

The Developer includes:

- one online walkthrough of up to 2 hours, explaining how the system works, and
- a technical guide covering setup, architecture and how to run the system. It is a developer document, not an academic submission.

An in-person walkthrough happens only if the Developer agrees to it. The Parties agree on how, when and where. The Client pays reasonable transport and venue costs, agreed in advance.

Schools often require the source code. The Client should consider the source code buyout in section 11 in time for their submission.
{{/if}}

## {{contractNo.esign}}. Electronic signatures

Electronic signatures, and scanned or photographed copies of signed pages, are valid as originals (Republic Act No. 8792, the Electronic Commerce Act of 2000). A Party may sign in ink or electronically.

## {{contractNo.signatures}}. Signatures

{{> signatures}}
