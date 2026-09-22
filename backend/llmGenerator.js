import {
  callSageRawPredict
} from "./llm/sageClient.js";

/*
 * ============================================================
 * QANEX TEST CASE GENERATOR
 * ============================================================
 *
 * IMPORTANT:
 * This file uses the SAGE raw-predict endpoint only.
 *
 * ============================================================
 */


/**
 * ============================================================
 * CONFIGURATION
 * ============================================================
 */

const MODEL =
  process.env.SAGE_LLM_MODEL ||
  "gemini-3.7-flash";

const FALLBACK_MODEL =
  process.env.SAGE_LLM_FALLBACK_MODEL ||
  MODEL;


export async function planSemanticSearches({
  jira,
  linkedIssues = "",
  confluence = "",
  qmetry = ""
}) {
  const prompt = `
You are the QANEX semantic evidence-search planner.

Your job is NOT to generate test cases.

Analyze the Jira acceptance criteria and determine what concepts,
behaviors, entities, business rules, validations and implementation
areas must be searched for in order to find supporting evidence.

IMPORTANT:

1. Do NOT simply copy Jira sentences as search queries.
2. Do NOT depend on Jira issue IDs.
3. Do NOT depend on exact numeric values.
4. Do NOT assume a specific feature/domain such as Tasking, Inventory,
   Returns, Manifest, etc.
5. The approach must work for ANY SWMS feature.
6. Exact technical identifiers may be included ONLY when they are
   genuinely useful clues.
7. Prefer semantic/business concepts first.
8. Generate different queries for different evidence sources.

For EACH acceptance criterion determine:

- business entity
- user action
- system behavior
- condition
- expected result
- validation
- state transition
- persistence/data behavior
- likely UI concepts
- likely backend concepts
- likely database concepts

Then generate source-specific searches.

GITHUB searches should target:
- components
- pages
- services
- APIs
- handlers
- validation logic
- constants
- domain objects
- implementation terminology

QMETRY searches should target:
- existing test intent
- functional behavior
- validation behavior
- positive/negative scenarios
- similar business workflows

CONFLUENCE searches should target:
- business rules
- workflow descriptions
- navigation
- field meanings
- configuration
- domain terminology

Do NOT invent technical names.

Return ONLY JSON:

{
  "acceptanceCriteria": [
    {
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
      "confluenceQueries": []
    }
  ]
}

JIRA:
${JSON.stringify(jira, null, 2)}

LINKED JIRA:
${JSON.stringify(linkedIssues, null, 2)}

CONFLUENCE:
${JSON.stringify(confluence, null, 2)}

QMETRY:
${JSON.stringify(qmetry, null, 2)}
`;

  const result = await callSage(prompt);

  return extractJson(result);
}


/**
 * ============================================================
 * TEXT HELPERS
 * ============================================================
 */

function clean(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }

  if (
    typeof value === "string"
  ) {

    return value;

  }

  try {

    return JSON.stringify(
      value,
      null,
      2
    );

  } catch {

    return String(value);

  }

}


/**
 * ============================================================
 * JSON EXTRACTION
 * ============================================================
 *
 *Sage may occasionally return:
 *
 * ```json
 * {...}
 * ```
 *
 * or additional explanatory text.
 *
 * This function safely extracts the JSON.
 * ============================================================
 */

function sanitizeJsonText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  let text = String(value).trim();

  if (!text) {
    return text;
  }

  text = text
    .replace(/^\uFEFF/, "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!text) {
    return text;
  }

  text = text.replace(/\\(?=[^"\\/bfnrtu])/g, "");

  return text;
}

function parseJsonSafely(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractBalancedArrayFrom(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "[") {
      depth += 1;
      continue;
    }

    if (ch === "]") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function extractCompleteObjectsFromPartialArray(text, startIndex) {
  const objects = [];

  let inString = false;
  let escaped = false;
  let objectDepth = 0;
  let objectStart = -1;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === "{") {
      if (objectDepth === 0) {
        objectStart = i;
      }

      objectDepth += 1;
      continue;
    }

    if (ch === "}") {
      if (objectDepth > 0) {
        objectDepth -= 1;

        if (objectDepth === 0 && objectStart !== -1) {
          const candidate = text.slice(objectStart, i + 1);
          const parsed = parseJsonSafely(candidate);

          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            objects.push(parsed);
          }

          objectStart = -1;
        }
      }

      continue;
    }

    if (ch === "]" && objectDepth === 0) {
      break;
    }
  }

  return objects;
}

