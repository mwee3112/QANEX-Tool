import {
  callSageRawPredict
} from "./sageClient.js";

const MODEL =
  process.env.SAGE_LLM_MODEL ||
  "gemini-2.5-flash";

function clean(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compact(value, maxChars = 16000) {
  const text = clean(value);

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars)}\n\n[TRUNCATED ${text.length - maxChars} CHARS]`;
}

function extractJson(text) {

  function parseJsonSafely(value) {

    if (typeof value !== "string") {
      return null;
    }

    try {
      return JSON.parse(
        value.trim()
      );
    } catch {
      return null;
    }

  }


  function removeMarkdownFences(value) {

    return String(value || "")
      .replace(
        /^\s*```json\s*/i,
        ""
      )
      .replace(
        /^\s*```\s*/i,
        ""
      )
      .replace(
        /\s*```\s*$/i,
        ""
      )
      .trim();

  }


  function unwrapSageResponse(value) {

    if (value === null ||value === undefined) {
      return "";
    }

    /*
     * Already an object.
     */
    if ( typeof value === "object") {

      if (typeof value.answer === "string") {
        return value.answer;
      }


      /*
       * SAGE / MCP style content wrapper.
       */
      if (
        value.success === true &&
        Array.isArray(
          value.data?.content
        ) &&
        value.data.content.length > 0
      ) {

        const first = value.data.content[0];

        if (typeof first === "string") {

          const parsed = parseJsonSafely(first);

          if ( parsed && typeof parsed.answer === "string") {
            return parsed.answer;
          }

          return first;
        }

      }


      return value;
    }


    return String(value);

  }


  const unwrapped = unwrapSageResponse(text);


  /*
   * If the response is already a JSON object,
   * return it directly.
   */
  if (typeof unwrapped === "object") {
    return unwrapped;
  }


  const value = removeMarkdownFences(unwrapped);


  /*
   * Direct JSON.
   */
  const direct = parseJsonSafely(value);

  if (direct) {

    /*
     * Handle another nested answer wrapper.
     */
    if (typeof direct.answer === "string") {
      return extractJson(direct.answer);
    }
    return direct;
    }


   /*
   * Sometimes SAGE adds text before/after JSON.
   */
  const objectStart = value.indexOf("{");

  const objectEnd = value.lastIndexOf("}");


  if (
    objectStart >= 0 &&
    objectEnd > objectStart
  ) {

    const candidate = value.slice(
        objectStart,
        objectEnd + 1
      );

    const parsed = parseJsonSafely(candidate);

    if (parsed) {

      if (
        typeof parsed.answer === "string"
      ) {
        return extractJson(parsed.answer);
      }
      return parsed;
    }
  }

  /*
   * Never pretend malformed LLM output is
   * a valid discovery plan.
   */
  return {
    raw: value
  };

}

/**
 * ============================================================
 * PRIMARY LLM (SAGE RAW-PREDICT)
 * ============================================================
 *
 * QANEX uses SAGE raw-predict exclusively.
 */
async function askLLM(
  systemInstruction,
  prompt,
  options = {}
) {
  const timeoutMs =
    options.timeoutMs || 1800000;

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= 2;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => controller.abort(),
        timeoutMs
      );

    try {
      console.log(
        `[SAGE] Calling ${MODEL} (attempt ${attempt})`
      );

      const text =
        await callSageRawPredict({
          systemInstruction,
          prompt,
          timeoutMs,
          llmModelName: MODEL,
          maxAttempts: 1
        });

      if (!text) {
        throw new Error(
          "SAGE returned an empty response."
        );
      }

      console.log(
        `[SAGE] ${MODEL} response received`
      );

      return text;

    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 1500)
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError ||
    new Error("SAGE evidence analysis failed.")
  );
}

/**
 * ============================================================
 * STEP 1
 * LLM DISCOVERY PLAN
 * ============================================================
 *
 * The LLM does NOT generate test cases here.
 *
 * It decides what evidence QANEX should look for.
 */
