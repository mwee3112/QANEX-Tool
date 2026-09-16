import {
  getJiraIssue,
  getLinkedJiraIssues,
  getSwmsDomainContext,
  getConfluencePages,
  searchGitHub,
  searchGitHubImplementation,
  searchGitHubCommits,
  getGitHubFileContents,
  extractGitHubFilePaths,
  searchQMetryCases,
  getQMetryCaseDetails,
  getQMetryCaseRequirements,
  getQMetryDomainContext
} from "./mcp.js";

import {
  generateTestCasesWithGemini,
  planSemanticSearches
} from "./llmGenerator.js";

import {
  planEvidenceDiscovery,
  analyzeEvidence
} from "./llm/evidenceAnalyzer.js";

import {
  validateTestCases
} from "./llm/testCaseValidator.js";


/*
 * QANEX SOURCE PRIORITY
 *
 * 1. Jira Acceptance Criteria
 *    Primary source of requirements and test scope.
 *
 * 2. Jira description / linked Jira
 *    Supporting requirement context.
 *
 * 3. Confluence referenced by the requirement
 *    Business rules, navigation, validation and domain context.
 *
 * 4. QMetry
 *    Existing test patterns, coverage and duplication detection.
 *
 * 5. GitHub
 *    Implementation/UI/API names and behavior confirmation.
 *
 * Supporting sources must improve accuracy,
 * but failure or absence of supporting evidence
 * must not prevent test generation when the Jira AC
 * contains enough information.
 */



/**
 * ============================================================
 * TEXT HELPERS
 * ============================================================
 */

function normalizeText(value) {

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

  return JSON.stringify(
    value
  );

}

function normalizeGeneratedTestCases(result) {

  /*
   * Already an array
   */
  if (Array.isArray(result)) {
    return result;
  }


  /*
   * Already in expected form:
   *
   * {
   *   testCases: [...]
   * }
   */
  if (Array.isArray(result?.testCases)) {
    return result.testCases;
  }


  /*
   * Alternative internal wrapper
   */
  if (Array.isArray(result?.repairedTestCases)) {
    return result.repairedTestCases;
  }


  /*
   * SAGE may return:
   *
   * {
   *   answer: {
   *     testCases: [...]
   *   }
   * }
   */
  if (Array.isArray(result?.answer?.testCases)) {
    return result.answer.testCases;
  }


  /*
   * SAGE commonly returns:
   *
   * {
   *   answer: "```json
   *   {
   *     \"testCases\": [...]
   *   }
   *   ```"
   * }
   */
  if (typeof result?.answer === "string") {

    let text =
      result.answer.trim();


    /*
     * Remove Markdown code fences.
     */
    text =
      text
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


    /*
     * First try parsing the complete answer.
     */
    try {

      const parsed =
        JSON.parse(text);


      if (
        Array.isArray(
          parsed?.testCases
        )
      ) {

        return parsed.testCases;

      }


      if (
        Array.isArray(parsed)
      ) {

        return parsed;

      }

    } catch (error) {

      console.warn(
        "[QANEX] Direct SAGE answer JSON parse failed:",
        error.message
      );

    }


    /*
     * SAGE can sometimes add text before/after
     * the JSON object.
     *
     * Extract the JSON object from the response.
     */
    const objectStart =
      text.indexOf("{");

    const objectEnd =
      text.lastIndexOf("}");


    if (
      objectStart !== -1 &&
      objectEnd > objectStart
    ) {

      const candidate =
        text.slice(
          objectStart,
          objectEnd + 1
        );


      try {

        const parsed =
          JSON.parse(candidate);


        if (
          Array.isArray(
            parsed?.testCases
          )
        ) {

          return parsed.testCases;

        }


        if (
          Array.isArray(parsed)
        ) {

          return parsed;

        }

      } catch (error) {

        console.warn(
          "[QANEX] Embedded SAGE JSON parse failed:",
          error.message
        );

      }

    }

  }


  /*
   * SAGE may return the entire response
   * as a string instead of { answer: ... }.
   */
  if (typeof result === "string") {

    let text =
      result.trim();


    text =
      text
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


    try {

      const parsed =
        JSON.parse(text);


      if (
        Array.isArray(
          parsed?.testCases
        )
      ) {

        return parsed.testCases;

      }

      if (
        Array.isArray(parsed)
      ) {

        return parsed;

      }

    } catch {
      // Try embedded JSON below.
    }


    const objectStart =
      text.indexOf("{");

    const objectEnd =
      text.lastIndexOf("}");


    if (
      objectStart !== -1 &&
      objectEnd > objectStart
    ) {

      try {

        const parsed =
          JSON.parse(
            text.slice(
              objectStart,
              objectEnd + 1
            )
          );


        if (
          Array.isArray(
            parsed?.testCases
          )
        ) {

          return parsed.testCases;

        }

      } catch (error) {

        console.warn(
          "[QANEX] Could not extract test cases from SAGE string:",
          error.message
        );

      }

    }

  }


  console.warn(
    "[QANEX] normalizeGeneratedTestCases: no test cases found."
  );

  return [];
}

function toList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  return [value];
}

function normalizeTitleTags(value) {
  const text =
    String(value || "")
      .replace(/\s+/g, " ")
      .trim();

  if (!text) {
    return "";
  }

  const bracketTags =
    text.match(/\[[^\]]+\]/g) || [];

  if (bracketTags.length) {
    return `${bracketTags.join("")} `;
  }

  return `${text} `;
}

function applyTitleTags(title, titleTags = "") {
  const normalizedTags =
    normalizeTitleTags(titleTags);

  let rawTitle =
    String(title || "").trim();

  if (!rawTitle) {
    rawTitle = "Verify expected behavior";
  }

  if (!/^verify\b/i.test(rawTitle)) {
    rawTitle = `Verify ${rawTitle}`;
  }

  if (
    normalizedTags &&
    rawTitle.startsWith(normalizedTags)
  ) {
    return rawTitle;
  }

  return `${normalizedTags}${rawTitle}`.trim();
}

function defaultExpectedFromAction(action) {
  const cleaned =
    String(action || "")
      .replace(/^\s*\d+\.\s*/, "")
      .trim();

  if (!cleaned) {
    return "";
  }

  if (/^login to swms newui/i.test(cleaned)) {
    return "User is successfully authenticated and the SWMS New UI home page is displayed.";
  }

  if (/^go to menu\s*->/i.test(cleaned)) {
    return "The target screen is displayed.";
  }

  return "";
}

function normalizeCaseForOutput(testCase, index, titleTags = "") {
  const id =
    testCase?.testCaseId ||
    `TC-${String(index + 1).padStart(3, "0")}`;

  const preconditions =
    toList(testCase?.preconditions)
      .map((item, itemIndex) => {
        if (typeof item === "string") {
          return `${itemIndex + 1}. ${item}`;
        }

        return `${item.step || itemIndex + 1}. ${item.description || item.action || JSON.stringify(item)}`;
      })
      .join("\\n");

  const stepsList =
    Array.isArray(testCase?.steps)
      ? testCase.steps
      : toList(testCase?.steps).map((action, stepIndex) => ({
          step: stepIndex + 1,
          action,
          expectedResult: ""
        }));

  const steps =
    stepsList
      .map((step, stepIndex) => {
        const number =
          Number(step?.step) || stepIndex + 1;

        return `${number}. ${step?.action || step?.description || step?.stepDescription || ""}`;
      })
      .join("\\n");

  const expectedResult =
    stepsList
      .map((step, stepIndex) => {
        const number =
          Number(step?.step) || stepIndex + 1;

        return `${number}. ${step?.expectedResult || step?.expected || defaultExpectedFromAction(step?.action || step?.description || step?.stepDescription || "")}`;
      })
      .join("\\n");

  const testDataBase =
    toList(testCase?.testData)
      .map((item, itemIndex) => {
        if (typeof item === "string") {
          return `${itemIndex + 1}. ${item}`;
        }

        return `${item.step || itemIndex + 1}. ${item.value || item.data || item.description || JSON.stringify(item)}`;
      });

  const sqlRows =
    Array.isArray(testCase?.sqlQueries)
      ? testCase.sqlQueries
          .filter(sql => sql?.query)
          .map((sql, sqlIndex) => {
            const number = testDataBase.length + sqlIndex + 1;
            return `${number}. ${sql.purpose || "Database verification"}:\\n${sql.query}`;
          })
      : [];

  const testData =
    [...testDataBase, ...sqlRows].join("\\n") ||
    "1. Use data specified by Jira acceptance criteria.";

  return {
    ...testCase,
    testCaseId: String(id),
    title: applyTitleTags(
      testCase?.title,
      titleTags
    ),
    preconditions: preconditions || "1. Required state is available.",
    steps,
    testData,
    expectedResult
  };
}

