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

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  return [];
}
function normalizeEvidenceNames(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => {
      if (typeof item === "string") {
        return item;
      }

      if (item && typeof item === "object") {
        return (
          item.name ||
          item.table ||
          item.column ||
          ""
        );
      }

      return "";
    })
    .map(x => String(x).trim().toLowerCase())
    .filter(Boolean);
}

function validateStepMapping(testCase, findings) {
  const steps = Array.isArray(testCase.steps)
    ? testCase.steps
    : typeof testCase.steps === "string"
      ? testCase.steps
          .split(/\r?\n+/)
          .map(line => line.trim())
          .filter(Boolean)
          .map((line, index) => {
            const stepMatch =
              line.match(/^\s*(\d+)\.\s*(.*)$/);

            return {
              step:
                stepMatch
                  ? Number(stepMatch[1])
                  : index + 1,
              action:
                stepMatch
                  ? stepMatch[2]
                  : line,
              expectedResult: ""
            };
          })
      : [];

  const expectedLines =
  Array.isArray(testCase.expectedResult)
    ? testCase.expectedResult.map(item =>
        typeof item === "string"
          ? item
          : item?.expectedResult ||
            item?.expected ||
            ""
      )
    : typeof testCase.expectedResult === "string"
      ? testCase.expectedResult
          .split(/\r?\n+/)
          .map(line => line.trim())
          .filter(Boolean)
      : [];

  if (!steps.length) {
    findings.push("Test case has no executable steps.");
    return;
  }

steps.forEach((step, index) => {
  const action =
    typeof step === "string"
      ? step
      : step?.action || step?.stepDescription || "";

  let expected =
    typeof step === "string"
      ? ""
      : step?.expectedResult || step?.expected || "";

  if (!expected && expectedLines[index]) {
    const expectedMatch =
      expectedLines[index].match(/^\s*\d+\.\s*(.*)$/);

    expected =
      expectedMatch
        ? expectedMatch[1]
        : expectedLines[index];
  }

  if (!clean(action)) {
    findings.push(`Step ${index + 1} has no action.`);
  }

  if (!clean(expected)) {
    findings.push(
      `Step ${index + 1} has no expected result.`
    );
  }

  const normalizedExpected =
    String(expected)
      .trim()
      .toLowerCase();

  const placeholderPatterns = [
  "expected behavior is shown for",
  "expected outcome is shown for",
  "expected result is shown for",
  "expected behavior",
  "expected outcome",
  "expected result",
  "system behaves as expected",
  "system works as expected",
  "appropriate result is displayed",
  "expected message is displayed",
  "corresponding result is displayed"
];

  if (
    normalizedExpected &&
    placeholderPatterns.some(
      pattern =>
        normalizedExpected.includes(pattern)
    )
  ) {
    findings.push(
      `Step ${index + 1} has a placeholder expected result.`
    );
  }

  const normalizedAction =
    String(action)
      .trim()
      .toLowerCase();

  const actionPlaceholders = [
  "perform action for",
  "perform action",
  "do action",
  "execute action",
  "action for",
  "take the required action",
  "perform the required action",
  "complete the action",
  "carry out the action",
  "do the above",
  "perform the above"
];

  if (
    normalizedAction &&
    actionPlaceholders.some(
      pattern =>
        normalizedAction.includes(pattern)
    )
  ) {
    findings.push(
      `Step ${index + 1} contains a placeholder action.`
    );
  }
});



const firstAction =
  typeof steps[0] === "string"
    ? steps[0]
    : steps[0]?.action || "";

if (
  steps[0]?.step !== undefined &&
  Number(steps[0].step) !== 1
) {
  findings.push("First step must have step number 1.");
}

const hasAuthenticationPrecondition =
  Array.isArray(testCase.preconditions) &&
  testCase.preconditions.some(
    item =>
      String(
        typeof item === "string"
          ? item
          : item?.description ||
            item?.action ||
            ""
      )
        .toLowerCase()
        .match(
          /logged in|authenticated|authentication|user session|signed in/
        )
  );

if (
  firstAction &&
  !firstAction.toLowerCase().includes("login") &&
  !hasAuthenticationPrecondition
) {
  findings.push(
    "Authentication must be established either in the first executable step or in the preconditions."
  );
}
}

