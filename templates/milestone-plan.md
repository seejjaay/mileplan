{{!-- Drafting aid, not legal advice. Fully generated from plan.json; do not edit by hand. --}}
# Milestone Plan

{{project.title}}, for {{client.name}}. Work starts on {{startDate}}. The Final Deadline is {{finalDeadline}}.
{{#each milestones}}

## {{inc @index}}. {{title}}

Due {{due}}.
{{#if description}}

{{description}}
{{/if}}
{{#if criteria.length}}

**Acceptance criteria**

{{#each criteria}}
- {{this}}
{{/each}}
{{/if}}
{{#if tasks.length}}

**Tasks**

{{#each tasks}}
- {{this}}
{{/each}}
{{/if}}
{{/each}}

## Payment schedule

| Payment | Amount | Due |
| --- | --- | --- |
{{#each payments}}
| {{title}} | {{amount}} | {{due}} |
{{/each}}
{{#if source.purchased}}
| Source code buyout | {{source.price}} | {{source.due}} |
{{/if}}