function deterministicRepair(testCases = [], titleTags = "") {
  return testCases.map((testCase, index) => {
    const normalized =
      normalizeCaseForOutput(
        testCase,
        index,
        titleTags
      );

    const lines =
      normalized.steps
        .split("\\n")
        .filter(Boolean);

    const coverageText =
      toList(testCase?.requirementCoverage)
        .join(" ") ||
      String(testCase?.title || "");

    const fallbackAction =
      summarizeCriterionForTitle(
        coverageText
      ) ||
      "required behavior";

    if (!lines.length) {
      normalized.steps =
        `1. Login to SWMS NewUI\\n2. Execute the acceptance-criterion flow: ${fallbackAction}.`;

      normalized.expectedResult =
        `1. User is authenticated successfully.\\n2. The system behavior for \"${fallbackAction}\" is displayed as defined by acceptance criteria.`;
    }

    const firstStep =
      lines[0] || "";

    if (
      !/login to swms newui/i.test(firstStep)
    ) {
      const shiftedSteps =
        normalized.steps
          ? normalized.steps
              .split("\\n")
              .map((line, stepIndex) => {
                const match =
                  line.match(/^\s*\d+\.\s*(.*)$/);

                return `${stepIndex + 2}. ${match ? match[1] : line}`;
              })
              .join("\\n")
          : "";

      const shiftedExpected =
        normalized.expectedResult
          ? normalized.expectedResult
              .split("\\n")
              .map((line, stepIndex) => {
                const match =
                  line.match(/^\s*\d+\.\s*(.*)$/);

                return `${stepIndex + 2}. ${match ? match[1] : line}`;
              })
              .join("\\n")
          : "";

      normalized.steps =
        [
          "1. Login to SWMS NewUI",
          shiftedSteps
        ]
          .filter(Boolean)
          .join("\\n");

      normalized.expectedResult =
        [
          "1. User is authenticated successfully.",
          shiftedExpected
        ]
          .filter(Boolean)
          .join("\\n");

      if (!/1\.\s*username:/i.test(normalized.testData)) {
        normalized.testData =
          `1. Username: <valid_username> / Password: <valid_password>\\n${normalized.testData}`;
      }
    }

    const currentStepLines =
      normalized.steps
        .split("\\n")
        .filter(Boolean);

    const secondStepLine =
      currentStepLines[1] || "";

    if (!/^\s*2\.\s*go to menu\s*->/i.test(secondStepLine)) {
      const coverageContext =
        toList(testCase?.requirementCoverage)
          .join(" ") ||
        normalized.title;

      const navigationContext =
        summarizeCriterionForTitle(coverageContext) ||
        "target function";

      const renumberedActions =
        currentStepLines
          .filter((_, i) => i !== 1)
          .map((line, idx) => {
            const content =
              line.replace(/^\s*\d+\.\s*/, "").trim();
            return `${idx + 1}. ${content}`;
          });

      renumberedActions.splice(
        1,
        0,
        `2. Go to Menu -> ${navigationContext}.`
      );

      const expectedLines =
        normalized.expectedResult
          .split("\\n")
          .filter(Boolean)
          .map(line => line.replace(/^\s*\d+\.\s*/, "").trim());

      while (expectedLines.length < renumberedActions.length - 1) {
        expectedLines.push("Expected behavior is displayed according to acceptance criteria.");
      }

      expectedLines.splice(
        1,
        0,
        `${navigationContext} screen or workflow context is opened.`
      );

      normalized.steps = renumberedActions
        .join("\\n");

      normalized.expectedResult =
        expectedLines
          .map((line, idx) => `${idx + 1}. ${line}`)
          .join("\\n");
    }

    return normalized;
  });
}