function extractIdentifiers(text) {
  return [
    ...(String(text).match(
      /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g
    ) || []),

    ...(String(text).match(
      /\b[A-Za-z][A-Za-z0-9]*(?:Id|ID|Code|Number|No|Flag|Status|Type|Name|Date|Value)\b/g
    ) || [])
  ];
}

function validateSql(testCase, evidence, findings) {
  const dbRequired =
    testCase.databaseValidation === true;

  const evidenceRequiresDatabase =
    evidence?.database?.validationRequired === true ||
    evidence?.sql?.required === true;

  /*
   * Database validation should only be required when:
   *
   * 1. The generated test case explicitly requests it, OR
   * 2. The collected evidence explicitly says DB validation
   *    is required.
   *
   * Do NOT infer SQL merely because words such as
   * "quantity", "allocation", "inventory", "state", etc.
   * appear in the test case.
   */
  const shouldRequireSql =
    dbRequired ||
    evidenceRequiresDatabase;

  const queries =
    Array.isArray(testCase.sqlQueries)
      ? testCase.sqlQueries
      : [];

  if (!shouldRequireSql) {
    return;
  }

  if (!queries.length) {
    findings.push(
      "Database validation is required but no SQL query was generated."
    );
    return;
  }

  const supportedTables =
    new Set(
      normalizeEvidenceNames(
        evidence?.database?.tables
      )
    );

  const supportedColumns =
    new Set(
      normalizeEvidenceNames(
        evidence?.database?.columns
      )
    );

  queries.forEach((item, index) => {
    const query =
      typeof item === "string"
        ? item
        : item?.query || "";

    if (!query.trim()) {
      findings.push(
        `SQL query ${index + 1} is empty.`
      );
      return;
    }

    /*
     * Validate table references only when the evidence
     * actually provides a known table list.
     */
    if (supportedTables.size > 0) {
      const tablesInQuery = [
        ...query.matchAll(
          /\b(?:from|join|update|into|delete\s+from)\s+([a-zA-Z0-9_$#]+)/gi
        )
      ].map(match =>
        match[1].toLowerCase()
      );

      for (const table of tablesInQuery) {
        if (!supportedTables.has(table)) {
          findings.push(
            `SQL references unsupported table: ${table}`
          );
        }
      }
    }

    /*
     * Validate obvious column identifiers only when
     * column evidence is available.
     */
    if (supportedColumns.size > 0) {
      const tokens =
        query
          .replace(/'[^']*'/g, "")
          .match(
            /\b[a-zA-Z_][a-zA-Z0-9_$#]*\b/g
          ) || [];

      const sqlKeywords =
        new Set([
          "select",
          "from",
          "where",
          "and",
          "or",
          "join",
          "on",
          "update",
          "set",
          "delete",
          "insert",
          "into",
          "values",
          "as",
          "order",
          "by",
          "group",
          "having",
          "asc",
          "desc",
          "null",
          "is",
          "not",
          "like",
          "in",
          "between",
          "exists",
          "distinct",
          "case",
          "when",
          "then",
          "else",
          "end",
          "count",
          "sum",
          "min",
          "max",
          "avg"
        ]);

      for (const token of tokens) {
        const lower =
          token.toLowerCase();

        if (
          sqlKeywords.has(lower) ||
          supportedTables.has(lower)
        ) {
          continue;
        }

        /*
         * Only flag identifier-looking tokens.
         * Ordinary SQL words should not cause failures.
         */
        if (
          lower.includes("_") &&
          !supportedColumns.has(lower)
        ) {
          findings.push(
            `SQL may contain unsupported column: ${token}`
          );
        }
      }
    }
  });
}

/*
 * IMPORTANT:
 *
 * There are NO feature-specific names here.
 *
 * Technical names are validated dynamically against
 * evidence supplied for the current Jira ticket.
 */
function validateEvidence(testCase, evidence, findings) {
  const evidenceText =
    JSON.stringify(evidence || {}).toLowerCase();

  const testCaseText =
    JSON.stringify(testCase || {}).toLowerCase();

  const technicalEvidence = [
    ...(normalizeArray(
      evidence?.ui?.screenNames
    )),

    ...(normalizeArray(
      evidence?.ui?.menus
    )),

    ...(normalizeArray(
      evidence?.ui?.fields
    )),

    ...(normalizeArray(
      evidence?.ui?.buttons
    )),

    ...(normalizeArray(
      evidence?.ui?.messages
    )),

    ...(normalizeArray(
      evidence?.backend?.apis
    )),

    ...(normalizeArray(
      evidence?.backend?.services
    )),

    ...(normalizeArray(
      evidence?.backend?.controllers
    )),

    ...(normalizeArray(
      evidence?.backend?.constants
    )),

    ...(normalizeArray(
      evidence?.backend?.enums
    )),

    ...(normalizeArray(
      evidence?.database?.tables
    )),

    ...(normalizeArray(
      evidence?.database?.columns
    )),

    ...(normalizeArray(
      evidence?.database?.syspars
    ))
  ];

  const normalizedEvidenceTerms =
    new Set(
      technicalEvidence
        .map(x => String(x).trim().toLowerCase())
        .filter(x => x.length >= 3)
    );

  /*
   * Only validate identifiers that look technical.
   * Business-language statements are allowed.
   */
  const identifiers =
    extractIdentifiers(testCaseText);

  for (const identifier of identifiers) {
    const normalized =
      identifier.toLowerCase();

    if (
      normalizedEvidenceTerms.size > 0 &&
      !normalizedEvidenceTerms.has(normalized) &&
      !evidenceText.includes(normalized)
    ) {
      findings.push(
        `Generated technical identifier is not supported by collected evidence: ${identifier}`
      );
    }
  }
}

function validateRequirementCoverage(
  testCases,
  evidence,
  findings
) {
  const requirements =
    normalizeArray(evidence?.requirements);

  if (!requirements.length) {
    return;
  }

  const generatedText =
    JSON.stringify(testCases).toLowerCase();

  requirements.forEach((requirement, index) => {
    const text =
      clean(requirement).toLowerCase();

    const significantWords =
      text
        .split(/\s+/)
        .filter(word =>
          word.length >= 5 &&
          ![
            "should",
            "system",
            "shall",
            "user",
            "must",
            "with",
            "from",
            "that",
            "this",
            "when",
            "where",
            "then"
          ].includes(word)
        );

    if (!significantWords.length) {
      return;
    }

    const matchedWordCount =
  significantWords.filter(word =>
    generatedText.includes(
      word.replace(/[^\w-]/g, "")
    )
  ).length;

const matched =
  matchedWordCount >= Math.min(
    2,
    significantWords.length
  );

    if (!matched) {
      findings.push(
        `Acceptance criterion ${index + 1} may not be covered by the generated test cases.`
      );
    }
  });
}

function validateExistingCoverage(
  testCases,
  evidence,
  findings
) {
  const existingCoverage =
    normalizeArray(
      evidence?.existingCoverage
    );

  if (!existingCoverage.length) {
    return;
  }

  const generatedText =
    JSON.stringify(testCases).toLowerCase();

  /*
   * Existing QMetry coverage is advisory.
   *
   * We do not reject a case merely because similar
   * wording exists. The LLM must decide whether it is
   * genuinely duplicate or whether the new AC adds
   * a distinct testing intent.
   */
  for (const existing of existingCoverage) {
    const text =
      clean(existing).toLowerCase();

    if (
  text.length > 20 &&
  generatedText.includes(text)
) {
  // Advisory only.
  // Do not fail validation.
  break;
}
  }
}

export function validateTestCases(
  testCases,
  evidence = {}
) {
  const findings = [];

  const cases =
    Array.isArray(testCases)
      ? testCases
      : [];

  if (!cases.length) {
    findings.push(
      "No test cases were generated."
    );
  }

  const ids = new Set();

  cases.forEach((testCase, index) => {
    if (!testCase.testCaseId) {
      findings.push(
        `Test case ${index + 1} has no ID.`
      );
    }

    if (
      testCase.testCaseId &&
      ids.has(testCase.testCaseId)
    ) {
      findings.push(
        `Duplicate test case ID: ${testCase.testCaseId}`
      );
    }

    if (testCase.testCaseId) {
      ids.add(testCase.testCaseId);
    }

    if (!testCase.title) {
      findings.push(
        `Test case ${testCase.testCaseId || index + 1} has no title.`
      );
    }

    validateStepMapping(
      testCase,
      findings
    );

    validateSql(
      testCase,
      evidence,
      findings
    );

    validateEvidence(
      testCase,
      evidence,
      findings
    );
  });

  validateRequirementCoverage(
    cases,
    evidence,
    findings
  );

  validateExistingCoverage(
    cases,
    evidence,
    findings
  );

  return {
    valid:
      findings.length === 0,

    findings
  };
}