function salvageTestCasesFromText(rawText) {
  if (!rawText) {
    return null;
  }

  const sanitized = sanitizeJsonText(rawText);

  // First pass: convert escaped control sequences that often appear outside
  // JSON strings in model output and break strict parsing.
  const relaxed = sanitized
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");

  const keyMatch = /"testCases"\s*:\s*\[/i.exec(relaxed);

  if (!keyMatch) {
    return null;
  }

  const arrayStart = relaxed.indexOf("[", keyMatch.index);

  if (arrayStart === -1) {
    return null;
  }

  const arrayText = extractBalancedArrayFrom(relaxed, arrayStart);

  if (arrayText) {
    const parsedArray = parseJsonSafely(arrayText);

    if (Array.isArray(parsedArray)) {
      return {
        testCases: parsedArray
      };
    }
  }

  const recoveredObjects = extractCompleteObjectsFromPartialArray(
    relaxed,
    arrayStart
  );

  if (recoveredObjects.length > 0) {
    return {
      testCases: recoveredObjects
    };
  }

  return null;
}

function extractJson(response) {
  if (response === null || response === undefined) {
    return null;
  }

  if (typeof response === "object") {
    if (Array.isArray(response.testCases)) {
      return response;
    }

    if (Array.isArray(response.test_cases)) {
      return {
        testCases: response.test_cases
      };
    }

    if (Array.isArray(response)) {
      for (const item of response) {
        const result = extractJson(item);

        if (result) {
          return result;
        }
      }
    }

    for (const key of ["answer", "data", "content", "text", "value", "output_text", "result"]) {
      if (response[key] !== undefined) {
        const result = extractJson(response[key]);

        if (result) {
          return result;
        }
      }
    }

    if (Array.isArray(response.content)) {
      for (const item of response.content) {
        const result = extractJson(
          typeof item === "string"
            ? item
            : item?.answer ?? item?.text ?? item?.content ?? item
        );

        if (result) {
          return result;
        }
      }
    }

    if (response.candidates && Array.isArray(response.candidates)) {
      for (const candidate of response.candidates) {
        const result = extractJson(candidate);

        if (result) {
          return result;
        }
      }
    }

    if (response.predictions && Array.isArray(response.predictions)) {
      for (const prediction of response.predictions) {
        const result = extractJson(prediction);

        if (result) {
          return result;
        }
      }
    }

    return null;
  }

  let value = sanitizeJsonText(response);

  for (let i = 0; i < 3; i++) {
    const parsed = parseJsonSafely(value);

    if (parsed === null) {
      break;
    }

    if (typeof parsed === "string") {
      value = sanitizeJsonText(parsed);
      continue;
    }

    return extractJson(parsed);
  }

  const salvaged = salvageTestCasesFromText(value);

  if (salvaged) {
    return salvaged;
  }

  const objectStart = value.indexOf("{");
  const objectEnd = value.lastIndexOf("}");

  if (objectStart !== -1 && objectEnd > objectStart) {
    const candidate = sanitizeJsonText(
      value.slice(objectStart, objectEnd + 1)
    );

    const parsed = parseJsonSafely(candidate);

    if (parsed !== null) {
      return extractJson(parsed);
    }

    const salvagedFromObjectCandidate = salvageTestCasesFromText(candidate);

    if (salvagedFromObjectCandidate) {
      return salvagedFromObjectCandidate;
    }
  }

  const arrayStart = value.indexOf("[");
  const arrayEnd = value.lastIndexOf("]");

  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const candidate = sanitizeJsonText(
      value.slice(arrayStart, arrayEnd + 1)
    );

    const parsed = parseJsonSafely(candidate);

    if (Array.isArray(parsed)) {
      return {
        testCases: parsed
      };
    }

    const salvagedFromArrayCandidate = salvageTestCasesFromText(candidate);

    if (salvagedFromArrayCandidate) {
      return salvagedFromArrayCandidate;
    }
  }

  return null;
}


/**
 * ============================================================
 * SAGE CALL
 * ============================================================
 */