export async function planEvidenceDiscovery({
  jira,
  linkedIssues = [],
  confluence = [],
  qmetry = [],
  github = []
}) {

const systemInstruction = `
You are the Evidence Discovery Planner for QANEX,
an enterprise QA test-case generation system.

Your job is NOT to generate test cases.

Your job is to analyze EVERY Jira Acceptance Criterion (AC)
and determine what implementation and existing-test evidence
should be searched for before generating test cases.

============================================================
CORE OBJECTIVE
============================================================

For EACH acceptance criterion:

1. Understand the business behavior described by the AC.
2. Identify the important business concepts in that AC.
3. Derive meaningful search terms from those concepts.
4. Decide what evidence should be searched in:
   - GitHub
   - QMetry
   - Confluence
5. Determine whether UI, API, database, configuration,
   workflow, validation, or existing-test evidence is relevant.

IMPORTANT:

The search terms do NOT need to be exact strings copied from
the Jira ticket.

You MUST derive useful semantic and implementation-oriented
search terms from the meaning of the AC.

For example, if an AC says:

"User can create a new record and assign multiple types."

Do NOT search only:

"User can create a new record and assign multiple types"

Instead derive concepts such as:

- create record
- record creation
- assign type
- multiple types
- type selection
- save/create action
- relevant screen
- relevant component
- related API/service
- related validation
- existing test coverage

The actual terms must depend on the AC.

============================================================
DO NOT ASSUME THE FEATURE DOMAIN
============================================================

The feature may be ANY SWMS functionality.

It could involve:

- inventory
- receiving
- shipping
- returns
- routes
- manifests
- tasking
- products
- orders
- users
- permissions
- configuration
- allocation
- picking
- loading
- validation
- reporting
- workflows
- or any other functionality.

Never assume that the feature is Tasking.

Derive terminology dynamically from the Jira AC,
description, linked issues, Confluence and existing evidence.

============================================================
SEARCH TERM STRATEGY
============================================================

For each AC, generate multiple complementary search terms
when useful.

A good search strategy should include a mixture of:

1. BUSINESS TERMS

Terms describing the actual business behavior.

Examples:

- allocate inventory
- return allocation
- create manifest
- assign product
- close route

2. UI / SCREEN TERMS

Infer likely UI concepts from the AC when appropriate.

Examples:

- allocation screen
- manifest details
- route close
- product selection

3. FIELD TERMS

Important fields or concepts that may appear in code.

Examples:

- quantity planned
- quantity allocated
- status
- product type

4. ACTION TERMS

Examples:

- create
- save
- submit
- allocate
- close
- approve
- cancel

5. IMPLEMENTATION TERMS

When the business concept suggests implementation artifacts,
search for likely semantic concepts such as:

- component
- service
- controller
- repository
- API
- endpoint
- hook
- model
- DTO
- validation

Do NOT invent exact class names or API paths.

6. DATABASE TERMS

If the AC involves persistent data or state changes,
identify concepts that may require database evidence.

Examples:

- allocation status
- manifest data
- route status
- quantity fields

Do NOT invent table or column names.

Instead generate semantic search terms that can locate
the actual table/column names in GitHub or other evidence.

7. CONFIGURATION / SYSPAR TERMS

If behavior may depend on configuration, permissions,
SysPar or feature flags, identify those concepts.

8. VALIDATION TERMS

Identify searches for:

- validation
- error handling
- invalid values
- required fields
- duplicate records
- boundary values
- business-rule violations

9. WORKFLOW / STATE TERMS

If the AC describes a transition, search for concepts
representing:

- previous state
- new state
- transition
- status update
- allowed/disallowed transition

10. EXISTING TEST TERMS

Generate QMetry search terms based on the business behavior,
not merely the Jira issue key.

============================================================
EXACT TERMS VS SEMANTIC TERMS
============================================================

Use exact terminology from the supplied evidence when it is
available and reliable.

However, do NOT depend exclusively on exact Jira wording.

For every AC, ask:

"What concepts would a developer or QA engineer search for
in the codebase to find the implementation of this behavior?"

Those concepts should become GitHub search terms.

Also ask:

"What concepts would a QA engineer search for in QMetry
to find existing tests covering this behavior?"

Those concepts should become QMetry search terms.

Also ask:

"What concepts would appear in SWMS documentation?"

Those concepts should become Confluence search terms.

============================================================
EVIDENCE-SOURCE RULES
============================================================

GITHUB:

Search for implementation evidence such as:

- business terminology
- UI components
- screens
- routes
- actions
- fields
- services
- controllers
- APIs
- constants
- enums
- database references
- configuration
- validation logic

Do not require exact Jira wording.

QMETRY:

Search for existing test coverage using:

- business behavior
- feature terminology
- workflow terminology
- important fields
- actions
- validations
- relevant domain concepts

Do not rely only on Jira issue IDs.

CONFLUENCE:

Search for:

- business rules
- domain terminology
- workflow documentation
- screen/function documentation
- configuration
- process definitions
- technical/domain concepts

============================================================
AC TRACEABILITY
============================================================

Every generated search term must be associated with the
acceptance criterion that caused it.

Use:

"acId": "<AC identifier or index>"

If the Jira data does not provide explicit AC IDs,
use identifiers such as:

- AC1
- AC2
- AC3

Do NOT invent Jira issue IDs.

============================================================
DATABASE DECISION
============================================================

Set:

"databaseValidationLikely": true

when the acceptance criteria involve behavior such as:

- creating data
- updating data
- deleting data
- allocation
- quantities
- statuses
- persistence
- workflow state changes
- relationships
- records that must be stored
- values that must remain consistent

Otherwise set it to false.

============================================================
API DECISION
============================================================

Set:

"apiValidationLikely": true

when the behavior is likely backed by an API/service operation
or when the business behavior can meaningfully be verified
through backend/API behavior.

Do not require an API to be explicitly mentioned in Jira.

============================================================
UI DECISION
============================================================

Set:

"uiValidationLikely": true

when the AC describes:

- screens
- navigation
- fields
- buttons
- dialogs
- visible values
- user interactions
- displayed validation/errors
- UI state

============================================================
IMPORTANT: DO NOT INVENT
============================================================

You may DERIVE SEARCH CONCEPTS from the meaning of an AC.

You may NOT invent:

- exact class names
- exact component names
- exact API paths
- exact database tables
- exact database columns
- exact SQL
- exact error messages
- exact configuration keys

unless those values are actually present in the supplied evidence.

The purpose of these terms is to FIND the implementation
evidence.

============================================================
SEARCH QUALITY
============================================================

Avoid producing many nearly identical queries.

Prefer diverse, useful terms.

Bad:
- create new task
- create new task record
- creating new task
- new task creation

Good:
- create task
- task creation workflow
- task type assignment
- task creation validation
- task API
- task status
- existing task tests

Again, only use concepts that are relevant to the actual AC.

============================================================
OUTPUT
============================================================

IMPORTANT OUTPUT RULES:
- Do NOT generate test cases.
- Do NOT return explanations.
- Do NOT return Markdown.
- Do NOT return a field named "testCases".
- Do NOT return a field named "raw".
- Return ONLY one valid JSON object.
- The JSON object MUST contain "acceptanceCriteria".
- Create one entry for EVERY acceptance criterion found in Jira.
- If an acceptance criterion does not require GitHub evidence, return an empty githubSearchTerms array for that criterion.
- Do not invent implementation names.
- Search terms should be semantic terms derived from the AC meaning.
- QMetry queries should search for existing testing intent, not merely Jira IDs.
- Confluence queries should search for business/domain clarification.
- GitHub queries should search implementation terminology only where implementation confirmation is useful.

REQUIRED JSON SHAPE:
{
  "acceptanceCriteria": [
    {
      "acId": "",
      "criterion": "",
      "concepts": {
        "entities": [],
        "actions": [],
        "conditions": [],
        "behaviors": [],
        "validations": [],
        "dataConcepts": []
      },
      "githubQueries": [],
      "qmetryQueries": [],
      "confluenceQueries": [],
      "implementationEvidenceNeeded": {
        "ui": false,
        "api": false,
        "database": false,
        "configuration": false
      }
    }
  ]
}

Return JSON ONLY.

Use exactly this structure:

{
  "databaseValidationLikely": false,
  "uiValidationLikely": false,
  "apiValidationLikely": false,

  "githubSearchTerms": [
    {
      "term": "",
      "category": "business|screen|navigation|field|action|validation|api|service|controller|table|column|configuration|constant|enum|workflow|general",
      "reason": "",
      "acId": ""
    }
  ],

  "qmetrySearchTerms": [
    {
      "term": "",
      "reason": "",
      "acId": ""
    }
  ],

  "confluenceSearchTerms": [
    {
      "term": "",
      "reason": "",
      "acId": ""
    }
  ],

  "importantBusinessTerms": [],

  "expectedEvidence": [],

  "risks": []
}

The search terms must be dynamically derived from the actual
Jira acceptance criteria and supplied evidence.

Do not assume any particular SWMS feature or domain.
`;


const prompt = `
JIRA:
${compact(jira, 20000)}

LINKED JIRA ISSUES:
${compact(linkedIssues, 20000)}

CONFLUENCE:
${compact(confluence, 30000)}

QMETRY:
${compact(qmetry, 20000)}

GITHUB:
${compact(github, 25000)}

Analyze the Jira Acceptance Criteria individually.

For EACH AC:

1. Identify its business intent.
2. Extract important business concepts.
3. Derive semantic GitHub search terms that could locate
   the actual implementation.
4. Derive QMetry search terms that could locate existing
   tests for the same behavior.
5. Derive Confluence search terms for relevant domain
   documentation.
6. Identify whether UI, API, database, configuration,
   validation, or workflow evidence is relevant.
7. Keep each search term traceable to its AC using acId.

IMPORTANT:

Do NOT simply copy the Jira AC text as the search query.

The search terms should represent the concepts a developer
or QA engineer would actually use when searching the
implementation and existing tests.

Do NOT assume the feature is Tasking or any other specific
SWMS domain.

Use the actual business meaning of the supplied ACs.

Do NOT invent exact technical names.
Search concepts may be semantic; exact implementation names
must only be reported later when discovered in evidence.

Return JSON in exactly this structure:

{
  "databaseValidationLikely": false,
  "uiValidationLikely": false,
  "apiValidationLikely": false,

  "githubSearchTerms": [
    {
      "term": "",
      "category": "business|screen|navigation|field|action|validation|api|service|controller|table|column|configuration|constant|enum|workflow|general",
      "reason": "",
      "acId": ""
    }
  ],

  "qmetrySearchTerms": [
    {
      "term": "",
      "reason": "",
      "acId": ""
    }
  ],

  "confluenceSearchTerms": [
    {
      "term": "",
      "reason": "",
      "acId": ""
    }
  ],

  "importantBusinessTerms": [],

  "expectedEvidence": [],

  "risks": []
}
`;



  const result =
    await askLLM(
      systemInstruction,
      prompt
    );

  return extractJson(result);
}

