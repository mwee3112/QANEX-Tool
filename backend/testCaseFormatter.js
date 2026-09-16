function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return [];
  }

  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map(x => x.trim())
      .filter(Boolean);
  }

  return [value];
}


function formatNumbered(items, formatter) {
  return asArray(items)
    .map((item, index) => {

      const formatted = formatter(item);

      // Do not add another number if the text
      // already starts with "1. ", "2. ", etc.
      if (
        typeof formatted === "string" &&
        /^\s*\d+\.\s*/.test(formatted)
      ) {
        return formatted.trim();
      }

      const number =
        typeof item === "object" &&
        item.step
          ? item.step
          : index + 1;

      return `${number}. ${formatted}`;
    })
    .join("\n");
}


export function formatPreconditions(preconditions) {
  return formatNumbered(
    preconditions,
    item => {
      if (typeof item === "string") {
        return item;
      }

      return (
        item.description ||
        item.action ||
        JSON.stringify(item)
      );
    }
  );
}


export function formatTestData(testData) {
  return formatNumbered(
    testData,
    item => {
      if (typeof item === "string") {
        return item;
      }

      return (
        item.value ||
        item.data ||
        item.description ||
        JSON.stringify(item)
      );
    }
  );
}


export function formatSteps(steps) {
  return formatNumbered(
    steps,
    item => {
      if (typeof item === "string") {
        return item;
      }

      return (
        item.action ||
        item.stepDescription ||
        item.description ||
        ""
      );
    }
  );
}


export function formatExpectedResults(steps) {
  return formatNumbered(
    steps,
    item => {
      if (typeof item === "string") {
        return item;
      }

      return (
        item.expectedResult ||
        item.expected ||
        ""
      );
    }
  );
}


export function formatSqlQueries(
  queries,
  startNumber = 1
) {
  return asArray(queries)
    .map((item, index) => {

      const query =
        typeof item === "string"
          ? item
          : item.query || "";

      const purpose =
        typeof item === "object"
          ? item.purpose || "Database verification"
          : "Database verification";

      return `${startNumber + index}. ${purpose}:\n${query}`;
    })
    .join("\n");
}


export function toExcelTestCase(testCase) {

  const steps = asArray(testCase.steps);

  let testData =
    formatTestData(testCase.testData);

  if (
    testCase.sqlQueries &&
    testCase.sqlQueries.length > 0
  ) {

    const sqlStart =
      asArray(testCase.testData).length + 1;

    const sqlText =
      formatSqlQueries(
        testCase.sqlQueries,
        sqlStart
      );

    testData = testData
      ? `${testData}\n${sqlText}`
      : sqlText;
  }

  return {
    "Test Case ID":
      testCase.testCaseId || "",

    "Title":
      testCase.title ||
      testCase.testCaseName ||
      "",

    "Preconditions":
      formatPreconditions(
        testCase.preconditions
      ) || "No special preconditions.",

    "Steps":
      formatSteps(steps),

    "Test Data":
      testData ||
      "No additional test data required.",

    "Expected Result":
      formatExpectedResults(steps)
  };
}


export function formatForExcel(testCases) {
  return asArray(testCases)
    .map(toExcelTestCase);
}