async function callSage(
  systemInstruction,
  prompt,
  options = {}
) {
  const timeoutMs =
    options.timeoutMs ||
    6000000;
  const models = [
    MODEL,
    FALLBACK_MODEL
  ]
    .filter(Boolean)
    .filter(
      (model, index, array) =>
        array.indexOf(model) === index
    );

  let lastError = null;

  const resolvedSystemInstruction =
    prompt === undefined
      ? "You are a helpful assistant."
      : systemInstruction;

  const resolvedPrompt =
    prompt === undefined
      ? systemInstruction
      : prompt;

  for (const model of models) {
    try {
      console.log(
        `[SAGE] Calling ${model}`
      );

      const responseText =
        await callSageRawPredict({
          systemInstruction:
            resolvedSystemInstruction,
          prompt: resolvedPrompt,
          timeoutMs,
          llmModelName: model
        });

      if (!responseText.trim()) {
        throw new Error(
          "SAGE returned an empty response."
        );
      }

      console.log(
        `[SAGE] ${model} response received`
      );

      return responseText;
    } catch (error) {
      lastError = error;

      console.error(
        `[SAGE] ${model} failed:`,
        error?.message || error
      );
    }
  }

  throw (
    lastError ||
    new Error("SAGE generation failed.")
  );

}


/**
 * ============================================================
 * ARRAY NORMALIZATION
 * ============================================================
 */

function toArray(value) {

  if (
    Array.isArray(value)
  ) {

    return value;

  }


  if (
    typeof value === "string"
  ) {

    return value
      .split(/\r?\n/)
      .map(
        item =>
          item.trim()
      )
      .filter(Boolean);

  }


  if (
    value &&
    typeof value === "object"
  ) {

    return [
      value
    ];

  }


  return [];

}


/**
 * ============================================================
 * SQL NORMALIZATION
 * ============================================================
 */

function normalizeSqlQueries(
  value
) {

  if (
    !Array.isArray(value)
  ) {

    return [];

  }


  return value

    .map(
      (
        item,
        sqlIndex
      ) => {

        if (
          typeof item === "string"
        ) {

          const query =
            item.trim();

          if (!query) {
            return null;
          }

          return {

            purpose:
              `Database validation ${sqlIndex + 1}`,

            table:
              "",

            query

          };

        }


        if (
          !item ||
          typeof item !== "object"
        ) {

          return null;

        }


        const query =
          String(
            item.query ||
            item.sql ||
            ""
          ).trim();


        if (!query) {

          return null;

        }


        return {

          purpose:
            item.purpose ||
            `Database validation ${sqlIndex + 1}`,

          table:
            item.table ||
            "",

          query

        };

      }
    )

    .filter(Boolean);

}


/**
 * ============================================================
 * TEST CASE NORMALIZATION
 * ============================================================
 */

