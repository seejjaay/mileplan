{{!-- Drafting aid, not legal advice. The SRS is unsigned; the service contract makes it binding by reference. --}}
# Software Requirements Specification

{{project.title}}, for {{client.name}}.

This document is the complete scope of the Work under the Service Agreement. Anything not written here is outside the Work.

## 1. Purpose

{{project.summary}}

## 2. Scope

{{prose "scope"}}

The package is **{{package.name}}**, which includes:

{{#each package.inclusions}}
- {{this}}
{{/each}}

The items priced in the fee breakdown of the Project Agreement are also in scope:

{{#each fees}}
- {{label}}
{{/each}}

## 3. Users and roles

{{prose "users"}}

## 4. Functional requirements

{{#each requirements}}
- **FR-{{inc @index}}.** {{this}}
{{/each}}

## 5. Non-functional requirements

{{prose "nfr"}}

## 6. Constraints

{{prose "constraints"}}

## 7. Assumptions

{{prose "assumptions"}}

## 8. Out of scope

{{prose "out-of-scope"}}

## 9. Glossary

{{prose "glossary"}}
