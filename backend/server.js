import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { runQanex } from "./qanexAgent.js";
import {
  testAtlassianMcp,
  getJiraIssue,
  testGitHubMcp,
  searchGitHub,
  testQMetryMcp,
  searchQMetryCases
} from "./mcp.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "QANEX"
  });
});

app.get("/api/test-github", async (req, res) => {

  try {

    const tools =
      await testGitHubMcp();

    res.json({
      success: true,
      tools
    });

  } catch (error) {

    console.error(
      "GitHub MCP error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "GitHub MCP connection failed."
    });

  }

});

app.get("/api/test-github-search", async (req, res) => {
  try {
    const query = req.query.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "GitHub search query is required."
      });
    }

    const result =
      await searchGitHub(query);

    res.json({
      success: true,
      result
    });

  } catch (error) {
    console.error(
      "GitHub search error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "GitHub search failed."
    });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const {
  jiraUrl,
  repository,
  scope,
  scenario,
  titleTags,
  includeDebug
} = req.body;

const resolvedRepository =
  repository ||
  process.env.QANEX_DEFAULT_REPOSITORY;

    if (!jiraUrl) {
      return res.status(400).json({
        error: "Jira ticket URL is required."
      });
    }

    const result = await runQanex({
  jiraUrl,
  repository: resolvedRepository,
  scope: scope || "full",
      scenario: scenario || "",
      titleTags: titleTags || "",
      includeDebug: Boolean(includeDebug)
});

    res.json(result);
  } catch (error) {
    console.error("QANEX error:", error);

    res.status(500).json({
      error: error.message || "QANEX execution failed."
    });
  }
});

app.get("/api/test-atlassian", async (req, res) => {
  try {
    const tools = await testAtlassianMcp();

    res.json({
      success: true,
      tools
    });
  } catch (error) {
    console.error("Atlassian MCP error:", error);

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/api/test-jira/:ticketId", async (req, res) => {
  try {
    const ticketId = req.params.ticketId;

    const jira = await getJiraIssue(ticketId);

    res.json({
      success: true,
      jira
    });

  } catch (error) {
    console.error("Jira MCP error:", error);

    res.status(500).json({
      success: false,
      error: error.message || "Failed to retrieve Jira issue."
    });
  }
});

app.get("/api/mcp-tools", async (req, res) => {

  try {

    const tools =
      await testAtlassianMcp();

    res.json({
      success: true,
      tools
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      error: error.message
    });

  }

});

app.get("/api/test-qmetry", async (req, res) => {
  try {
    const tools =
      await testQMetryMcp();

    res.json({
      success: true,
      tools
    });

  } catch (error) {
    console.error(
      "QMetry MCP error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "QMetry MCP connection failed."
    });
  }
});

app.get("/api/test-qmetry-search", async (req, res) => {
  try {
    const query = req.query.query;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: "QMetry search query is required."
      });
    }

    const result =
      await searchQMetryCases(query);

    res.json({
      success: true,
      result
    });

  } catch (error) {
    console.error(
      "QMetry search error:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        error.message ||
        "QMetry search failed."
    });
  }
});

app.listen(3001, () => {
  console.log("QANEX backend running on http://localhost:3001");
});