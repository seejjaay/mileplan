{{!-- Drafting aid, not legal advice. Per-project terms only; the standing terms are in the service contract. --}}
# Project Agreement

This Project Agreement is made on {{#if agreementDate}}{{agreementDate}}{{else}}{{blank 18}}{{/if}} and sits under the Service Agreement between the Developer and the Client. If the two documents differ, the Service Agreement applies.

Developer: {{developer.name}}, {{developer.title}}

Client: {{client.name}}

## 1. The project

**{{project.title}}**

{{project.summary}}
{{#if school}}

School: {{school}}
{{/if}}
{{#if course}}

Course: {{course}}
{{/if}}

## 2. Package

{{package.name}}, which includes:

{{#each package.inclusions}}
- {{this}}
{{/each}}

Revision rounds included: {{terms.revisionRounds}}, for the whole project. Extra rounds cost {{terms.extraRound}} each, as set out in section 7 of the Service Agreement.

## 3. Fee breakdown

| Item | Amount |
| --- | --- |
{{#each fees}}
| {{label}} | {{amount}} |
{{/each}}
| **Total fee** | **{{total}}** |

## 4. Payment schedule

| Payment | Amount | Due |
| --- | --- | --- |
{{#each payments}}
| {{title}} | {{amount}} | {{due}} |
{{/each}}
{{#if source.purchased}}
| Source code buyout | {{source.price}} | {{source.due}} |
{{/if}}

Payment is made by {{paymentMethod}}. The first payment is the deposit and is due before work begins. The Developer hands over the deployed Work only after the last project payment is received. The source code buyout below is separate and does not delay that handover.

## 5. Source code buyout (optional)

The Client may buy the source code and full ownership of the Work for **{{source.price}}**, which is the total fee multiplied by {{source.multiplier}}. Once that payment is confirmed, the Developer hands over the full source code and ownership transfers to the Client, as set out in section 11 of the Service Agreement.
{{#if source.purchased}}

The Client has chosen the buyout. It is due on {{source.due}}.
{{else}}

Without the buyout, the Client has the license to use the Work described in section 10 of the Service Agreement.
{{/if}}

## 6. Timeline

Work starts on {{startDate}}. The Final Deadline is **{{finalDeadline}}**, and it moves as set out in section 6 of the Service Agreement.

| Milestone | Due |
| --- | --- |
{{#each milestones}}
| {{title}} | {{due}} |
{{/each}}

## 7. Acceptance

The Developer submits each milestone for review in MilePlan. The Client approves it there. A milestone left in review with no response for {{terms.acceptanceDays}} days is deemed accepted.

## 8. Signatures

{{> signatures}}