function normalizeTestCase(
  tc,
  index
) {

  if (
    !tc ||
    typeof tc !== "object"
  ) {

    tc = {};

  }


  const id =
    tc.testCaseId ||
    tc.test_case_id ||
    tc.id ||
    `TC-${String(
      index + 1
    ).padStart(3, "0")}`;


  const title =
    tc.title ||
    tc.testCaseName ||
    tc.test_case_name ||
    tc.name ||
    `Verify ${
      tc.objective ||
      "expected system behavior"
    }`;


  const objective =
    tc.objective ||
    tc.testObjective ||
    tc.description ||
    "";


  /*
   * Preconditions
   */

  const preconditions =
    toArray(
      tc.preconditions
    );


  /*
   * SQL
   */

  const sqlQueries =
    normalizeSqlQueries(
      tc.sqlQueries ||
      tc.sql_queries ||
      []
    );


  /*
   * Test data
   */

  let testData =
    toArray(
      tc.testData ||
      tc.test_data ||
      []
    );


  /*
   * Make SQL visible inside Test Data.
   *
   * This is important because the QANEX Excel
   * formatter displays Test Data directly.
   */

  for (
    const sql
    of sqlQueries
  ) {

    const sqlBlock = [

      `Purpose: ${
        sql.purpose ||
        "Database validation"
      }`,

      sql.table
        ? `Table: ${sql.table}`
        : "",

      "SQL:",

      sql.query

    ]
      .filter(Boolean)
      .join("\n");


    /*
     * Avoid duplicating the same SQL
     * if the model already included it.
     */

    const alreadyIncluded =
      testData.some(
        item =>
          String(item)
            .includes(
              sql.query
            )
      );


    if (
      !alreadyIncluded
    ) {

      testData.push(
        sqlBlock
      );

    }

  }


  /*
   * Steps
   */

  let steps =
    Array.isArray(
      tc.steps
    )
      ? tc.steps.map(
          (
            step,
            stepIndex
          ) => {

            if (
              typeof step === "string"
            ) {

              return {

                step:
                  stepIndex + 1,

                action:
                  step,

                expectedResult:
                  ""

              };

            }


            return {

              step:
                Number(
                  step?.step
                ) ||
                stepIndex + 1,

              action:
                step?.action ||
                step?.stepDescription ||
                step?.description ||
                step?.testStep ||
                "",

              expectedResult:
                step?.expectedResult ||
                step?.expected ||
                step?.expected_result ||
                ""

            };

          }
        )

      : [];


  /*
   * Remove completely empty steps.
   */

  steps =
    steps.filter(
      step =>
        String(
          step.action ||
          ""
        ).trim() !== ""
    );



  /*
   * Every step needs an expected result.
   *
   * We do NOT invent detailed behavior here.
   * If the model omitted it, provide a neutral
   * execution-result statement rather than leaving
   * the Excel field empty.
   */

  steps =
  steps.map(
    (
      step,
      stepIndex
    ) => ({

      ...step,

      step:
        stepIndex + 1,

      action:
        String(
          step.action ||
          step.stepDescription ||
          step.description ||
          ""
        ).trim(),

      expectedResult:
  String(
    step.expectedResult ||
    ""
  ).trim()

    })
  );


  /*
   * Requirement coverage
   */

  let requirementCoverage =
    tc.requirementCoverage ||
    tc.requirement_coverage ||
    tc.coverage?.acceptanceCriteria ||
    tc.coverage?.acceptance_criteria ||
    [];


  requirementCoverage =
    toArray(
      requirementCoverage
    );


  /*
   * Database validation
   */

  const databaseValidation =
    tc.databaseValidation === true ||
    tc.database_validation === true ||
    sqlQueries.length > 0;


  if (
    tc.databaseValidation === true &&
    sqlQueries.length === 0
  ) {

    console.warn(
      `[QANEX] Database validation requested but no SQL query was generated for ${id}.`
    );

  }


  if (
    sqlQueries.length > 0 &&
    tc.databaseValidation !== true
  ) {

    console.warn(
      `[QANEX] SQL query generated; forcing databaseValidation=true for ${id}.`
    );

  }


  /*
   * Priority
   */

  const priorityValues = [
    "High",
    "Medium",
    "Low"
  ];


  const priority =
    priorityValues.includes(
      tc.priority
    )
      ? tc.priority
      : "High";


  /*
   * Type
   */

  const typeValues = [

    "Functional",
    "Negative",
    "Boundary",
    "CRUD",
    "Database",
    "Authorization",
    "Validation",
    "UI"

  ];


  const type =
    typeValues.includes(
      tc.type
    )
      ? tc.type
      : "Functional";

  return {

    testCaseId:
      String(id),

    title:
      String(title),

    objective:
      String(objective),

    preconditions,

    testData,

    steps,

    expectedResult:
      String(
        tc.expectedResult ||
        tc.expected_result ||
        ""
      ),

    priority,

    type,

    requirementCoverage,

    databaseValidation,

    sqlQueries

  };

}


/**
 * ============================================================
 * GENERATE TEST CASES
 * ============================================================
 */