function extractQMetryCaseIds(value) {

  const ids =
    new Set();

  function addCandidate(value) {

    if (
      value === null ||
      value === undefined
    ) {
      return;
    }

    const text =
      String(value)
        .trim();

    if (!text) {
      return;
    }

    /*
     * Normal QMetry test-case IDs.
     *
     * Examples:
     * ABC-TC-001
     * ABC_TC_001
     * ABC-TC001
     * ABC TC 001
     */

    const matches =
      text.match(
        /\b[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*[-_ ]?TC[-_ ]?\d+\b/gi
      ) || [];

    for (
      const match
      of matches
    ) {
      ids.add(
        match.trim()
      );
    }

  }

  function walk(item) {

    if (
      item === null ||
      item === undefined
    ) {
      return;
    }

    /*
     * Strings
     */

    if (
      typeof item === "string"
    ) {

      addCandidate(item);

      return;

    }

    /*
     * Arrays
     */

    if (
      Array.isArray(item)
    ) {

      for (
        const child
        of item
      ) {

        walk(child);

      }

      return;

    }

    /*
     * Objects
     */

    if (
      typeof item === "object"
    ) {

      for (
        const [key, child]
        of Object.entries(item)
      ) {

        const lowerKey =
          key
            .toLowerCase();

        /*
         * QMetry may expose the ID using
         * several different property names.
         */

        if (
          lowerKey.includes("testcase") ||
          lowerKey.includes("test_case") ||
          lowerKey === "key" ||
          lowerKey === "id" ||
          lowerKey === "testcaseid" ||
          lowerKey === "test_case_id"
        ) {

          addCandidate(child);

        }

        walk(child);

      }

    }

  }

  walk(value);

  return [
    ...ids
  ];

}

function buildDynamicQMetryQueries({
  jira,
  linkedIssues = [],
  domainContext = [],
  discoveryPlan = {}
}) {
  const queries = [];

  function add(value) {
    if (
      value === null ||
      value === undefined
    ) {
      return;
    }

    const text =
      String(value)
        .replace(/\s+/g, " ")
        .trim();

    if (
      /^https?:\/\//i.test(text)
    ) {
      return;
    }

    if (
      text.length >= 3 &&
      text.length <= 140
    ) {
      queries.push(text);
    }
  }

  /*
   * Jira summary
   */
  add(jira?.summary);

  /*
   * Every Acceptance Criterion.
   */
  for (
    const ac of extractAcceptanceCriteria(jira)
  ) {
    add(ac);
  }

  /*
   * Linked Jira requirements.
   */
  for (
    const issue of linkedIssues
  ) {
    if (issue?.loadError) {
      continue;
    }

    add(issue?.summary);

    for (
      const ac of issue?.acceptanceCriteria || []
    ) {
      add(ac);
    }
  }

  /*
   * Confluence titles and useful search text.
   */
  for (
    const page of domainContext
  ) {
    if (
      page?.resolved === false
    ) {
      continue;
    }

    add(page?.title);
  }

 
  for (
    const query of
      discoveryPlan?.qmetrySearchTerms || []
  ) {
    if (
      typeof query === "string"
    ) {
      add(query);
    } else {
      add(query?.term);
      add(query?.query);
    }
  }

  
  for (
    const term of
      discoveryPlan?.importantBusinessTerms || []
  ) {
    add(term);
  }

  /*
   * Deduplicate.
   */
  return [
    ...new Map(
      queries.map(query => [
        query.toLowerCase(),
        query
      ])
    ).values()
  ].slice(0, 12);
}

function cleanText(value) {

  return normalizeText(value)

    .replace(
      /<[^>]+>/g,
      " "
    )

    .replace(
      /https?:\/\/\S+/g,
      " "
    )

    .replace(
      /[`*_#>|]/g,
      " "
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}

function extractAcceptanceCriteria(jira) {

  const description =
    jira?.fields?.description ||
    jira?.description ||
    "";

  if (!description) {
    console.warn(
      "No Jira description found for AC extraction."
    );

    return [];
  }

  /*
   * Preserve line structure.
   *
   * Do NOT use cleanText() here because cleanText()
   * collapses newlines and AC extraction depends on
   * the Jira document structure.
   */
  const text =
    normalizeText(description)
      .replace(/<[^>]+>/g, " ")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[ `*_#>|]/g, " ")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ");

  /*
   * Locate the Acceptance Criteria section.
   *
   * This is structural rather than ticket-specific.
   */
  const acMatch =
    text.match(
      /(?:^|\n)\s*(?:#+\s*)?(?:\(?\d+(?:\.\d+)*\)?[\s.-]*)?\**\s*Acceptance\s+Criteria\s*:?\s*\**\s*\n([\s\S]*?)(?=\n\s*(?:#+\s*)?(?:\(?\d+(?:\.\d+)*\)?[\s.-]*)?\**\s*(?:References|Definition of Done|Exclusions|Privilege|Role based Privilege)\b|$)/i
    );

  if (!acMatch) {
    console.warn(
      "Acceptance Criteria section not found."
    );

    return [];
  }

  const acSection =
    acMatch[1].trim();

  if (!acSection) {
    return [];
  }

  /*
   * First try to identify structured AC subsections.
   *
   * Examples:
   *   2.1.1) ...
   *   2.1.2) ...
   *   AC1: ...
   *   AC2: ...
   *
   * This is generic and does not depend on the
   * business domain or ticket category.
   */
  const headingMatches = [
    ...acSection.matchAll(
      /(?:^|\n)\s*(?:#+\s*)?(?:\**\s*)?(?:(?:AC\s*)?\d+(?:\.\d+)+(?:\)?[.: -]+)|(?:AC\s*\d+\s*[:.-]+))([^\n]+)/gi
    )
  ];

  const criteria = [];

  if (headingMatches.length > 0) {

    for (
      let i = 0;
      i < headingMatches.length;
      i++
    ) {

      const match =
        headingMatches[i];

      const start =
        match.index +
        match[0].length;

      const end =
        i + 1 < headingMatches.length
          ? headingMatches[i + 1].index
          : acSection.length;

      const heading =
        cleanText(match[0]);

      const body =
        cleanText(
          acSection.slice(
            start,
            end
          )
        );

      const criterion =
        cleanText(
          `${heading} ${body}`
        );

      if (
        criterion &&
        !/^generic acceptance criteria/i.test(
          criterion
        )
      ) {

        criteria.push(
          criterion
        );
      }
    }
  }

  /*
   * If no structured AC headings exist,
   * fall back to individual non-empty lines.
   */
  if (!criteria.length) {

    const lines =
      acSection
        .split("\n")
        .map(line => cleanText(line))
        .filter(Boolean);

    for (const line of lines) {

      if (
        /^generic acceptance criteria/i.test(
          line
        )
      ) {
        continue;
      }

      criteria.push(line);
    }
  }

  return [
    ...new Set(criteria)
  ];
}


/**
 * ============================================================
 * IMPLEMENTATION TERM EXTRACTION
 * ============================================================
 *
 * The purpose of this step is NOT to search every sentence.
 *
 * We want terms that are useful for discovering the real
 * implementation names used by the codebase.
 *
 * Examples:
 *
 *   TASKING_FUNCTION
 *   taskingFunctionId
 *   manifestNumber
 *   POD_FLAG
 *   /api/tasking/functions
 *   deleteTaskingRecord
 *   Tasking Function
 *
 * If no useful implementation-looking term exists,
 * that is completely fine. QANEX should not invent one.
 */

function extractImplementationTerms(
  text
) {

  const terms =
    new Set();

  const cleaned =
    cleanText(
      text
    );

  if (!cleaned) {
    return [];
  }


  /*
   * Constants / database-style identifiers.
   *
   * Example:
   *
   * POD_FLAG
   * MANIFEST_NO
   * WHMF0001
   */

  const constantMatches =
    cleaned.match(
      /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
    ) || [];

  for (
    const match
    of constantMatches
  ) {

    terms.add(
      match
    );

  }


  /*
   * Identifier names commonly found in source code.
   *
   * Example:
   *
   * taskingFunctionId
   * manifestNumber
   * customerCode
   * podFlag
   */

  const identifierMatches =
    cleaned.match(
      /\b[A-Za-z][A-Za-z0-9]*(?:Id|ID|Code|Number|No|Flag|Status|Type|Name|Date|Value)\b/g
    ) || [];

  for (
    const match
    of identifierMatches
  ) {

    if (
      match.length >= 4 &&
      match.length <= 80
    ) {

      terms.add(
        match
      );

    }

  }


  /*
   * API / route-like strings.
   */

  const routeMatches =
    cleaned.match(
      /(?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_./:{}?=&-]+/g
    ) || [];

  for (
    const match
    of routeMatches
  ) {

    terms.add(
      match
    );

  }


  /*
   * Common implementation-oriented phrases.
   *
   * We deliberately keep this conservative.
   */

  const phraseMatches =
    cleaned.match(
      /\b[A-Za-z][A-Za-z0-9&/+.-]*(?:\s+[A-Za-z][A-Za-z0-9&/+.-]*){0,4}\s+(?:Function|Functions|Task|Tasking|Header|Detail|Details|Record|Records|Manifest|Flag|Status|Validation|Route|Routes|Reader|Writer|Service|Controller|Repository)\b/gi
    ) || [];

  for (
    const match
    of phraseMatches
  ) {

    const phrase =
      cleanText(
        match
      );

    if (
      phrase.length >= 4 &&
      phrase.length <= 100
    ) {

      terms.add(
        phrase
      );

    }

  }


  return [
    ...terms
  ];

}


/**
 * ============================================================
 * BUILD GITHUB SEARCH CONTEXT
 * ============================================================
 *
 * Priority:
 *
 * 1. Jira summary
 * 2. Jira AC / description
 * 3. Linked Jira issues
 * 4. Exact Confluence pages that were actually resolved
 *
 * We do NOT send entire Confluence pages directly to GitHub.
 */

function buildSearchContext(
  jira,
  linkedIssues,
  domainContext
) {

  const sources = [];


  /*
   * Main Jira issue.
   */

  if (
    jira?.summary
  ) {

    sources.push({

      source:
        "jira-summary",

      text:
        jira.summary

    });

  }


  if (
    jira?.acceptanceCriteria
  ) {

    sources.push({

      source:
        "jira-acceptance-criteria",

      text:
        jira.acceptanceCriteria

    });

  }


  if (
    jira?.description
  ) {

    sources.push({

      source:
        "jira-description",

      text:
        jira.description

    });

  }


  /*
   * Linked Jira issues.
   *
   * Ignore issues that could not be loaded.
   */

  for (
    const issue
    of linkedIssues || []
  ) {

    if (
      issue?.loadError
    ) {

      continue;

    }


    if (
      issue?.summary
    ) {

      sources.push({

        source:
          `linked-jira:${issue.ticketId}`,

        text:
          issue.summary

      });

    }


    if (
      issue?.acceptanceCriteria
    ) {

      sources.push({

        source:
          `linked-jira-ac:${issue.ticketId}`,

        text:
          issue.acceptanceCriteria

      });

    }


    if (
      issue?.description
    ) {

      sources.push({

        source:
          `linked-jira-description:${issue.ticketId}`,

        text:
          issue.description

      });

    }

  }


  /*
   * Only use Confluence pages that were successfully
   * resolved.
   *
   * Explicit pages have already been prioritized by
   * getSwmsDomainContext().
   */

  for (
    const page
    of domainContext || []
  ) {

    if (
      page?.resolved === false
    ) {

      continue;

    }


    if (
      page?.content
    ) {

      sources.push({

        source:
          page.exactMatch
            ? `confluence-exact:${page.sourceUrl || page.id || "unknown"}`
            : `confluence-search:${page.title || "unknown"}`,

        text:
          page.content

      });

    }

  }


  return sources;

}


/**
 * ============================================================
 * BUILD FOCUSED IMPLEMENTATION TERMS
 * ============================================================
 */

function buildDynamicSearchTerms(jiraIssue = {}) {
  const summary = cleanText(
    jiraIssue.summary ||
    jiraIssue.fields?.summary ||
    ""
  );

  const description = cleanText(
    jiraIssue.description ||
    jiraIssue.fields?.description ||
    ""
  );

  const acceptanceCriteria = Array.isArray(
    jiraIssue.acceptanceCriteria
  )
    ? jiraIssue.acceptanceCriteria
    : [];

  const acText = acceptanceCriteria
    .map(ac => {
      if (typeof ac === "string") return ac;

      return cleanText(
        ac?.text ||
        ac?.description ||
        ac?.value ||
        ac?.body ||
        ""
      );
    })
    .filter(Boolean);

  const fullText = [
    summary,
    description,
    ...acText
  ]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

  if (!fullText) {
    return [];
  }

  const terms = [];
  const seen = new Set();

  const add = (value, source = "dynamic") => {
    const term = cleanText(value)
      .replace(/^[\-\*\d\.\)\s]+/, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!term) return;

    const normalized = term.toLowerCase();

    if (
      normalized.length < 3 ||
      normalized.length > 180 ||
      seen.has(normalized)
    ) {
      return;
    }

    if (
      /^([a-z]+id|localid|pageid|spaceid|parentid|parenttype|authorid|ownerid)$/i.test(normalized) ||
      /\b(?:host type|content type|source type)\b/i.test(term) ||
      /\bswms-newui-pod\d+\b/i.test(term)
    ) {
      return;
    }

    seen.add(normalized);

    terms.push({
      term,
      source
    });
  };

  // ------------------------------------------------------------
  // 1. Whole meaningful phrases from summary
  // ------------------------------------------------------------

  if (summary) {
    add(summary, "jira-summary");

    const summaryParts = summary
      .split(/[:|\/\-–—]/)
      .map(x => x.trim())
      .filter(x => x.length >= 4);

    for (const part of summaryParts) {
      add(part, "jira-summary");
    }
  }

  // ------------------------------------------------------------
  // 2. Acceptance criteria as individual searchable concepts
  // ------------------------------------------------------------

  for (const ac of acText) {
    add(ac, "acceptance-criteria");

    // Remove common requirement language.
    const cleaned = ac
      .replace(
        /\b(given|when|then|and|user|system|should|shall|must|can|able to|need to|needs to|expected to)\b/gi,
        " "
      )
      .replace(/\s+/g, " ")
      .trim();

    add(cleaned, "acceptance-criteria");

    // Extract clauses separated by punctuation.
    const clauses = ac
      .split(/[.;,:]|\b(?:and then|then|and)\b/gi)
      .map(x => x.trim())
      .filter(x => x.length >= 4);

    for (const clause of clauses) {
      add(clause, "ac-clause");
    }
  }

  // ------------------------------------------------------------
  // 3. Keep the strongest terms.
  // Prefer:
  // summary → AC → clauses → identifiers → semantic phrases
  // ------------------------------------------------------------

  const priority = {
    "jira-summary": 100,
    "acceptance-criteria": 95,
    "ac-clause": 90,
    "dynamic": 60
  };

  return terms
    .sort(
      (a, b) =>
        (priority[b.source] || 0) -
        (priority[a.source] || 0)
    )
    .slice(0, 30);
}

function buildQMetrySearchQueries(jiraIssue = {}) {
  const terms = buildDynamicSearchTerms(jiraIssue);

  const queries = [];
  const seen = new Set();

  for (const item of terms) {
    const query = cleanText(item.term);

    if (!query) continue;

    const normalized = query.toLowerCase();

    if (seen.has(normalized)) continue;

    seen.add(normalized);
    queries.push(query);

    if (queries.length >= 20) {
      break;
    }
  }

  return queries;
}

function extractJiraTicketId(jiraUrl) {
  const value = String(jiraUrl || "").trim();

  if (!value) {
    throw new Error("Jira ticket URL is required.");
  }

  // Accept direct Jira key as well
  if (/^[A-Z][A-Z0-9]+-\d+$/i.test(value)) {
    return value.toUpperCase();
  }

  try {
    const url = new URL(value);

    const match =
      url.pathname.match(
        /\/browse\/([A-Z][A-Z0-9]+-\d+)/i
      );

    if (!match) {
      throw new Error(
        "Could not find a Jira ticket ID in the provided URL."
      );
    }

    return match[1].toUpperCase();

  } catch (error) {

    if (
      error.message.includes(
        "Could not find"
      )
    ) {
      throw error;
    }

    throw new Error(
      "Invalid Jira URL. Example: https://syscobt.atlassian.net/browse/SMOD-22514"
    );
  }
}

function summarizeCriterionForTitle(criterion) {
  const cleaned =
    cleanText(criterion)
      .replace(/^(?:ac\s*\d+[.:\-]?|\d+(?:\.\d+)+[)\].:\-]?)\s*/i, "")
      .replace(/\b(?:given|when|then|and|should|shall|must|can|able to|user|system)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

  if (!cleaned) {
    return "expected SWMS behavior";
  }

  return cleaned
    .split(" ")
    .filter(Boolean)
    .slice(0, 10)
    .join(" ");
}

function inferCriterionIntent(text) {
  const value = String(text || "").toLowerCase();

  if (/\b(delete|remove|void|cancel)\b/.test(value)) {
    return "delete";
  }

  if (/\b(update|edit|modify|change|revise)\b/.test(value)) {
    return "update";
  }

  if (/\b(create|add|new|setup|set up|configure|save)\b/.test(value)) {
    return "create";
  }

  if (/\b(search|filter|find|lookup|list|view)\b/.test(value)) {
    return "search";
  }

  if (/\b(validate|validation|required|mandatory|invalid|error|warning)\b/.test(value)) {
    return "validation";
  }

  return "functional";
}

function extractSqlStatements(value, limit = 4) {
  const text = normalizeText(value);

  if (!text) {
    return [];
  }

  const matches =
    text.match(/\b(?:select|insert|update|delete)\b[\s\S]{0,700}?;/gi) || [];

  return [
    ...new Set(
      matches
        .map(item => item.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    )
  ].slice(0, limit);
}

function buildDeterministicSqlEvidence({
  qmetryCases,
  githubImplementationEvidence,
  linkedIssues,
  domainContext
}) {
  const extracted = [
    ...extractSqlStatements(qmetryCases, 6),
    ...extractSqlStatements(githubImplementationEvidence, 6),
    ...extractSqlStatements(linkedIssues, 3),
    ...extractSqlStatements(domainContext, 3)
  ];

  return [
    ...new Set(extracted)
  ].slice(0, 6);
}

function splitCriterionClauses(criterion) {
  const text = cleanText(criterion);

  if (!text) {
    return [];
  }

  return text
    .split(/(?:\.|;|:|\bthen\b|\band\b)/gi)
    .map(item => cleanText(item))
    .filter(item => item.length >= 8)
    .slice(0, 4);
}

function buildAcDrivenSteps({
  criterion,
  summary
}) {
  const clauses =
    splitCriterionClauses(criterion);

  const navigationHint =
    summarizeCriterionForTitle(
      clauses[0] || summary
    );

  const steps = [
    {
      step: 1,
      action: "Login to SWMS NewUI",
      expectedResult: "User is authenticated and the landing page is displayed."
    },
    {
      step: 2,
      action: `Go to Menu -> ${navigationHint}.`,
      expectedResult: `${navigationHint} screen or workflow context is opened.`
    }
  ];

  clauses.forEach((clause) => {
  const normalizedClause =
    clause
      .replace(/^\s*(given|when|then|and)\s+/i, "")
      .trim();

  let action =
    `Perform action for: ${normalizedClause}.`;

  let expected =
    `Expected behavior is shown for: ${normalizedClause}.`;

  if (/\bsearch\b|\bfilter\b|\bf9\b/i.test(normalizedClause)) {
    action =
      "Enter Tasking Function search criteria and click Search or press F9.";

    expected =
      "Header partition shows records matching the search criteria.";

  } else if (/\bwildcard\b|%/.test(normalizedClause)) {
    action =
      "Enter a wildcard value using % in Tasking Function search and click Search.";

    expected =
      "Header partition shows records matching the wildcard pattern.";

  } else if (/\bcreate\b|\bnew row\b|\b\+\b/i.test(normalizedClause)) {
    action =
      "Click Create or + to add a new Header row and enter required details.";

    expected =
      "A new Header row is added and accepts entered details.";

  } else if (/\bsave\b|\bf7\b/i.test(normalizedClause)) {
    action =
      "Click Save or press F7 to save entered details.";

    expected =
      "Record is saved and success message is displayed as per AC.";

  } else if (/\brefresh\b/i.test(normalizedClause)) {
    action =
      "Click Refresh and respond to the save confirmation based on entered data state.";

    expected =
      "Refresh behavior follows AC-defined Yes/No/Cancel outcomes.";

  } else if (/\bdelete\b/i.test(normalizedClause)) {
    action =
      "Select the target Header record and click Delete, then confirm deletion.";

    expected =
      "Selected record is deleted according to confirmation behavior.";

  } else if (/\bsorted\b|\balphabetical\b/i.test(normalizedClause)) {
    action =
      "Observe Header list order after load or search.";

    expected =
      "Header list is sorted alphabetically by Tasking Function name.";
  }

  steps.push({
    step: steps.length + 1,
    action,
    expectedResult: expected
  });
});

  if (clauses.length === 0) {
    const fallback =
      summarizeCriterionForTitle(criterion);

    steps.push({
      step: 3,
      action: `Execute AC behavior: ${fallback}.`,
      expectedResult: `The system behavior matches AC intent: ${fallback}.`
    });
  }

  return steps;
}

function buildAcDrivenPreconditions({
  criterion,
  sqlEvidence = []
}) {
  const shortAc =
    summarizeCriterionForTitle(criterion);

  return [
    {
      step: 1,
      description: `Required state for AC is already true: ${shortAc}.`
    },
    ...(
      sqlEvidence.length > 0
        ? [
            {
              step: 2,
              description: `Confirm baseline records using SQL: ${sqlEvidence[0]}`
            }
          ]
        : []
    )
  ];
}

function buildAcDrivenTestData({
  criterion,
  implementationTerms
}) {
  return [
    {
      step: 1,
      value: "Username: <valid_username> / Password: <valid_password>"
    }
  ];
}

/**
 * ============================================================
 * GENERATE BASE TEST CASES
 * ============================================================
 *
 * Jira Acceptance Criteria is the primary source.
 *
 * QMetry, Confluence, linked Jira and GitHub are
 * supporting evidence sources.
 *
 * IMPORTANT:
 * This generator deliberately does not invent
 * implementation-specific values that were not found
 * in the supplied evidence.
 */
function generateTestCasesFromContext({
  jira,
  linkedIssues = [],
  domainContext = [],
  githubImplementationEvidence = {},
  qmetryCases = [],
  scope = "full",
  titleTags = "",
}) {
  const acceptanceCriteria =
    extractAcceptanceCriteria(jira);

  if (!acceptanceCriteria.length) {
    return [];
  }

  /*
   * Partial scope support.
   *
   * If a scenario was supplied, keep only ACs
   * that appear relevant to that scenario.
   */
  let selectedCriteria =
    acceptanceCriteria;

  if (
    scope &&
    scope !== "full" &&
    typeof scope === "string"
  ) {
    const scopeText =
      cleanText(scope).toLowerCase();

    const scoped =
      acceptanceCriteria.filter(
        (ac) =>
          ac
            .toLowerCase()
            .includes(scopeText) ||
          scopeText
            .split(/\s+/)
            .some(
              (word) =>
                word.length > 3 &&
                ac
                  .toLowerCase()
                  .includes(word)
            )
      );

    if (scoped.length) {
      selectedCriteria = scoped;
    }
  }

  const ticketId =
    jira?.ticketId ||
    jira?.key ||
    jira?.fields?.key ||
    "QANEX";

  const summary =
    cleanText(
      jira?.summary ||
      jira?.fields?.summary ||
      "SWMS Feature"
    );

  /*
   * Collect implementation names discovered
   * through GitHub.
   *
   * These are only used when they are actually
   * present in the evidence.
   */
  const githubText =
    cleanText(
      JSON.stringify(
        githubImplementationEvidence
      )
    );

  const implementationTerms =
    extractImplementationTerms(
      githubText
    ).slice(0, 8);

  const sqlEvidence =
    buildDeterministicSqlEvidence({
      qmetryCases,
      githubImplementationEvidence,
      linkedIssues,
      domainContext
    });

  /*
   * Build one primary test case per distinct AC.
   *
   * This is intentionally conservative:
   * no fake usernames, passwords, database values,
   * table names or exact error messages are invented.
   */
  const titlePrefix =
    normalizeTitleTags(titleTags);

  return selectedCriteria
    .map((criterion, index) => {

      const ac =
        cleanText(criterion);

      if (!ac) {
        return null;
      }

      const intent =
        inferCriterionIntent(ac);

      const shortTitle =
        summarizeCriterionForTitle(ac);

      let type = "Functional";

      if (intent === "create") {
        type = "CRUD";

      } else if (intent === "update") {
        type = "CRUD";

      } else if (intent === "delete") {
        type = "CRUD";

      } else if (intent === "validation") {
        type = "Validation";
      }

      const testCaseNumber =
        String(index + 1).padStart(
          3,
          "0"
        );

      return {
        testCaseId:
          `${ticketId}-TC-${testCaseNumber}`,

        title:
          `${titlePrefix}Verify ${shortTitle}`.trim(),

        preconditions:
          buildAcDrivenPreconditions({
            criterion: ac,
            sqlEvidence
          }),

        steps:
          buildAcDrivenSteps({
            criterion: ac,
            summary
          }),

        testData:
          buildAcDrivenTestData({
            criterion: ac,
            implementationTerms
          }),

        expectedResult: "",

        priority: "High",

        type,

        requirementCoverage: [
          ac
        ],

        databaseValidation:
          (
            intent === "create" ||
            intent === "update" ||
            intent === "delete"
          ) && sqlEvidence.length > 0,

        sqlQueries:
          (
            intent === "create" ||
            intent === "update" ||
            intent === "delete"
          )
            ? (
              sqlEvidence.length
                ? sqlEvidence.slice(0, 2).map((query, sqlIndex) => ({
                    purpose:
                      sqlIndex === 0
                        ? "Verify the target record state in database"
                        : "Verify related data consistency after business action",
                    table: "",
                    query
                  }))
                : []
            )
            : [],

        sourceAcceptanceCriteria:
          ac,

        evidence: {
          qmetryMatches:
            qmetryCases.length,

          confluenceSources:
            domainContext.length,

          linkedJiraIssues:
            linkedIssues.length,

          githubQueries:
            githubImplementationEvidence
              ?.queries
              ?.length || 0,
        },
      };
    })
    .filter(Boolean);
}


async function selectRelevantQMetryEvidence({
  jira,
  qmetryDetails,
  qmetryCases,
  llmQMetryEvidence,
  discoveryPlan
}) {

  const allCases = [
    ...(
      Array.isArray(qmetryCases)
        ? qmetryCases
        : []
    ),

    ...(
      Array.isArray(llmQMetryEvidence)
        ? llmQMetryEvidence
        : []
    ),

    ...(
      Array.isArray(qmetryDetails)
        ? qmetryDetails
        : []
    )
  ];

  const seen = new Set();
  const unique = [];

  for (
    const item of allCases
  ) {

    const ids =
      extractQMetryCaseIds(
        item
      );

    for (
      const id of ids
    ) {

      if (
        seen.has(id)
      ) {
        continue;
      }

      seen.add(id);

      const detail =
        qmetryDetails.find(
          x =>
            String(
              x?.testCaseId
            ).toLowerCase() ===
            String(id).toLowerCase()
        );

      unique.push({
        testCaseId: id,
        searchEvidence: item,
        details:
          detail?.details || null,
        requirements:
          detail?.requirements || null
      });
    }
  }

  return {
    candidateCount:
      unique.length,

    candidates:
      unique,

    selectionInstruction: `
Review every QMetry candidate.

For each candidate classify it as exactly one of:

DIRECT_MATCH
PARTIAL_MATCH
RELATED
DUPLICATE
IRRELEVANT

DIRECT_MATCH:
The existing test validates substantially the same
acceptance-criterion behavior.

PARTIAL_MATCH:
Some behavior matches, but the current Jira AC requires
additional conditions, state, data or expected behavior.

RELATED:
The test concerns the same feature/domain but validates
different behavior.

DUPLICATE:
The test already covers the same testing intent and should
normally not be regenerated.

IRRELEVANT:
The test does not contribute meaningful coverage to the
current Jira acceptance criteria.

Do not determine relevance from the test-case ID alone.

Use:
- Jira AC
- QMetry test content
- QMetry requirements
- Confluence evidence
- implementation evidence
- current business rules

to determine relevance.
`
  };
}

async function generateValidateRepair({
  testCases,
  jira,
  linkedIssues,
  confluence,
  github,
  qmetry,
  evidence,
  titleTags = ""
}) {

  let currentTestCases =
  Array.isArray(testCases)
    ? testCases
    : [];

  let validation =
    validateTestCases(
      currentTestCases,
      evidence
    );

  console.log(
    "[QANEX] Initial validation:",
    JSON.stringify(
      validation,
      null,
      2
    )
  );

  /*
   * Only repair the already-generated test cases.
   *
   * Do NOT generate a completely new set here.
   */
  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {

    if (validation.valid) {
      break;
    }

    console.log(
      `[QANEX] Repair attempt ${attempt}`
    );

    const repairPrompt = `
You are repairing existing QANEX test cases.

DO NOT regenerate the entire test suite from scratch.

Preserve all valid existing coverage.

CURRENT TEST CASES:

${JSON.stringify(
  currentTestCases,
  null,
  2
)}

VALIDATION FINDINGS:

${JSON.stringify(
  validation.findings,
  null,
  2
)}

VERIFIED EVIDENCE:

${JSON.stringify(
  evidence,
  null,
  2
)}

Repair only the problems identified by validation.

Rules:

1. Repair the supplied test cases; do not regenerate the suite from scratch.
2. Preserve every valid existing test case.
3. Preserve every distinct acceptance-criterion testing intent.
4. Never remove a valid test case merely because another test looks similar.
5. Never reduce the number of test cases unless a test is proven to be a duplicate.
6. If a test case is valid, return it unchanged.
7. Fix only the findings reported by validation.
8. Every executable step must contain:
   - a concrete action
   - a concrete expected result
9. Never use placeholder actions such as:
   - "perform action"
   - "perform action for..."
   - "execute action"
   - "action for..."
10. Never use placeholder expected results such as:
   - "expected behavior"
   - "expected outcome"
   - "expected behavior is shown for..."
11. Do not invent technical names.
12. Do not invent UI names.
13. Do not invent APIs.
14. Do not invent database tables.
15. Do not invent database columns.
16. Do not invent SQL.
17. Use GitHub only when the supplied GitHub evidence supports the technical name.
18. Use QMetry only as existing-coverage evidence.
19. Do not copy an existing QMetry test blindly.
20. If an existing QMetry test is a DIRECT_MATCH or DUPLICATE, do not regenerate that testing intent.
21. If QMetry coverage is PARTIAL_MATCH, retain the missing conditions required by the current Jira AC.
22. Keep test-case IDs stable whenever possible.
23. SQL must appear in Test Data when database validation is required.
24. SQL execution must be an explicit executable step.
25. Do not remove valid SQL during repair.

Return ONLY:

{
  "testCases": [...]
}
`;

    let repaired = null;

    try {
      repaired =
        await generateTestCasesWithGemini({
          jira,
          linkedIssues,
          confluence,
          github,
          qmetry,
          evidence: {
            ...evidence,

            previousTestCases:
              currentTestCases,

            repairFindings:
              validation.findings,

            repairInstructions:
              repairPrompt
          }
        });
    } catch (error) {
      console.warn(
        `[QANEX] LLM repair attempt ${attempt} failed: ${error.message}`
      );
    }

    if (
  repaired &&
  Array.isArray(
    repaired.testCases
  ) &&
  repaired.testCases.length > 0
) {




  /*
   * Never silently replace a larger valid suite
   * with a smaller repaired suite.
   *
   * The repair model is fixing defects, not
   * deciding to remove coverage.
   */
  const repairedCases = repaired.testCases;

  if (
    repairedCases.length >=
    currentTestCases.length
  ) {

    currentTestCases =
      repairedCases;

  } else {

    console.warn(
      `[QANEX] Rejected repair because it reduced test-case count from ${currentTestCases.length} to ${repairedCases.length}.`
    );

  }

}

    validation =
      validateTestCases(
        currentTestCases,
        evidence
      );

    console.log(
      `[QANEX] Validation after attempt ${attempt}:`,
      JSON.stringify(
        validation,
        null,
        2
      )
    );
  }

  return {
    testCases:
      currentTestCases,

    validation
  };
}
/**
 * ============================================================
 * RUN QANEX
 * ============================================================
 */

export async function runQanex({

  jiraUrl,

  repository,

  scope =
    "full",

  scenario =
    "",

  titleTags =
    "",

  includeDebug =
    false

}) {


  /*
   * ==========================================================
   * VALIDATION
   * ==========================================================
   */

  if (!jiraUrl) {

    throw new Error(
      "Jira ticket URL is required."
    );

  }


  if (!repository) {

    throw new Error(
      "GitHub repository is required."
    );

  }

  const ticketId =
  extractJiraTicketId(jiraUrl);


  console.log(
    `\n========== QANEX STARTED: ${ticketId} ==========`
  );

  console.log(
    "\n[STEP 0] Loading SWMS domain context..."
  );

  let qmetryDomainContext = null;

  try {
    qmetryDomainContext =
      await getQMetryDomainContext();

    console.log(
      "SWMS domain context loaded."
    );
  } catch (error) {
    console.warn(
      `SWMS domain context could not be loaded: ${error.message}`
    );
  }


  /*
   * ==========================================================
   * STEP 1
   * Load the requested Jira ticket.
   * ==========================================================
   */

  console.log(
    "\n[STEP 1] Loading Jira ticket..."
  );

  const jira =
  await getJiraIssue(
    ticketId
  );


  console.log(
    `Jira ticket loaded: ${ticketId}`
  );


  /*
   * ==========================================================
   * STEP 2
   * Load linked Jira issues.
   *
   * These provide additional requirements, bugs,
   * implementation information, and related context.
   * ==========================================================
   */

  console.log(
    "\n[STEP 2] Loading linked Jira issues..."
  );

  const linkedIssues =
    await getLinkedJiraIssues(
      jira.linkedIssues
    );


  console.log(
    `Linked Jira issues loaded: ${linkedIssues.length}`
  );


  /*
   * ==========================================================
   * STEP 3
   * Load SWMS / Confluence domain context.
   *
   * IMPORTANT:
   *
   * getSwmsDomainContext() handles the priority:
   *
   * 1. Exact Confluence references from Jira / linked Jira
   * 2. Resolve those exact pages
   * 3. Fallback Confluence search only when no explicit
   *    Confluence references exist
   *
   * Therefore we do not duplicate that logic here.
   * ==========================================================
   */

  console.log(
    "\n[STEP 3] Loading SWMS / Confluence domain context..."
  );

  const domainContext =
    await getSwmsDomainContext(
      jira,
      linkedIssues
    );


  console.log(
    `SWMS domain context loaded: ${domainContext.length} source(s)`
  );


  /*
 * ==========================================================
 * STEP 4
 * SEMANTIC ACCEPTANCE-CRITERIA SEARCH PLANNING
 * ==========================================================
 */

console.log(
  "\n[STEP 4] Building semantic evidence search plan with SAGE..."
);

let semanticSearchPlan = {
  acceptanceCriteria: []
};

try {

  semanticSearchPlan =
  await planSemanticSearches({
    jira,
    linkedIssues,
    confluence: domainContext,
    qmetry: qmetryDomainContext
  });

  if (
  !semanticSearchPlan ||
  !Array.isArray(
    semanticSearchPlan.acceptanceCriteria
  )
) {

  console.warn(
    "[QANEX] SAGE semantic plan was invalid."
  );

  console.warn(
    "[QANEX] Falling back to deterministic AC-derived GitHub terms."
  );

  semanticSearchPlan = {
    acceptanceCriteria: []
  };

}

  console.log(
    "\n[QANEX] Semantic search plan:"
  );

  console.log(
    JSON.stringify(
      semanticSearchPlan,
      null,
      2
    )
  );

} catch (error) {

  console.warn(
    "Semantic search planning failed:",
    error.message
  );

}

  /*
   * ==========================================================
   * STEP 4
   * Build implementation-focused GitHub search terms.
   *
   * GitHub is NOT being used to understand the entire
   * business requirement.
   *
   * It is being used to discover the terminology actually
   * used in the implementation.
   *
   * This helps QANEX later produce accurate:
   *
   * - table names
   * - column names
   * - constants
   * - field names
   * - API routes
   * - service names
   * - validation names
   * - other implementation terminology
   * ==========================================================
   */

  console.log(
  "\n[STEP 4] Building dynamic GitHub implementation search terms..."
);

const semanticGithubTerms =
  (semanticSearchPlan?.acceptanceCriteria || [])
    .flatMap(ac =>
      Array.isArray(ac?.githubQueries)
        ? ac.githubQueries
        : []
    );

const dynamicSearchTerms =
  buildDynamicSearchTerms(jira);

const focusedSearchTerms =
  [
    ...semanticGithubTerms,
    ...dynamicSearchTerms.map(item => item.term)
  ]
    .filter(Boolean)
    .filter(
      (term, index, array) =>
        array.indexOf(term) === index
    )
    .slice(0, 12);

const githubSearchTerms = focusedSearchTerms;

console.log(
  `Generated ${githubSearchTerms.length} dynamic GitHub term(s)`
);

githubSearchTerms.forEach(term => {
  console.log(` - ${term}`);
});


  /*
   * ==========================================================
   * STEP 5
   * Search the repository for implementation evidence.
   *
   * searchGitHubImplementation() performs repository-scoped
   * searches and returns the query + evidence together.
   * ==========================================================
   */

  console.log(
    "\n[STEP 5] Searching GitHub implementation..."
  );


  let githubImplementationEvidence;

  try {

    githubImplementationEvidence =
      await searchGitHubImplementation(

        jira,

        linkedIssues,

        domainContext,

        repository,

        {
          maxQueries:
            12
        }

      );

  } catch (error) {

    console.warn(
      `GitHub implementation search failed: ${error.message}`
    );

    githubImplementationEvidence = {

      queries:
        focusedSearchTerms,

      evidence: [],

      error:
        error.message

    };

  }


  /*
   * ==========================================================
   * STEP 6
   * Search commits as supporting evidence.
   *
   * We use only the highest-value implementation terms.
   *
   * Commits are NOT treated as the source of truth for
   * current implementation names.
   * ==========================================================
   */

  console.log(
    "\n[STEP 6] Searching GitHub commits..."
  );


  const commitEvidence = [];

/*
 * Commit searches are supporting evidence only.
 *
 * focusedSearchTerms contains strings because Step 4
 * intentionally normalizes GitHub search terms into strings.
 *
 * Normalize them here before accessing .term.
 */

const commitSearchTerms =
  focusedSearchTerms
    .map(item => {
      if (typeof item === "string") {
        return {
          term: item.trim(),
          source: "semantic-discovery"
        };
      }

      return {
        term:
          String(
            item?.term || ""
          ).trim(),

        source:
          item?.source ||
          "semantic-discovery"
      };
    })
    .filter(
      item =>
        item.term.length > 0
    )
    .filter(
      (item, index, array) =>
        array.findIndex(
          other =>
            other.term.toLowerCase() ===
            item.term.toLowerCase()
        ) === index
    )
    .slice(0, 5);

for (
  const item
  of commitSearchTerms
) {

  try {

    console.log(
      `Searching GitHub commits: ${item.term}`
    );

    const result =
      await searchGitHubCommits(
        `"${item.term}"`,
        repository
      );

    commitEvidence.push({

      term:
        item.term,

      source:
        item.source,

      result

    });

  } catch (error) {

    console.warn(
      `GitHub commit search failed for "${item.term}": ${error.message}`
    );

    commitEvidence.push({

      term:
        item.term,

      source:
        item.source,

      result:
        null,

      error:
        error.message

    });

  }

}

  console.log(
  "\n[STEP 7] Loading QMetry domain context..."
);

if (!qmetryDomainContext) {
  try {
    qmetryDomainContext =
      await getQMetryDomainContext();
  } catch (error) {
    console.warn(
      `QMetry domain context unavailable: ${error.message}`
    );

    qmetryDomainContext = null;
  }
}

console.log(
  "QMetry domain context loaded."
);

console.log(
  "\n[STEP 8] Searching QMetry for all dynamically relevant coverage..."
);

const initialQMetryQueries =
  buildDynamicQMetryQueries({
    jira,
    linkedIssues,
    domainContext,
  });

console.log(
  `Generated ${initialQMetryQueries.length} QMetry search queries.`
);

const qmetryCases = [];

for (
  const query of initialQMetryQueries
) {
  try {
    console.log(
      `QMetry search: ${query}`
    );

    const result =
      await searchQMetryCases(
        query
      );

    qmetryCases.push({
      query,
      result
    });
  } catch (error) {
    console.warn(
      `QMetry search failed for "${query}": ${error.message}`
    );
  }
}

/*
 * ==========================================================
 * STEP 9
 * LLM EVIDENCE DISCOVERY
 * ==========================================================
 */

console.log(
  "\n[STEP 9] Asking SAGE what implementation evidence is needed..."
);

let discoveryPlan = {
  databaseValidationLikely: false,
  githubSearchTerms: [],
  qmetrySearchTerms: [],
  confluenceSearchTerms: [],
  expectedEvidence: [],
  risks: []
};

try {
  discoveryPlan =
    await planEvidenceDiscovery({
      jira,
      linkedIssues,
      confluence: domainContext,
      qmetry: qmetryCases
    });

  console.log(
    "LLM evidence plan:"
  );

  console.log(
    JSON.stringify(
      discoveryPlan,
      null,
      2
    )
  );

} catch (error) {
  console.warn(
    "LLM evidence discovery failed:",
    error?.message || error
  );

  // Never allow optional LLM discovery to remove
  // the deterministic Jira/AC-derived search terms.
  console.log(
    "[QANEX] Continuing with deterministic AC-derived search terms."
  );
}

/*
 * ==========================================================
 * STEP 10
 * LLM-DIRECTED GITHUB EVIDENCE
 * ==========================================================
 */

console.log(
  "\n[STEP 10] Searching GitHub for LLM-requested evidence..."
);

const llmGitHubEvidence = [];

const llmGitHubTerms =
  Array.isArray(discoveryPlan?.githubSearchTerms)
    ? discoveryPlan.githubSearchTerms
    : [];

// Search terms generated from the actual Acceptance Criteria.
// The LLM is responsible for deriving semantic/business concepts.
// Do NOT add hardcoded domain-specific terms here.
const uniqueGitHubTerms = [
  ...new Map(
    llmGitHubTerms
      .map(item => {
        if (typeof item === "string") {
          return {
            term: item.trim(),
            category: "general",
            reason: "AC-derived semantic search term"
          };
        }

        return {
          term: String(item?.term || "").trim(),
          category: item?.category || "general",
          reason:
            item?.reason ||
            "AC-derived semantic search term",
          acId:
            item?.acId || null
        };
      })
      .filter(item => item.term)
      .map(item => [
        item.term.toLowerCase(),
        item
      ])
  ).values()
];

console.log(
  `Generated ${uniqueGitHubTerms.length} semantic GitHub evidence term(s).`
);

const boundedGitHubTerms =
  uniqueGitHubTerms.slice(
    0,
    12
  );

console.log(
  `Using ${boundedGitHubTerms.length} bounded semantic GitHub evidence term(s).`
);

for (const item of boundedGitHubTerms) {

  try {

    console.log(
      `GitHub evidence: ${item.term}`
    );

    const result =
      await searchGitHub(
        item.term,
        repository
      );

    llmGitHubEvidence.push({
      term: item.term,
      category: item.category,
      reason: item.reason,
      acId: item.acId || null,
      result
    });

  } catch (error) {

    console.warn(
      `GitHub evidence search failed for "${item.term}": ${error.message}`
    );

  }
}

console.log(
  "\n[STEP 10.5] Searching additional Confluence evidence..."
);

const additionalConfluenceEvidence = [];

const shouldExpandConfluence =
  (domainContext || []).length === 0;

if (!shouldExpandConfluence) {
  console.log(
    "Skipping broad Confluence expansion because sufficient explicit Confluence context is already loaded."
  );
}

const filteredConfluenceQueries =
  (discoveryPlan?.confluenceSearchTerms || [])
    .map(item =>
      typeof item === "string"
        ? item
        : item?.term || item?.query
    )
    .filter(Boolean)
    .filter(query => {
      const value = String(query).toLowerCase();

      if (
        value.includes("guidelines") ||
        value.includes("comparison") ||
        value.includes("generated test") ||
        value.includes("goals") ||
        value.includes("backlog")
      ) {
        return false;
      }

      return true;
    })
    .slice(0, 2);

for (const query of shouldExpandConfluence ? filteredConfluenceQueries : []) {

  if (!query) {
    continue;
  }

  try {
    const pages =
      await getConfluencePages(
        query
      );

    additionalConfluenceEvidence.push({
      query,
      pages
    });

  } catch (error) {
    console.warn(
      `Confluence search failed for "${query}": ${error.message}`
    );
  }
}


/*
 * ==========================================================
 * STEP 11
 * LLM-DIRECTED QMETRY EVIDENCE
 * ==========================================================
 */

console.log(
  "\n[STEP 11] Performing LLM-directed QMetry discovery..."
);

const llmQMetryEvidence = [];

const sageQMetryTerms =
  Array.isArray(
    discoveryPlan?.qmetrySearchTerms
  )
    ? discoveryPlan.qmetrySearchTerms
        .map(item =>
          typeof item === "string"
            ? item.trim()
            : String(
                item?.term ||
                item?.query ||
                ""
              ).trim()
        )
        .filter(Boolean)
    : [];


const deterministicQMetryTerms =
  buildDynamicQMetryQueries({
    jira,
    linkedIssues,
    domainContext,
    discoveryPlan
  });


const directedQMetryQueries =
  [
    ...sageQMetryTerms,
    ...deterministicQMetryTerms
  ]
    .filter(Boolean)
    .filter(
      (query, index, array) =>
        array.findIndex(
          other =>
            other.toLowerCase() ===
            query.toLowerCase()
        ) === index
    )
    .slice(
      0,
      15
    );


console.log(
  `Generated ${directedQMetryQueries.length} QMetry search queries.`
);

for (
  const query of directedQMetryQueries
) {
  try {
    console.log(
      `QMetry directed search: ${query}`
    );

    const result =
      await searchQMetryCases(
        query
      );

    llmQMetryEvidence.push({
      query,
      result
    });
  } catch (error) {
    console.warn(
      `QMetry directed search failed for "${query}": ${error.message}`
    );
  }
}

/*
 * ==========================================================
 * STEP 12
 * LOAD RELEVANT QMETRY DETAILS
 * ==========================================================
 */

console.log(
  "\n[STEP 12] Loading relevant QMetry test-case details..."
);

const qmetryDetails = [];

const qmetryIds =
  extractQMetryCaseIds([
    qmetryCases,
    llmQMetryEvidence
  ]);

console.log(
  "[QANEX] QMetry ID extraction input:"
);

console.log(
  JSON.stringify(
    {
      initialResults:
        qmetryCases,

      directedResults:
        llmQMetryEvidence
    },
    null,
    2
  )
);

console.log(
  `Matched ${qmetryIds.length} unique QMetry test case(s).`
);

for (
  const id of qmetryIds
) {

  try {

    const details =
      await getQMetryCaseDetails(
        id
      );

    let requirements = null;

    try {

      requirements =
        await getQMetryCaseRequirements(
          id
        );

    } catch (error) {

      console.warn(
        `QMetry requirements unavailable for ${id}: ${error.message}`
      );

    }

    qmetryDetails.push({

      testCaseId:
        id,

      details,

      requirements

    });

  } catch (error) {

    console.warn(
      `QMetry details unavailable for ${id}: ${error.message}`
    );

  }
}

console.log(
  "\n[STEP 12.25] Preparing QMetry relevance evidence..."
);

const qmetryRelevanceEvidence =
  await selectRelevantQMetryEvidence({
    jira,
    qmetryDetails,
    qmetryCases,
    llmQMetryEvidence,
    discoveryPlan
  });

console.log(
  `QMetry candidates prepared: ${
    qmetryRelevanceEvidence.candidateCount
  }`
);

console.log(
  "\n[STEP 12.5] Reading matched GitHub source files..."
);

const githubFileEvidence = [];

const githubSearchResults = [
  githubImplementationEvidence,
  llmGitHubEvidence
];

const githubPaths = new Set();

for (
  const result of githubSearchResults
) {
  const paths =
    extractGitHubFilePaths(
      result
    );

  for (
    const path of paths
  ) {
    githubPaths.add(path);
  }
}

console.log(
  `Discovered ${githubPaths.size} source file(s).`
);
if (githubPaths.size === 0) {

  console.warn(
    "\n[WARNING] GitHub searches returned no extractable source paths."
  );

  console.warn(
    `[WARNING] Queries attempted: ${githubImplementationEvidence?.queries?.length || 0}; LLM-directed queries: ${llmGitHubEvidence.length}`
  );
}
for (
  const path of githubPaths
) {
  try {
    const content =
      await getGitHubFileContents(
        repository,
        path
      );

    githubFileEvidence.push({
      path,
      content
    });

  } catch (error) {
    console.warn(
      `Unable to read GitHub file ${path}: ${error.message}`
    );
  }
}

/*
 * ==========================================================
 * STEP 13
 * BUILD STRUCTURED EVIDENCE MAP
 * ==========================================================
 */

console.log(
  "\n[STEP 13] Building structured evidence map with SAGE..."
);

let evidenceMap = {};

try {

  evidenceMap =
    await analyzeEvidence({

      jira,

      linkedIssues,

      confluence:
        domainContext,
        additionalConfluenceEvidence,

      github: {
  repository,

  implementationSearch:
    githubImplementationEvidence,

  llmDirectedSearch:
    llmGitHubEvidence,

  sourceFiles:
    githubFileEvidence,

  commits:
    commitEvidence
},


    });

  console.log(
    "\n========== QANEX EVIDENCE MAP =========="
  );

  console.log(
    JSON.stringify(
      evidenceMap,
      null,
      2
    )
  );

} catch (error) {

  console.warn(
    "Evidence analysis failed:",
    error.message
  );

}

console.log(
  "\n========== DATABASE EVIDENCE =========="
);

console.log(
  JSON.stringify(
    {
      database:
        evidenceMap?.database || {},
      sql:
        evidenceMap?.sql || {}
    },
    null,
    2
  )
);

  /*
   * ==========================================================
   * STEP 14
   * PREPARE QANEX EVIDENCE FOR SAGE
   * ==========================================================
   */

  console.log(
    "\n[STEP 14] Preparing QANEX evidence for SAGE..."
);

/*
 * ==========================================================
 * STEP 15
 * GENERATE ADVANCED TEST CASES
 * ==========================================================
 */

console.log(
  "\n[STEP 15] Generating advanced test cases with SAGE..."
);

const llmContext = {

  jira: {

    ticketId:
      jira.ticketId,

    summary:
      jira.summary,

    description:
      jira.description,

    acceptanceCriteria:
      extractAcceptanceCriteria(
        jira
      ),

    status:
      jira.status,

    priority:
      jira.priority,

    labels:
      jira.labels,

    components:
      jira.components

  },

  linkedIssues,

  domainContext,

  github: {
  repository,

  implementationEvidence:
    githubImplementationEvidence,

  llmDirectedEvidence:
    llmGitHubEvidence,

  sourceFiles:
    githubFileEvidence,

  commitEvidence
},

  qmetry: {
  domainContext:
    qmetryDomainContext,

  existingTestCases:
    qmetryCases,

  llmDirectedEvidence:
    llmQMetryEvidence,

  details:
    qmetryDetails,

  relevanceEvidence:
    qmetryRelevanceEvidence
},

  evidenceMap,

  discoveryPlan,

  scope,

  scenario

};

let generated = null;

try {

  generated =
    await generateTestCasesWithGemini(
      llmContext
    );

  console.log(
    "[QANEX] Parsed generation result:"
  );

  console.log(
    JSON.stringify(
      generated,
      null,
      2
    )
  );

} catch (error) {

  console.warn(
    `Primary LLM generation failed: ${error.message}`
  );

}


let testCases =
  normalizeGeneratedTestCases(
    generated
  );

testCases =
  testCases.map((testCase, index) => ({
    ...testCase,
    testCaseId:
      String(
        testCase?.testCaseId ||
        `TC-${String(index + 1).padStart(3, "0")}`
      ),
    title:
      applyTitleTags(
        testCase?.title,
        titleTags
      )
  }));


console.log(
  `[QANEX] Normalized test case count: ${testCases.length}`
);


if (!testCases.length) {

  console.error(
    "[QANEX] Generation result could not be normalized."
  );

  console.error(
    "[QANEX] Generated value:"
  );

  console.error(
    JSON.stringify(
      generated,
      null,
      2
    )
  );

  throw new Error(
    "SAGE did not generate valid test cases. " +
    "Check the SAGE response and JSON parsing."
  );

}

  /*
   * ==========================================================
   * STEP 17
   * Return the collected QANEX context.
   * ==========================================================
   */

  return {
    ticketId,
    summary: jira.summary,
    testCases
  };

}

function escapeMarkdownCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n")
    .trim();
}

function buildMarkdownTable(testCases = []) {
  const header =
    "| Test Case ID | Title | Preconditions | Steps | Test Data | Expected Result |";

  const separator =
    "|---|---|---|---|---|---|";

  const rows =
    testCases.map(testCase => {
      return [
        escapeMarkdownCell(testCase.testCaseId),
        escapeMarkdownCell(testCase.title),
        escapeMarkdownCell(testCase.preconditions),
        escapeMarkdownCell(testCase.steps),
        escapeMarkdownCell(testCase.testData),
        escapeMarkdownCell(testCase.expectedResult)
      ].join(" | ");
    }).map(row => `| ${row} |`);

  return [
    header,
    separator,
    ...rows
  ].join("\n");
}