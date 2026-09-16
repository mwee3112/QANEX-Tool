import { useEffect, useState } from "react";
import * as XLSX from "xlsx-js-style";

function loadSavedResult() {
  try {
    const savedResult = sessionStorage.getItem("qanex-result");

    return savedResult
      ? JSON.parse(savedResult)
      : null;

  } catch (error) {
    console.warn(
      "[QANEX] Could not restore saved result:",
      error
    );

    return null;
  }
}

function toDisplayText(value, fieldName = "") {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n");
  }

  if (Array.isArray(value)) {
    if (fieldName === "steps") {
      return value
        .map((step, index) => {
          if (typeof step === "string") {
            return `${index + 1}. ${step}`;
          }

          if (step && typeof step === "object") {
            const stepNo = Number(step.step) || index + 1;
            const action = String(step.action || step.stepDescription || "").trim();

            return `${stepNo}. ${action}`.trim();
          }

          return String(step ?? "");
        })
        .filter(Boolean)
        .join("\n\n");
    }

    return value
      .map(item => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object") {
          return JSON.stringify(item, null, 2);
        }

        return String(item ?? "");
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function toExpectedResultText(testCase) {
  const direct = toDisplayText(testCase?.expectedResult || "").trim();

  if (direct) {
    return direct;
  }

  const steps = Array.isArray(testCase?.steps)
    ? testCase.steps
    : [];

  return steps
    .map((step, index) => {
      if (!step || typeof step !== "object") {
        return "";
      }

      const stepNo = Number(step.step) || index + 1;
      const expected = String(step.expectedResult || step.expected || "").trim();

      if (!expected) {
        return "";
      }

      return `${stepNo}. ${expected}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function App() {
  const [jiraUrl, setJiraUrl] = useState("");
  const [repository, setRepository] = useState(
    "SyscoCorporation/swms-qe-phase2-ui"
  );
  const [titleTags, setTitleTags] = useState("");
  const [result, setResult] = useState(() => loadSavedResult());
  const [originalTestCases, setOriginalTestCases] = useState(() => {
    const savedResult = loadSavedResult();

    return Array.isArray(savedResult?.testCases)
      ? savedResult.testCases.map(testCase => ({ ...testCase }))
      : [];
  });
  const [activeCell, setActiveCell] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
  if (result) {
    sessionStorage.setItem(
      "qanex-result",
      JSON.stringify(result)
    );
  }
}, [result]);


  const generate = async () => {
    if (!jiraUrl.trim()) {
      setError("Please enter a Jira ticket URL.");
      return;
    }

    if (!repository.trim()) {
      setError("Please enter a GitHub repository.");
      return;
    }

    setLoading(true);
    setError("");
    //setResult(null);

    try {
      const response = await fetch(
        "http://localhost:3001/api/generate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            jiraUrl: jiraUrl.trim(),
            repository: repository.trim(),
            scope: "full",
            scenario: "",
            titleTags: titleTags.trim(),
            includeDebug: false
          })
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "QANEX generation failed."
        );
      }

      setResult(data);
      setOriginalTestCases(
        Array.isArray(data?.testCases)
          ? data.testCases.map(testCase => ({ ...testCase }))
          : []
      );
      setActiveCell(null);

    } catch (err) {
      setError(
        err.message || "QANEX generation failed."
      );

    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    const testCases = result?.testCases || [];

    if (!testCases.length) {
      setError("There are no test cases to export.");
      return;
    }

    const rows = testCases.map((testCase, index) => ({
      "Test Case ID":
        testCase.testCaseId ||
        `TC-${String(index + 1).padStart(3, "0")}`,
      "Title": toDisplayText(testCase.title),
      "Preconditions": toDisplayText(testCase.preconditions),
      "Steps": toDisplayText(testCase.steps, "steps"),
      "Test Data": toDisplayText(testCase.testData),
      "Expected Result": toExpectedResultText(testCase)
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Test Cases"
    );

    worksheet["!cols"] = [
      { wch: 20 },
      { wch: 60 },
      { wch: 65 },
      { wch: 65 },
      { wch: 55 },
      { wch: 70 }
    ];

    const headerStyle = {
      font: {
        bold: true,
        color: {
          rgb: "FFFFFF"
        }
      },
      fill: {
        fgColor: {
          rgb: "173F68"
        }
      },
      alignment: {
        horizontal: "center",
        vertical: "center",
        wrapText: true
      }
    };

    const bodyStyle = {
      alignment: {
        vertical: "top",
        horizontal: "left",
        wrapText: true
      }
    };

    const headers = [
      "Test Case ID",
      "Title",
      "Preconditions",
      "Steps",
      "Test Data",
      "Expected Result"
    ];

    headers.forEach((header, columnIndex) => {
      const cellAddress = XLSX.utils.encode_cell({
        r: 0,
        c: columnIndex
      });

      if (worksheet[cellAddress]) {
        worksheet[cellAddress].s = headerStyle;
      }
    });

    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex++) {
      if (!worksheet["!rows"]) {
        worksheet["!rows"] = [];
      }

      worksheet["!rows"][rowIndex] = {
        hpt: 110
      };

      for (let columnIndex = 0; columnIndex < headers.length; columnIndex++) {
        const cellAddress = XLSX.utils.encode_cell({
          r: rowIndex,
          c: columnIndex
        });

        const cell = worksheet[cellAddress];

        if (!cell) {
          continue;
        }

        cell.s = bodyStyle;
      }
    }

    if (!worksheet["!rows"]) {
      worksheet["!rows"] = [];
    }

    worksheet["!rows"][0] = {
      hpt: 28
    };

    worksheet["!freeze"] = {
      xSplit: 0,
      ySplit: 1
    };

    worksheet["!autofilter"] = {
      ref: worksheet["!ref"]
    };

    const ticketId =
      result?.jira?.ticketId ||
      result?.ticketId ||
      "QANEX";

    XLSX.writeFile(
      workbook,
      `${ticketId}_Test_Cases.xlsx`
    );
  };

  const updateTestCaseField = (index, field, value) => {
    setResult(previousResult => {
      if (!previousResult?.testCases) {
        return previousResult;
      }

      const nextTestCases = previousResult.testCases.map((testCase, testCaseIndex) => {
        if (testCaseIndex !== index) {
          return testCase;
        }

        return {
          ...testCase,
          [field]: value
        };
      });

      return {
        ...previousResult,
        testCases: nextTestCases
      };
    });
  };

  const resetTestCaseRow = (index) => {
    setResult(previousResult => {
      if (!previousResult?.testCases || !originalTestCases[index]) {
        return previousResult;
      }

      const nextTestCases = previousResult.testCases.map((testCase, testCaseIndex) => {
        if (testCaseIndex !== index) {
          return testCase;
        }

        return {
          ...originalTestCases[index]
        };
      });

      return {
        ...previousResult,
        testCases: nextTestCases
      };
    });

    setActiveCell(null);
  };

  const startCellEdit = (rowIndex, field) => {
    setActiveCell({ rowIndex, field });
  };

  const stopCellEdit = () => {
    setActiveCell(null);
  };

  const isCellActive = (rowIndex, field) => (
    activeCell?.rowIndex === rowIndex &&
    activeCell?.field === field
  );

  const autoResizeTextarea = (element) => {
    if (!element) {
      return;
    }

    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 90)}px`;
  };

  const testCases = result?.testCases || [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">
            Q
          </div>

          <div>
            <div className="brand-name">
              QANEX
            </div>

            <div className="brand-subtitle">
              SWMS QA Assistant
            </div>
          </div>
        </div>

        <div className="connection-status">
          <span className="status-dot"></span>
          Backend connected
        </div>
      </header>

      <main className="content">

  {/* =====================================================
      HERO
      ===================================================== */}

  <section className="hero">

    <div>

      <div className="eyebrow">
        INTELLIGENT TEST CASE GENERATION
      </div>

      <h1>
        Generate comprehensive
        <span> test cases</span>
      </h1>

      <p>
        QANEX analyzes the Jira requirement,
        linked issues, SWMS domain context,
        GitHub implementation evidence,
        and existing QMetry test cases.
      </p>

    </div>

    <div className="hero-icon">
      <div>✓</div>
    </div>

  </section>


  {/* =====================================================
      INPUT + PIPELINE
      ===================================================== */}

  <section className="workspace">

    {/* INPUT PANEL */}

    <div className="panel">

      <div className="panel-header">

        <h2>
          Generate Test Cases
        </h2>

        <p>
          Provide the Jira ticket and
          implementation repository.
        </p>

      </div>


      <label>
        Jira Ticket
      </label>

      <input
        value={jiraUrl}
        onChange={(e) =>
          setJiraUrl(e.target.value)
        }
        placeholder="Paste Jira ticket URL"
      />


      <label>
        GitHub Repository
      </label>

      <input
        value={repository}
        onChange={(e) =>
          setRepository(e.target.value)
        }
        placeholder="owner/repository"
      />


      <label>
        Title Tags Prefix
      </label>

      <input
        value={titleTags}
        onChange={(e) =>
          setTitleTags(e.target.value)
        }
        placeholder="[DT][NEW UI][Tasking][Tasking Function]"
      />


      <button
        className="generate-button"
        onClick={generate}
        disabled={loading}
      >
        {loading
          ? "Generating..."
          : "Generate Test Cases"}
      </button>


      {error && (
        <div className="error">
          {error}
        </div>
      )}

    </div>


    {/* PIPELINE PANEL */}

    <div className="panel">

      <div className="panel-header">

        <h2>
          QANEX Pipeline
        </h2>

        <p>
          Evidence sources used during
          test generation.
        </p>

      </div>


      <div className="pipeline">

        <div className="pipeline-item">

          <div className="pipeline-icon">
            01
          </div>

          <div>
            <strong>
              Jira
            </strong>

            <span>
              Requirements and acceptance criteria
            </span>
          </div>

        </div>


        <div className="pipeline-item">

          <div className="pipeline-icon">
            02
          </div>

          <div>
            <strong>
              QMetry
            </strong>

            <span>
              SWMS domain context and existing cases
            </span>
          </div>

        </div>


        <div className="pipeline-item">

          <div className="pipeline-icon">
            03
          </div>

          <div>
            <strong>
              Confluence
            </strong>

            <span>
              Business and navigation context
            </span>
          </div>

        </div>


        <div className="pipeline-item">

          <div className="pipeline-icon">
            04
          </div>

          <div>
            <strong>
              GitHub
            </strong>

            <span>
              Implementation evidence
            </span>
          </div>

        </div>


        <div className="pipeline-item">

          <div className="pipeline-icon">
            05
          </div>

          <div>
            <strong>
              Test Generation
            </strong>

            <span>
              Structured SWMS test cases
            </span>
          </div>

        </div>

      </div>

    </div>

  </section>

        {result && (
          <section className="panel" style={{ marginTop: "22px" }}>
            <div className="panel-header">
              <h2>
                Final Output
              </h2>

              <p>
                {result.ticketId || "QANEX"} - {testCases.length} test case(s)
              </p>
            </div>

            <button
              className="export-button"
              onClick={exportToExcel}
              disabled={!testCases.length}
            >
              Export Excel
            </button>
          </section>
        )}

        {result && testCases.length > 0 && (
          <section className="panel" style={{ marginTop: "22px" }}>
            <div className="panel-header">
              <h2>
                Generated Test Cases
              </h2>

              <p>
                Test cases generated from the Jira acceptance criteria and supporting QANEX evidence.
              </p>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "14px"
                }}
              >
                <thead>
                  <tr
                    style={{
                      background: "#1f4e79",
                      color: "white"
                    }}
                  >
                    <th
                      style={{
                        padding: "14px 16px",
                        textAlign: "left",
                        fontWeight: "600",
                        borderBottom: "1px solid #d5dce6"
                      }}
                    >
                      Test Case ID
                    </th>

                    <th
                      style={{
                        padding: "14px 16px",
                        textAlign: "left",
                        fontWeight: "600",
                        borderBottom: "1px solid #d5dce6"
                      }}
                    >
                      Title
                    </th>

                    <th
                      style={{
                        padding: "14px 16px",
                        textAlign: "left",
                        fontWeight: "600",
                        borderBottom: "1px solid #d5dce6"
                      }}
                    >
                      Preconditions
                    </th>

                    <th
                      style={{
                        padding: "14px 16px",
                        textAlign: "left",
                        fontWeight: "600",
                        borderBottom: "1px solid #d5dce6"
                      }}
                    >
                      Steps
                    </th>

                    <th
                      style={{
                        padding: "14px 16px",
                        textAlign: "left",
                        fontWeight: "600",
                        borderBottom: "1px solid #d5dce6"
                      }}
                    >
                      Test Data
                    </th>

                    <th
                      style={{
                        padding: "14px 16px",
                        textAlign: "left",
                        fontWeight: "600",
                        borderBottom: "1px solid #d5dce6"
                      }}
                    >
                      Expected Result
                    </th>

                    <th
                      style={{
                        padding: "14px 16px",
                        textAlign: "left",
                        fontWeight: "600",
                        borderBottom: "1px solid #d5dce6",
                        width: "120px"
                      }}
                    >
                      Actions
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {testCases.map((testCase, index) => (
                    <tr
                      key={index}
                      style={{
                        borderBottom: "1px solid #e4e9f0"
                      }}
                    >
                      <td
                        style={{
                          padding: "16px",
                          verticalAlign: "top",
                          background: "#1f4e79",
                          color: "white",
                          fontWeight: "600",
                          minWidth: "120px"
                        }}
                      >
                        {isCellActive(index, "testCaseId") ? (
                          <input
                            className="editable-cell-input editable-cell-input-id"
                            value={
                              testCase.testCaseId ||
                              `TC-${String(index + 1).padStart(3, "0")}`
                            }
                            onChange={(event) =>
                              updateTestCaseField(index, "testCaseId", event.target.value)
                            }
                            onBlur={stopCellEdit}
                            autoFocus
                          />
                        ) : (
                          <div
                            className="editable-cell-display editable-cell-display-id"
                            onClick={() => startCellEdit(index, "testCaseId")}
                            title="Click to edit"
                          >
                            {testCase.testCaseId ||
                              `TC-${String(index + 1).padStart(3, "0")}`}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "16px",
                          verticalAlign: "top",
                          minWidth: "300px"
                        }}
                      >
                        {isCellActive(index, "title") ? (
                          <textarea
                            className="editable-cell-textarea"
                            value={toDisplayText(testCase.title)}
                            onChange={(event) => {
                              updateTestCaseField(index, "title", event.target.value);
                              autoResizeTextarea(event.target);
                            }}
                            onFocus={(event) => autoResizeTextarea(event.target)}
                            onBlur={stopCellEdit}
                            autoFocus
                          />
                        ) : (
                          <div
                            className="editable-cell-display"
                            onClick={() => startCellEdit(index, "title")}
                            title="Click to edit"
                          >
                            {toDisplayText(testCase.title)}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "16px",
                          verticalAlign: "top",
                          whiteSpace: "pre-wrap",
                          wordWrap: "break-word",
                          minWidth: "300px"
                        }}
                      >
                        {isCellActive(index, "preconditions") ? (
                          <textarea
                            className="editable-cell-textarea"
                            value={toDisplayText(testCase.preconditions)}
                            onChange={(event) => {
                              updateTestCaseField(index, "preconditions", event.target.value);
                              autoResizeTextarea(event.target);
                            }}
                            onFocus={(event) => autoResizeTextarea(event.target)}
                            onBlur={stopCellEdit}
                            autoFocus
                          />
                        ) : (
                          <div
                            className="editable-cell-display"
                            onClick={() => startCellEdit(index, "preconditions")}
                            title="Click to edit"
                          >
                            {toDisplayText(testCase.preconditions)}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "16px",
                          verticalAlign: "top",
                          whiteSpace: "pre-wrap",
                          wordWrap: "break-word",
                          minWidth: "300px"
                        }}
                      >
                        {isCellActive(index, "steps") ? (
                          <textarea
                            className="editable-cell-textarea"
                            value={toDisplayText(testCase.steps, "steps")}
                            onChange={(event) => {
                              updateTestCaseField(index, "steps", event.target.value);
                              autoResizeTextarea(event.target);
                            }}
                            onFocus={(event) => autoResizeTextarea(event.target)}
                            onBlur={stopCellEdit}
                            autoFocus
                          />
                        ) : (
                          <div
                            className="editable-cell-display"
                            onClick={() => startCellEdit(index, "steps")}
                            title="Click to edit"
                          >
                            {toDisplayText(testCase.steps, "steps")}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "16px",
                          verticalAlign: "top",
                          whiteSpace: "pre-wrap",
                          wordWrap: "break-word",
                          minWidth: "250px"
                        }}
                      >
                        {isCellActive(index, "testData") ? (
                          <textarea
                            className="editable-cell-textarea"
                            value={toDisplayText(testCase.testData)}
                            onChange={(event) => {
                              updateTestCaseField(index, "testData", event.target.value);
                              autoResizeTextarea(event.target);
                            }}
                            onFocus={(event) => autoResizeTextarea(event.target)}
                            onBlur={stopCellEdit}
                            autoFocus
                          />
                        ) : (
                          <div
                            className="editable-cell-display"
                            onClick={() => startCellEdit(index, "testData")}
                            title="Click to edit"
                          >
                            {toDisplayText(testCase.testData)}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "16px",
                          verticalAlign: "top",
                          whiteSpace: "pre-wrap",
                          wordWrap: "break-word",
                          minWidth: "300px"
                        }}
                      >
                        {isCellActive(index, "expectedResult") ? (
                          <textarea
                            className="editable-cell-textarea"
                            value={toExpectedResultText(testCase)}
                            onChange={(event) => {
                              updateTestCaseField(index, "expectedResult", event.target.value);
                              autoResizeTextarea(event.target);
                            }}
                            onFocus={(event) => autoResizeTextarea(event.target)}
                            onBlur={stopCellEdit}
                            autoFocus
                          />
                        ) : (
                          <div
                            className="editable-cell-display"
                            onClick={() => startCellEdit(index, "expectedResult")}
                            title="Click to edit"
                          >
                            {toExpectedResultText(testCase)}
                          </div>
                        )}
                      </td>

                      <td
                        style={{
                          padding: "16px",
                          verticalAlign: "top",
                          minWidth: "120px"
                        }}
                      >
                        <button
                          className="row-reset-button"
                          onClick={() => resetTestCaseRow(index)}
                          disabled={
                            JSON.stringify(testCase) ===
                            JSON.stringify(originalTestCases[index] || {})
                          }
                        >
                          Reset
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