export async function generateTestCasesWithGemini({

  jira,

  linkedIssues = [],

  confluence = [],

  github = [],

  qmetry = [],

  evidence = {}

}) {


  console.log(
    "\n[QANEX] Test case generation provider: SAGE raw-predict"
  );

  console.log(
    `[QANEX] SAGE model: ${MODEL}`
  );


  /**
   * ==========================================================
   * SYSTEM INSTRUCTION
   * ==========================================================
   */

  const systemInstruction = `

You are QANEX, an enterprise QA test-design
engineer for the SWMS application.

Your responsibility is to generate advanced,
implementation-aware, executable test cases.

You MUST use the supplied Jira, linked Jira,
Confluence, QMetry, GitHub and verified evidence.

============================================================
SOURCE PRIORITY
============================================================

1. Jira Acceptance Criteria
2. Jira description/comments and linked Jira
3. Confluence pages explicitly referenced by the requirement
4. QMetry existing test cases
5. GitHub source-code evidence


Jira determines WHAT must be tested.

Confluence explains business rules, navigation,
workflow and domain behavior.

QMetry provides existing coverage, test patterns,
SQL patterns and duplicate-coverage information.

GitHub is the preferred source for verifying
implementation-specific terminology when available. GitHub availability must NEVER be a prerequisite
for generating test cases.


GitHub is NOT a hard dependency for test-case generation.


============================================================
GITHUB FAILURE RULE
============================================================

GitHub is OPTIONAL SUPPORTING EVIDENCE.

GitHub may be unavailable because of:
- API rate limits
- authentication failures
- network failures
- repository search failures
- unavailable source files

If GitHub evidence is empty, incomplete, or unavailable:

1. DO NOT refuse to generate test cases.
2. DO NOT say that test-case generation is impossible.
3. DO NOT mention GitHub failure in the generated test cases.
4. Continue using:
   - Jira
   - linked Jira
   - Confluence
   - QMetry
   - verified evidence
5. Use business-level terminology from Jira/Confluence
   instead of inventing implementation names.

NEVER refuse to generate test cases because GitHub
evidence is unavailable.

NEVER say that test cases cannot be generated because
GitHub is unavailable.

Do not invent implementation details when GitHub evidence
is unavailable. Instead, use only the behavior supported
by Jira, Confluence, QMetry, and verified evidence.

GitHub evidence improves implementation accuracy when writing queries by providing actual component names, database tables, and column names, but its absence MUST NOT prevent test-case generation.

============================================================
CRITICAL EVIDENCE RULE
============================================================

Do NOT use outside knowledge.

Every technical implementation detail must come
from the supplied evidence.

Do not invent:

- screen names
- menu names
- field names
- button names
- validation messages
- API routes
- endpoint names
- service names
- controller names
- table names
- column names
- database relationships
- configuration names
- enum values
- SQL queries

If an exact implementation name is not supported,
use the business-level terminology from Jira.

If GitHub evidence is unavailable due temporary
rate limits or fetch failures, continue using Jira,
linked Jira, Confluence and QMetry evidence.
Do not refuse to generate test cases.

============================================================
QMETRY ANALYSIS
============================================================

Review ALL supplied QMetry evidence.

Determine:

- existing matching cases
- partially matching cases
- related cases
- duplicate coverage
- useful test-data patterns
- navigation patterns
- validation patterns
- SQL patterns
- missing coverage

Do not simply copy QMetry.

Generate new test cases only when they represent
a distinct testing intent required by the current
requirement.

============================================================
CONFLUENCE ANALYSIS
============================================================

Use Confluence evidence for:

- business rules
- workflows
- navigation
- valid states
- invalid states
- prerequisites
- configuration
- domain terminology
- expected behavior

============================================================
GITHUB ANALYSIS
============================================================

Use GitHub evidence to verify implementation details.

Use actual evidence-supported:

- UI component names
- screen names
- field names
- buttons
- API endpoints
- services
- controllers
- database tables
- database columns
- SQL
- persistence behavior
- state transitions

Never fabricate implementation details.

============================================================
MANDATORY DATABASE ANALYSIS
============================================================

For EVERY test case determine whether the business
behavior has database impact.

Inspect:

evidence.database.tables

evidence.database.columns

evidence.database.relationships

evidence.database.persistenceOperations

evidence.sql.supportedQueries

Also inspect:

- GitHub source code
- QMetry SQL
- supplied SQL patterns

When the evidence establishes database schema,
databaseValidation MUST be true for behavior that
requires database verification.

GitHub is optional supporting evidence.

GitHub failure, rate limiting, timeout,
empty results, or unavailable implementation
evidence must NEVER prevent test-case generation.
When GitHub evidence is unavailable, use Jira, Confluence and QMetry.

============================================================
SQL GENERATION RULES
============================================================

Generate SQL ONLY when the required schema is
supported by supplied evidence.

Every SQL query MUST use:

- actual evidence-supported table names
- actual evidence-supported column names
- actual evidence-supported relationships
- actual identifying values or clearly named test-data placeholders

The query must validate the actual business outcome.

Do NOT use:

SELECT *

unless evidence specifically requires it.

Do NOT invent:

- tables
- columns
- joins
- aliases
- identifiers
- values
- relationships

Historical QMetry SQL may be used as a pattern only
after current evidence confirms that the same schema
and behavior apply.

If schema evidence is genuinely missing:

databaseValidation = false

sqlQueries = []

Do NOT invent SQL.

============================================================
SQL OUTPUT FORMAT
============================================================

When database validation is required:

"databaseValidation": true,

"sqlQueries": [
  {
    "purpose": "Business behavior being verified",
    "table": "Exact evidence-supported table",
    "query": "Executable SQL"
  }
]

SQL must also be represented in Test Data.

============================================================
TEST DESIGN
============================================================

Analyze the requirement for applicable:

- happy paths
- alternate flows
- negative flows
- required fields
- invalid values
- boundary values
- duplicate data
- create
- read
- update
- delete
- cancellation
- state transitions
- persistence
- refresh/search behavior
- UI validation
- backend validation
- database integrity
- configuration behavior
- authorization behavior

Do NOT create unnecessary tests just to increase
the number of cases.

One test case = one distinct testing intent.

For EACH test case:

1. Identify the exact acceptance criterion.
2. Identify the business behavior being tested.
3. Determine the appropriate test type.
4. Review existing QMetry coverage.
5. Review Confluence business rules and navigation.
6. Use GitHub implementation evidence when available.
7. If GitHub evidence is unavailable, continue using the
   other available evidence.
8. Never refuse generation because GitHub evidence is missing.
9. Determine whether database verification is required.
10. Generate SQL only when database schema is supported.
11. Include SQL in Test Data when SQL is generated.
12. Make SQL execution an explicit test step when SQL exists.
13. Give every step an expected result.
14. Do not invent unsupported implementation details.
15. Do not duplicate existing QMetry coverage unnecessarily.

Return ONLY:

{
  "testCases": [...]
}

============================================================
DO NOT CONVERT REQUIREMENT SENTENCES INTO TEST STEPS
============================================================

Acceptance criteria are requirements, not step instructions.

Do NOT create steps such as:

"Perform action for: ..."
"Perform action for: GIVEN..."
"Perform action for: WHEN..."
"Perform action for: THEN..."
"Expected outcome is shown for: ..."

Instead, interpret the acceptance criterion and convert it
into a natural executable QA workflow.

Example:

Requirement:
"GIVEN SWMS Main Menu WHEN clicked on Tasking menu AND
Tasking Function sub menu THEN I should be directed to
Tasking Function screen."

Generate:

Step 1:
Login to SWMS NewUI

Step 2:
Go to Menu -> Tasking -> Tasking Function

Expected result:
Tasking Function screen is displayed.

Do not create separate steps for:
- GIVEN
- WHEN
- THEN
- acceptance criterion sentences
- requirement text

GIVEN/WHEN/THEN describes the behavior to test.
It is NOT itself a test action.

============================================================
TEST CASE QUALITY
============================================================

Every test case must:

1. Trace to one or more acceptance criteria.
2. Have a clear testing objective.
3. Have meaningful preconditions.
4. Have appropriate test data.
5. Have granular executable steps.
6. Have an expected result for EVERY step.
7. Cover the actual business behavior.
8. Use evidence-supported technical names.
9. Include database verification when evidence
   shows database impact.
10. Avoid duplicate QMetry coverage.

============================================================
PRECONDITIONS
============================================================

Preconditions must describe how the required state
is established.

Use evidence-supported:

- user setup
- authorization
- configuration
- existing records
- related records
- application state
- database state

Do not use vague preconditions.

Preconditions must be numbered and specific.

============================================================
STEPS
============================================================

Steps must be granular and executable.

Each step contains exactly two important parts:

- action = what the tester does
- expectedResult = what the system should do/show after that action

IMPORTANT EXPECTED RESULT RULES:

- expectedResult must describe the SYSTEM RESULT of the action.
- Do NOT repeat the action inside expectedResult.
- Do NOT write phrases such as:
  "Expected behavior is shown for..."
  "Expected outcome is shown for..."
  "The user performs..."
  "Perform action..."
  "Action is completed..."
- Do NOT copy the action into expectedResult.
- Do NOT leave expectedResult empty.
- Do NOT use generic statements.
- The expected result must be specific to the business behavior.

Example:

BAD:
{
  "action": "Click Tasking Function",
  "expectedResult": "Expected behavior is shown for: Click Tasking Function."
}

BAD:
{
  "action": "Click Tasking Function",
  "expectedResult": "Click Tasking Function successfully."
}

GOOD:
{
  "action": "Click Tasking Function",
  "expectedResult": "The Tasking Function screen is displayed."
}

GOOD:
{
  "action": "Click Save",
  "expectedResult": "The new Tasking Function is saved and appears in the Tasking Function list in alphabetical order."
}

GOOD:
{
  "action": "Enter a duplicate Tasking Function name",
  "expectedResult": "The system displays the 'Tasking Function already exists' validation message and does not create a duplicate record."
}

Every step MUST have a meaningful, business-specific expectedResult.

Do NOT combine unrelated actions into one step.

MANDATORY FORMAT RULES:

- Step 1 must be:
  "Login to SWMS NewUI"

- Step 1 expectedResult must describe successful login.

- Step 2 must contain the actual evidence-supported navigation path in this format:
  "Go to Menu -> Submenu -> Screen"

- Step 2 expectedResult must state that the target screen is displayed.

- Do NOT invent menu names.
- Use the navigation terminology supported by Jira or Confluence.
- One action per step.
- Every step must have a specific expectedResult and Test Data if exists.
- expectedResult must describe the system response, not repeat the action.
- Do not include passive wait-only steps

Every step MUST contain:

"action"

and

"expectedResult"

============================================================
TEST DATA
============================================================

Test Data may contain:

- user information
- feature-specific values
- prerequisite values
- identifiers
- configuration values
- expected values
- database identifiers
- SQL queries

Only use evidence-supported values or clearly
named placeholders.

Examples:

<ORDER_NUMBER>
<ROUTE_NUMBER>
<COMPANY_CODE>
<CUSTOMER_ID>

MANDATORY TEST DATA RULES:

- Number test data entries to align with step numbers
- Include only steps that need input data
- SQL must be placed in Test Data (not in action text)

IMPORTANT STEP GENERATION RULES:

- Generate executable UI actions, not descriptions of actions.
- Do NOT use phrases such as:
  "Perform action for:"
  "Perform action:"
  "Action for:"
  "Expected outcome is shown for:"
- Do NOT repeat a navigation/menu action as a separate action.
- Each step must represent one real user action or one verification.
- Preserve the logical order of the workflow from the evidence.
- Step 2 must be the actual navigation path.
- Do not invent intermediate actions that are not supported by the evidence.
- Do not rewrite a navigation step as another "Perform action" step.

Example of WRONG output:
1. Login to SWMS NewUI
2. Go to Menu -> 1) Tasking Function sub menu.
3. Perform action for: 1) Tasking Function sub menu.
4. Perform action for: Tasking Function List View Screen Name.

Example of CORRECT output:
1. Log in to SWMS NewUI.
2. Go to Menu -> 1) Tasking Function sub menu.
3. Select Tasking Function.
4. Verify that the Tasking Function screen is displayed.

============================================================
OUTPUT
============================================================

Return ONLY valid JSON.

Do NOT return Markdown.

Do NOT return explanations.

Do NOT wrap the JSON in code fences.

Use EXACTLY this structure:

{
  "testCases": [
    {
      "testCaseId": "TC-001",
      "title": "Clear test case title",
      "objective": "Specific business behavior being validated",
      "preconditions": [
        "Required precondition"
      ],
      "testData": [
        "Required test data"
      ],
      "steps": [
        {
          "step": 1,
          "action": "Executable action",
          "expectedResult": "Expected result"
        }
      ],
      "priority": "High",
      "type": "Functional",
      "requirementCoverage": [
        "Acceptance Criterion covered"
      ],
      "databaseValidation": false,
      "sqlQueries": []
    }
  ]
}

============================================================
FINAL QUALITY CHECK
============================================================

Before returning JSON, verify:

- Every AC has appropriate coverage.
- Every test case has one distinct intent.
- Every step has an expected result.
- Technical names are evidence-supported.
- SQL is not invented.
- Database behavior is not unnecessarily omitted.
- Existing QMetry cases are not blindly duplicated.
- SQL is included in Test Data when SQL exists.
- Output is valid JSON only.

- Title starts with "Verify" and clearly describes the business behavior being tested.
- Include authentication/navigation steps only when they are required to execute the test.
- Do not force every test case to use the same navigation sequence.
- Do not use placeholder actions such as "Perform action for".
- Every step must be a real, executable action.
- Every step must have a specific expected result describing what should happen after that action.
- Expected results must describe observable application behavior, validation, state change, or data outcome.
- Never create an expected result by merely repeating or describing the action.
- Do not use phrases such as "Expected behavior is shown for", "Perform action for", "Expected outcome is shown for", or similar placeholders.
- Steps and expected results must correspond one-to-one.
- Step 1 should establish authentication only when authentication is not already given as a precondition.
- Navigation should use the exact UI names supported by the evidence.

`;


  /**
   * ==========================================================
   * USER PROMPT
   * ==========================================================
   */

  const prompt = `

================ JIRA ================

${clean(jira)}


================ LINKED JIRA ================

${clean(linkedIssues)}


================ CONFLUENCE ================

${clean(confluence)}


================ QMETRY ================

${clean(qmetry)}


================ GITHUB ================

${clean(github)}


================ VERIFIED EVIDENCE MAP ================

${clean(evidence)}


============================================================
Return the requested JSON testCases object regardless of
GitHub availability.

Generate the final QANEX manual test cases.

The output must represent realistic QA test cases that a QA engineer
could execute manually against the application.

Use the supplied Jira, Confluence, QMetry and GitHub evidence to improve
accuracy.

Jira acceptance criteria define the required scope.

Confluence provides business rules and functional context.

QMetry provides existing test coverage and should be used to avoid
unnecessary duplication.

GitHub provides implementation evidence and should only be used to
confirm actual UI, API, service, component, validation or data behavior.

Do not invent unsupported behavior.

Do not create artificial test cases simply to increase the number of
cases.

Do not add SQL/database steps unless database verification is explicitly
supported by the evidence and genuinely necessary for the test intent.

Do not add an SQL execution step merely because a database table is
mentioned.

Prefer realistic UI/API/business-level manual testing steps.

Each test case must have:

- Test Case ID
- Title
- Preconditions
- Steps
- Test Data
- Expected Result
- Priority
- Type
- Requirement Coverage

Steps and expected results must correspond one-to-one.

Steps must be granular and executable.

Expected results must describe observable application behavior.

Do not write explanations outside the JSON.

Return ONLY:

{
  "testCases": [...]
}
`;


  /**
   * ==========================================================
  * CALL PRIMARY LLM
   * ==========================================================
   */

  const response =
    await callSage(
      systemInstruction,
      prompt
    );

  console.log(
  "[QANEX] Raw SAGE generation response:"
);

console.log(
  JSON.stringify(
    response,
    null,
    2
  )
);


  /**
   * ==========================================================
   * PARSE RESPONSE
   * ==========================================================
   */

  const parsed =
    extractJson(response);

  console.log(
  "[QANEX] Extracted SAGE JSON:"
);

console.log(
  JSON.stringify(
    parsed,
    null,
    2
  )
);

  let rawCases = [];


  if (
    Array.isArray(
      parsed
    )
  ) {

    rawCases =
      parsed;

  } else if (
    Array.isArray(
      parsed?.testCases
    )
  ) {

    rawCases =
      parsed.testCases;

  } else if (
    Array.isArray(
      parsed?.test_cases
    )
  ) {

    rawCases =
      parsed.test_cases;

  }


  if (
    rawCases.length === 0
  ) {

    console.error(
      "[QANEX] SAGE did not return valid test cases."
    );

    console.error(
      "[QANEX] Raw response:"
    );

    console.error(
      response
    );

    return {
      testCases: []
    };

  }


  /**
   * ==========================================================
   * NORMALIZE
   * ==========================================================
   */

  const testCases =
    rawCases.map(
      (
        testCase,
        index
      ) =>
        normalizeTestCase(
          testCase,
          index
        )
    );


  console.log(
    `[QANEX] Generated ${testCases.length} test case(s) using SAGE.`
  );


  return {

    testCases

  };

}


/**
 * ============================================================
 * OPTIONAL EXPORTS
 * ============================================================
 *
 * These are useful for testing/debugging without exposing
 * provider-specific implementation to the rest of QANEX.
 * ============================================================
 */

export {
  clean,
  extractJson,
  normalizeTestCase
};