/**
 * ============================================================
 * EVIDENCE ANALYSIS
 * ============================================================
 */
export async function analyzeEvidence({
  jira,
  linkedIssues = [],
  confluence = [],
  qmetry = [],
  github = [],
  discoveryPlan = {}
}) {

const systemInstruction = `
You are QANEX Evidence Analyzer.

Analyze the supplied Jira, Confluence, QMetry and GitHub
evidence for enterprise QA test design.

Your objective is to produce a reliable implementation-aware
evidence summary for downstream test-case generation.

SOURCE PRIORITY:

1. Jira Acceptance Criteria
2. Jira description/comments/linked issues
3. Explicitly referenced Confluence documentation
4. QMetry existing test cases
5. GitHub implementation evidence

Do not invent technical information.

Every technical name must be traceable to supplied evidence.

Pay special attention to:

- exact UI names
- exact navigation names
- exact field names
- exact button/action names
- validation messages
- API routes
- services/controllers
- database tables
- database columns
- SysPar/configuration
- SQL patterns
- business rules
- valid/invalid states
- existing test coverage
- missing coverage
- negative scenarios
- boundary scenarios

Return JSON only.
`;

const prompt = `
JIRA:
${compact(jira, 20000)}

LINKED ISSUES:
${compact(linkedIssues, 20000)}

CONFLUENCE:
${compact(confluence, 30000)}

QMETRY:
${compact(qmetry, 25000)}

GITHUB:
${compact(github, 30000)}

DISCOVERY PLAN:
${compact(discoveryPlan, 12000)}

Produce a concise but complete evidence analysis.

Return:

{
  "implementationNames": [],
  "navigation": [],
  "fields": [],
  "actions": [],
  "messages": [],
  "api": [],
  "database": [],
  "configuration": [],
  "businessRules": [],
  "workflow": [],
  "existingCoverage": [],
  "missingCoverage": [],
  "sqlEvidence": [],
  "relevantGithubEvidence": [],
  "relevantQmetryEvidence": []
}
`;

  const result =
    await askLLM(
      systemInstruction,
      prompt
    );

  return extractJson(result);
}

export default {
  planEvidenceDiscovery,
  analyzeEvidence
};