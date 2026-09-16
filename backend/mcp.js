import {
  Client
} from "@modelcontextprotocol/sdk/client/index.js";

import {
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  StreamableHTTPClientTransport
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";


import dotenv from "dotenv";

dotenv.config();

const cloudId =
  process.env.ATLASSIAN_CLOUD_ID;

let client = null;


/**
 * ============================================================
 * ATLASSIAN MCP CLIENT
 * ============================================================
 */

async function getAtlassianClient() {

  if (client) {
    return client;
  }

  client =
    new Client({
      name: "qanex-ui",
      version: "1.0.0"
    });

  const transport =
    new StdioClientTransport({

      command: "npx",

      args: [
        "-y",
        "mcp-remote@latest",
        "https://mcp.atlassian.com/v1/mcp/authv2"
      ],

      env: {
        ...process.env,
        NODE_USE_SYSTEM_CA: "1"
      }

    });

  await client.connect(
    transport
  );

  return client;
}


/**
 * ============================================================
 * GITHUB MCP CLIENT
 * ============================================================
 */

const githubClient =
  new Client({
    name: "qanex-github-client",
    version: "1.0.0"
  });

let githubConnected = false;


async function getGitHubClient() {

  if (githubConnected) {
    return githubClient;
  }

  if (!process.env.GITHUB_MCP_TOKEN) {

    throw new Error(
      "GITHUB_MCP_TOKEN is not configured."
    );

  }

  const transport =
    new StreamableHTTPClientTransport(

      new URL(
        "https://api.githubcopilot.com/mcp/"
      ),

      {
        requestInit: {

          headers: {

            Authorization:
              `Bearer ${process.env.GITHUB_MCP_TOKEN}`

          }

        }

      }

    );

  await githubClient.connect(
    transport
  );

  githubConnected = true;

  return githubClient;
}

/**
 * ============================================================
 * QMETRY MCP CLIENT
 * ============================================================
 */

const qmetryClient = new Client({
  name: "qanex-qmetry-client",
  version: "1.0.0"
});

let qmetryConnected = false;

async function getQMetryClient() {
  if (qmetryConnected) {
    return qmetryClient;
  }

  const qmetryPath =
    process.env.QMETRY_MCP_PATH;

  if (!qmetryPath) {
    throw new Error(
      "QMETRY_MCP_PATH is not configured."
    );
  }

  if (!process.env.QMETRY_OPENAPI_KEY) {
    throw new Error(
      "QMETRY_OPENAPI_KEY is not configured."
    );
  }

  const transport =
    new StdioClientTransport({
      command: "node",

      args: [
        qmetryPath
      ],

      env: {
        ...process.env,
        QMETRY_OPENAPI_KEY:
          process.env.QMETRY_OPENAPI_KEY
      }
    });

  await qmetryClient.connect(
    transport
  );

  qmetryConnected = true;

  return qmetryClient;
}

/**
 * ============================================================
 * GENERIC MCP RESULT EXTRACTION
 * ============================================================
 */

function extractToolResult(
  result
) {

  if (!result) {
    return null;
  }

  if (
    result.structuredContent
  ) {

    return result.structuredContent;

  }

  if (
    Array.isArray(
      result.content
    )
  ) {

    const textParts =
      result.content

        .filter(
          item =>
            item.type === "text"
        )

        .map(
          item =>
            item.text
        );

    if (
      textParts.length === 1
    ) {

      try {

        return JSON.parse(
          textParts[0]
        );

      } catch {

        return textParts[0];

      }

    }

    if (
      textParts.length > 1
    ) {

      return textParts;

    }

  }

  return result;
}


/**
 * ============================================================
 * ATLASSIAN SEARCH
 * ============================================================
 */

async function searchAtlassian(
  query
) {

  const mcp =
    await getAtlassianClient();

  const result =
    await mcp.callTool({

      name: "search",

      arguments: {
        query
      }

    });

  return extractToolResult(
    result
  );
}


/**
 * ============================================================
 * TEST ATLASSIAN MCP
 * ============================================================
 */

export async function testAtlassianMcp() {

  const mcp =
    await getAtlassianClient();

  const result =
    await mcp.listTools();

  console.log(
    "\nAvailable Atlassian MCP tools:\n"
  );

  for (
    const tool of result.tools
  ) {

    console.log(
      `${tool.name} - ${tool.description || ""}`
    );

  }

  return result.tools;
}


/**
 * ============================================================
 * TEST GITHUB MCP
 * ============================================================
 */

export async function testGitHubMcp() {

  const github =
    await getGitHubClient();

  const tools =
    await github.listTools();

  console.log(
    "\n========== GITHUB MCP TOOLS =========="
  );

  for (
    const tool of tools.tools
  ) {

    console.log(
      "\n-----------------------------"
    );

    console.log(
      "TOOL:",
      tool.name
    );

    console.log(
      "DESCRIPTION:",
      tool.description || ""
    );

    console.log(
      "INPUT SCHEMA:",
      JSON.stringify(
        tool.inputSchema,
        null,
        2
      )
    );

  }

  return tools.tools;
}

export async function testQMetryMcp() {
  const qmetry =
    await getQMetryClient();

  const tools =
    await qmetry.listTools();

  console.log(
    "\n========== QMETRY MCP TOOLS =========="
  );

  for (const tool of tools.tools) {
    console.log(
      "\n-----------------------------"
    );

    console.log(
      "TOOL:",
      tool.name
    );

    console.log(
      "DESCRIPTION:",
      tool.description || ""
    );

    console.log(
      "INPUT SCHEMA:",
      JSON.stringify(
        tool.inputSchema,
        null,
        2
      )
    );
  }

  return tools.tools;
}

/**
 * ============================================================
 * GET JIRA ISSUE
 * ============================================================
 */

export async function getJiraIssue(
  ticketId
) {

  if (!ticketId) {

    throw new Error(
      "Jira ticket ID is required."
    );

  }

  if (!cloudId) {

    throw new Error(
      "ATLASSIAN_CLOUD_ID is not configured."
    );

  }

  const mcp =
    await getAtlassianClient();

  const jiraResult =
    await mcp.callTool({

      name: "getJiraIssue",

      arguments: {

        cloudId,

        issueIdOrKey:
          ticketId,

        fields: [

          "summary",
          "description",
          "status",
          "issuetype",
          "priority",
          "labels",
          "components",
          "assignee",
          "reporter",
          "created",
          "updated",
          "resolution",
          "project",
          "comment"

        ],

        responseContentFormat:
          "markdown"

      }

    });

  const jira =
    extractToolResult(
      jiraResult
    );

  if (
    jira?.error === true ||
    (
      typeof jira?.message === "string" &&
      jira.message.toLowerCase().includes("issue does not exist")
    )
  ) {
    throw new Error(
      `Unable to load Jira issue ${ticketId}: ${jira?.message || "Issue does not exist or permission is denied."}`
    );
  }

  console.log(
    `Jira issue loaded: ${ticketId}`
  );


  /*
   * Retrieve additional Teamwork Graph context.
   * This is used to discover linked Jira issues.
   */
  let context = null;

  try {

    const contextResult =
      await mcp.callTool({

        name:
          "getTeamworkGraphContext",

        arguments: {

          cloudId,

          objectType:
            "JiraWorkItem",

          objectIdentifier:
            ticketId,

          detailLevel:
            "full",

          first: 50

        }

      });

    context =
      extractToolResult(
        contextResult
      );

  } catch (error) {

    console.warn(
      "\nUnable to retrieve Teamwork Graph context:"
    );

    console.warn(
      error.message
    );

  }


  /*
   * Extract linked Jira issue keys.
   */
  const linkedIssues =
    extractLinkedIssues(
      context,
      ticketId
    );


  /*
   * Normalize Jira response.
   */
  return {

    ticketId,

    summary:
      extractJiraSummary(
        jira
      ),

    description:
      extractJiraDescription(
        jira
      ),

    acceptanceCriteria:
      extractAcceptanceCriteria(
        jira
      ),

    status:
      extractJiraStatus(
        jira
      ),

    priority:
      extractJiraPriority(
        jira
      ),

    labels:
      extractJiraLabels(
        jira
      ),

    components:
      extractJiraComponents(
        jira
      ),

    issueType:
      extractJiraIssueType(
        jira
      ),

    assignee:
      extractJiraAssignee(
        jira
      ),

    reporter:
      extractJiraReporter(
        jira
      ),

    created:
      extractJiraCreated(
        jira
      ),

    updated:
      extractJiraUpdated(
        jira
      ),

    resolution:
      extractJiraResolution(
        jira
      ),

    project:
      extractJiraProject(
        jira
      ),

    comments:
      extractJiraComments(
        jira
      ),

    linkedIssues,

    rawJira:
      jira,

    rawContext:
      context

  };

}


/**
 * ============================================================
 * JIRA FIELD HELPERS
 * ============================================================
 */

function extractJiraSummary(
  jira
) {

  return findFirstValue(
    jira,
    [
      "summary",
      "title",
      "name"
    ]
  );

}


function extractJiraDescription(
  jira
) {

  return findFirstValue(
    jira,
    [
      "description"
    ]
  );

}


function extractAcceptanceCriteria(
  jira
) {

  const direct =
    findFirstValue(
      jira,
      [
        "acceptanceCriteria",
        "acceptancecriteria",
        "Acceptance Criteria"
      ]
    );

  if (
    direct !== null &&
    direct !== undefined
  ) {

    return direct;

  }

  return null;
}


function extractJiraStatus(
  jira
) {

  const directStatus =
    findFirstObjectValue(
      jira,
      [
        "status",
        "jiraStatus"
      ]
    );

  if (
    directStatus &&
    typeof directStatus === "object"
  ) {

    if (
      directStatus.name
    ) {

      return directStatus.name;

    }

    if (
      directStatus.statusName
    ) {

      return directStatus.statusName;

    }

  }

  return findFirstValue(
    jira,
    [
      "statusName"
    ]
  );

}


function extractJiraPriority(
  jira
) {

  const priority =
    findFirstObjectValue(
      jira,
      [
        "priority"
      ]
    );

  if (
    priority &&
    typeof priority === "object"
  ) {

    if (
      priority.name
    ) {

      return priority.name;

    }

  }

  return findFirstValue(
    jira,
    [
      "priorityName"
    ]
  );

}


function extractJiraLabels(
  jira
) {

  return findArrayValue(
    jira,
    "labels"
  );

}


function extractJiraComponents(
  jira
) {

  return findArrayValue(
    jira,
    "components"
  );

}


function extractJiraIssueType(
  jira
) {

  const issueType =
    findFirstObjectValue(
      jira,
      [
        "issuetype",
        "issueType"
      ]
    );

  if (
    issueType &&
    typeof issueType === "object"
  ) {

    return (
      issueType.name ??
      null
    );

  }

  return null;
}


function extractJiraAssignee(
  jira
) {

  return findFirstObjectValue(
    jira,
    [
      "assignee"
    ]
  );

}


function extractJiraReporter(
  jira
) {

  return findFirstObjectValue(
    jira,
    [
      "reporter"
    ]
  );

}


function extractJiraCreated(
  jira
) {

  return findFirstValue(
    jira,
    [
      "created",
      "createdAt"
    ]
  );

}


function extractJiraUpdated(
  jira
) {

  return findFirstValue(
    jira,
    [
      "updated",
      "updatedAt"
    ]
  );

}


function extractJiraResolution(
  jira
) {

  return findFirstObjectValue(
    jira,
    [
      "resolution"
    ]
  );

}


function extractJiraProject(
  jira
) {

  return findFirstObjectValue(
    jira,
    [
      "project"
    ]
  );

}


function extractJiraComments(
  jira
) {

  const comment =
    findFirstObjectValue(
      jira,
      [
        "comment"
      ]
    );

  return comment ?? null;

}


/**
 * ============================================================
 * LINKED JIRA ISSUES
 * ============================================================
 */

function extractLinkedIssues(
  context,
  ticketId
) {

  const linked =
    new Set();

  if (!context) {
    return [];
  }

  function walk(
    value
  ) {

    if (!value) {
      return;
    }

    if (
      typeof value === "string"
    ) {

      const matches =
        value.match(
          /[A-Z][A-Z0-9]+-\d+/g
        );

      if (matches) {

        for (
          const match of matches
        ) {

          linked.add(
            match
          );

        }

      }

      return;
    }

    if (
      Array.isArray(value)
    ) {

      for (
        const item of value
      ) {

        walk(item);

      }

      return;
    }

    if (
      typeof value === "object"
    ) {

      for (
        const child
        of Object.values(value)
      ) {

        walk(child);

      }

    }

  }

  walk(context);

  linked.delete(
    ticketId
  );

  return [
    ...linked
  ];

}


export async function getLinkedJiraIssues(
  linkedIssueKeys = []
) {

  if (
    !Array.isArray(
      linkedIssueKeys
    )
  ) {

    return [];

  }

  const linkedIssues = [];

  for (
    const issueKey
    of linkedIssueKeys
  ) {

    try {

      console.log(
        `Loading linked Jira issue: ${issueKey}`
      );

      const issue =
        await getJiraIssue(
          issueKey
        );

      linkedIssues.push(
        issue
      );

    } catch (error) {

      console.warn(
        `Unable to load linked Jira issue ${issueKey}:`,
        error.message
      );

      /*
       * Preserve the relationship instead of silently
       * removing the inaccessible issue.
       */
      linkedIssues.push({

        ticketId:
          issueKey,

        summary:
          null,

        description:
          null,

        acceptanceCriteria:
          null,

        linkedIssues:
          [],

        loadError:
          error.message

      });

    }

  }

  return linkedIssues;

}


/**
 * ============================================================
 * GENERIC VALUE HELPERS
 * ============================================================
 */

function findFirstValue(
  value,
  keys
) {

  if (!value) {
    return null;
  }

  if (
    Array.isArray(value)
  ) {

    for (
      const item of value
    ) {

      const found =
        findFirstValue(
          item,
          keys
        );

      if (
        found !== null &&
        found !== undefined
      ) {

        return found;

      }

    }

    return null;

  }

  if (
    typeof value !== "object"
  ) {

    return null;

  }

  for (
    const key of keys
  ) {

    if (
      value[key] !== undefined &&
      value[key] !== null &&
      typeof value[key] !== "object"
    ) {

      return value[key];

    }

  }

  for (
    const child
    of Object.values(value)
  ) {

    const found =
      findFirstValue(
        child,
        keys
      );

    if (
      found !== null &&
      found !== undefined
    ) {

      return found;

    }

  }

  return null;

}


function findFirstObjectValue(
  value,
  keys
) {

  if (!value) {
    return null;
  }

  if (
    Array.isArray(value)
  ) {

    for (
      const item of value
    ) {

      const found =
        findFirstObjectValue(
          item,
          keys
        );

      if (
        found !== null &&
        found !== undefined
      ) {

        return found;

      }

    }

    return null;

  }

  if (
    typeof value !== "object"
  ) {

    return null;

  }

  for (
    const key of keys
  ) {

    if (
      value[key] !== undefined &&
      value[key] !== null &&
      typeof value[key] === "object"
    ) {

      return value[key];

    }

  }

  for (
    const child
    of Object.values(value)
  ) {

    const found =
      findFirstObjectValue(
        child,
        keys
      );

    if (
      found !== null &&
      found !== undefined
    ) {

      return found;

    }

  }

  return null;

}


function findArrayValue(
  value,
  key
) {

  if (!value) {
    return [];
  }

  if (
    Array.isArray(value)
  ) {

    for (
      const item of value
    ) {

      const found =
        findArrayValue(
          item,
          key
        );

      if (
        found.length > 0
      ) {

        return found;

      }

    }

    return [];

  }

  if (
    typeof value !== "object"
  ) {

    return [];

  }

  if (
    Array.isArray(
      value[key]
    )
  ) {

    return value[key];

  }

  for (
    const child
    of Object.values(value)
  ) {

    const found =
      findArrayValue(
        child,
        key
      );

    if (
      found.length > 0
    ) {

      return found;

    }

  }

  return [];

}


/**
 * ============================================================
 * CONFLUENCE URL EXTRACTION
 * ============================================================
 */

function extractConfluenceUrls(
  value
) {

  const urls =
    new Set();

  function walk(
    current
  ) {

    if (!current) {
      return;
    }

    if (
      typeof current === "string"
    ) {

      const matches =
        current.match(
          /https?:\/\/[^\s<>"')]+/g
        );

      if (matches) {

        for (
          const url of matches
        ) {

          if (
            url.includes("/wiki/") ||
            url.includes("atlassian.net/wiki")
          ) {

            urls.add(
              url.replace(
                /[.,;)]+$/,
                ""
              )
            );

          }

        }

      }

      return;

    }

    if (
      Array.isArray(current)
    ) {

      for (
        const item of current
      ) {

        walk(item);

      }

      return;

    }

    if (
      typeof current === "object"
    ) {

      for (
        const child
        of Object.values(current)
      ) {

        walk(child);

      }

    }

  }

  walk(value);

  return [
    ...urls
  ];

}


/**
 * ============================================================
 * SWMS / CONFLUENCE DOMAIN CONTEXT
 * ============================================================
 *
 * Priority:
 *
 * 1. Explicit Confluence links found in the Jira ticket
 *    or linked Jira issues.
 *
 * 2. Exact linked pages are loaded.
 *
 * 3. Only when no explicit Confluence links exist,
 *    fallback search is performed.
 */

export async function getSwmsDomainContext(
  jira,
  linkedIssues = []
) {

  if (!jira) {
    return [];
  }

  const sources = [
    jira,
    ...linkedIssues
  ];

  const confluenceUrls =
    new Set();

  for (
    const source of sources
  ) {

    const urls =
      extractConfluenceUrls(
        source
      );

    for (
      const url of urls
    ) {

      confluenceUrls.add(
        url
      );

    }

  }

  console.log(
    `Found ${confluenceUrls.size} explicit Confluence URL(s)`
  );

  const pages = [];


  /*
   * ==========================================================
   * PRIORITY 1 — EXACT LINKED PAGES
   * ==========================================================
   */

  for (
    const url of confluenceUrls
  ) {

    try {

      const page =
        await getConfluencePageByUrl(
          url
        );

      pages.push({

        sourceUrl:
          url,

        exactMatch:
          true,

        resolved:
          true,

        content:
          page

      });

    } catch (error) {

      console.warn(
        `Unable to load explicit Confluence URL ${url}:`,
        error.message
      );

      /*
       * Keep the reference visible, but clearly mark it
       * as unresolved. Do not replace it with an unrelated
       * search result.
       */
      pages.push({

        sourceUrl:
          url,

        exactMatch:
          true,

        resolved:
          false,

        content:
          null,

        error:
          error.message

      });

    }

  }


  /*
   * ==========================================================
   * PRIORITY 2 — FALLBACK SEARCH
   * ==========================================================
   *
   * Only search when the Jira/linked issues contain
   * no explicit Confluence URLs at all.
   */

  if (
    confluenceUrls.size === 0 &&
    jira.summary
  ) {

    console.log(
      "No explicit Confluence URL found."
    );

    console.log(
      "Using Jira summary as fallback Confluence search."
    );

    const fallbackPages =
      await getConfluencePages(
        jira.summary
      );

    for (
      const page of fallbackPages
    ) {

      pages.push({

        ...page,

        exactMatch:
          false,

        resolved:
          true

      });

    }

  }

  return pages;

}


/**
 * ============================================================
 * CONFLUENCE SEARCH
 * ============================================================
 */

export async function getConfluencePages(
  query,
  options = {}
) {

  const maxPages =
    Number(options?.maxPages) > 0
      ? Number(options.maxPages)
      : 5;

  if (!query) {
    return [];
  }

  try {

    console.log(
      `\nSearching Atlassian context: ${query}`
    );

    const searchResults =
      await searchAtlassian(
        query
      );

    const pages =
      searchResults?.results || [];

    console.log(
      `Found ${pages.length} Atlassian result(s)`
    );

    const confluencePages = [];

    for (
      const page of pages.slice(0, maxPages)
    ) {

      if (
        page.type !== "page"
      ) {

        continue;

      }

      const match =
        page.id?.match(
          /page\/(\d+)$/
        );

      if (!match) {
        continue;
      }

      const pageId =
        match[1];

      console.log(
        `Fetching Confluence page: ${page.title}`
      );

      const fullPage =
        await getConfluencePage(
          pageId
        );

      if (!fullPage) {
        continue;
      }

      confluencePages.push({

        id:
          pageId,

        title:
          page.title,

        url:
          page.url,

        searchText:
          page.text,

        content:
          fullPage

      });

    }

    return confluencePages;

  } catch (error) {

    console.warn(
      "\nUnable to search/retrieve Confluence:"
    );

    console.warn(
      error.message
    );

    return [];

  }

}


/**
 * ============================================================
 * GET CONFLUENCE PAGE
 * ============================================================
 */

export async function getConfluencePage(
  pageId
) {

  if (!pageId) {
    return null;
  }

  try {

    const mcp =
      await getAtlassianClient();

    const result =
      await mcp.callTool({

        name:
          "getConfluencePage",

        arguments: {

          cloudId,

          pageId

        }

      });

    return extractToolResult(
      result
    );

  } catch (error) {

    console.warn(
      `Unable to fetch Confluence page ${pageId}:`,
      error.message
    );

    return null;

  }

}


/**
 * ============================================================
 * RESOLVE CONFLUENCE SHORT LINK
 * ============================================================
 *
 * Handles links such as:
 *
 * https://syscobt.atlassian.net/wiki/x/NQFAgQE
 *
 * We do NOT use an unauthenticated HTTP redirect because
 * Atlassian may redirect the request to login.
 *
 * Instead, the authenticated Atlassian MCP is used.
 */

async function resolveConfluenceShortLink(
  originalUrl,
  shortCode
) {

  const queries = [
    shortCode,
    `"${originalUrl}"`
  ];

  const candidates = [];

  for (
    const query
    of queries
  ) {

    try {

      const result =
        await searchAtlassian(
          query
        );

      const results =
        Array.isArray(
          result?.results
        )
          ? result.results
          : [];

      candidates.push(
        ...results
      );

    } catch (error) {

      console.warn(
        `Confluence short-link lookup failed for "${query}":`,
        error.message
      );

    }

  }


  /*
   * Deduplicate page candidates by page ID.
   */
  const uniqueCandidates =
    new Map();

  for (
    const candidate
    of candidates
  ) {

    if (
      !candidate ||
      candidate.type !== "page"
    ) {

      continue;

    }

    const pageIdMatch =
      String(
        candidate.id || ""
      ).match(
        /page\/(\d+)$/i
      );

    if (!pageIdMatch) {
      continue;
    }

    const pageId =
      pageIdMatch[1];

    uniqueCandidates.set(
      pageId,
      candidate
    );

  }


  if (
    uniqueCandidates.size === 1
  ) {

    const [
      pageId,
      candidate
    ] =
      [
        ...uniqueCandidates.entries()
      ][0];

    console.log(
      `Resolved Confluence short link ${shortCode} to page ${pageId}`
    );

    return {

      pageId,

      resolvedUrl:
        candidate.url || null,

      candidate

    };

  }


  if (
    uniqueCandidates.size > 1
  ) {

    throw new Error(
      `Confluence short link ${originalUrl} matched multiple pages; refusing to guess.`
    );

  }

  throw new Error(
    `Unable to resolve Confluence short link ${originalUrl} through Atlassian MCP.`
  );

}


/**
 * ============================================================
 * GET CONFLUENCE PAGE BY URL
 * ============================================================
 *
 * Supports:
 *
 * 1. /wiki/spaces/.../pages/123456789/...
 * 2. /wiki/pages/123456789
 * 3. ?pageId=123456789
 * 4. /wiki/x/<short-code>
 */

export async function getConfluencePageByUrl(
  url
) {

  if (!url) {

    throw new Error(
      "Confluence URL is required."
    );

  }


  /*
   * Direct page URLs.
   */
  const pageIdPatterns = [

    /[?&]pageId=(\d+)/i,

    /\/pages\/(\d+)/i,

    /\/page\/(\d+)/i

  ];


  for (
    const pattern
    of pageIdPatterns
  ) {

    const match =
      url.match(
        pattern
      );

    if (!match) {
      continue;
    }

    const pageId =
      match[1];

    console.log(
      `Fetching explicit Confluence page: ${pageId}`
    );

    const page =
      await getConfluencePage(
        pageId
      );

    if (!page) {

      throw new Error(
        `Confluence page ${pageId} could not be loaded.`
      );

    }

    return {

      pageId,

      resolvedUrl:
        url,

      page

    };

  }


  /*
   * Confluence short link.
   */
  const shortLinkMatch =
    url.match(
      /\/wiki\/x\/([A-Za-z0-9_-]+)/i
    );

  if (shortLinkMatch) {

    const shortCode =
      shortLinkMatch[1];

    console.log(
      `Resolving Confluence short link through Atlassian MCP: ${url}`
    );

    const resolved =
      await resolveConfluenceShortLink(
        url,
        shortCode
      );

    const page =
      await getConfluencePage(
        resolved.pageId
      );

    if (!page) {

      throw new Error(
        `Confluence page ${resolved.pageId} was found but could not be loaded.`
      );

    }

    return {

      pageId:
        resolved.pageId,

      resolvedUrl:
        resolved.resolvedUrl || url,

      page

    };

  }


  throw new Error(
    `Unsupported Confluence URL format: ${url}`
  );

}


/**
 * ============================================================
 * GITHUB REPOSITORY NORMALIZATION
 * ============================================================
 */

function normalizeGitHubRepository(
  repository
) {

  if (!repository) {

    throw new Error(
      "GitHub repository is required."
    );

  }

  return repository

    .trim()

    .replace(
      /^https?:\/\/github\.com\//,
      ""
    )

    .replace(
      /\/$/,
      ""
    )

    .replace(
      /\.git$/,
      ""
    );

}


/**
 * ============================================================
 * GITHUB QUERY HELPERS
 * ============================================================
 */

function cleanSearchTerm(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }

  const cleaned =
    String(value)

      .replace(
        /<[^>]+>/g,
        " "
      )

      .replace(
        /https?:\/\/\S+/g,
        " "
      )

      .replace(
        /[\[\]{}()]/g,
        " "
      )

      .replace(
        /[`*_#>|]/g,
        " "
      )

      .replace(
        /\s-\s/g,
        " "
      )

      .replace(
        /\s+/g,
        " "
      )

      .trim();

  if (
    cleaned.length < 2 ||
    cleaned.length > 160
  ) {

    return null;

  }

  return cleaned;

}


function addSearchTerm(
  terms,
  value,
  options = {}
) {

  const cleaned =
    cleanSearchTerm(
      value
    );

  if (!cleaned) {
    return;
  }

  const {
    exact = false
  } = options;

  const blockedTerms = new Set([
    "localid",
    "pageid",
    "spaceid",
    "parentid",
    "parenttype",
    "authorid",
    "ownerid"
  ]);

  if (blockedTerms.has(cleaned.toLowerCase())) {
    return;
  }

  if (/\bswms-newui-pod\d+\b/i.test(cleaned)) {
    return;
  }

  const words =
    cleaned.split(/\s+/).filter(Boolean);

  const lowSignalLeadingWords = new Set([
    "and",
    "or",
    "to",
    "up",
    "of",
    "for",
    "in",
    "on",
    "by",
    "the",
    "story",
    "details",
    "summary"
  ]);

  if (words.length && lowSignalLeadingWords.has(words[0].toLowerCase())) {
    return;
  }

  if (words.length <= 2) {
    const lowered = cleaned.toLowerCase();

    if (
      lowered === "up tasking" ||
      lowered === "and tasking" ||
      lowered === "function screen" ||
      lowered === "story details"
    ) {
      return;
    }
  }

  if (
    words.length > 10
  ) {
    return;
  }

  if (
    /^[A-Z][A-Z0-9]+-\d+$/i.test(cleaned)
  ) {
    return;
  }

  if (
    /^(summary|description|acceptance criteria|user story details|references|definition of done|remarks|as a|so that)$/i
      .test(cleaned)
  ) {

    return;

  }

  terms.push({

    value:
      cleaned,

    exact:
      exact && words.length <= 6

  });

}


/**
 * ============================================================
 * EXTRACT IMPLEMENTATION IDENTIFIERS
 * ============================================================
 *
 * Finds likely code-level terms such as:
 *
 * TASKING_FUNCTION
 * taskingFunctionId
 * WHMF0001
 * GET /api/tasking/functions
 */

function extractImplementationIdentifiers(
  text
) {

  if (!text) {
    return [];
  }

  const identifiers =
    new Set();

  const patterns = [

    /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/g,

    /\b[A-Za-z][A-Za-z0-9]*(?:Id|ID|Code|Number|No|Type|Flag|Status|Name)\b/g,

    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[A-Za-z0-9_./:{}?=&-]+/g,

    /\b(?:api|API)\/[A-Za-z0-9_./:{}?=&-]+/g

  ];

  for (
    const pattern
    of patterns
  ) {

    const matches =
      text.match(
        pattern
      ) || [];

    for (
      const match
      of matches
    ) {

      const cleaned =
        cleanSearchTerm(
          match
        );

      if (cleaned) {

        const lower = cleaned.toLowerCase();

        if (
          lower === "localid" ||
          lower === "pageid" ||
          lower === "spaceid" ||
          lower === "parentid" ||
          lower === "parenttype" ||
          lower === "authorid" ||
          lower === "ownerid"
        ) {
          continue;
        }

        identifiers.add(
          cleaned
        );

      }

    }

  }

  return [
    ...identifiers
  ];

}


/**
 * ============================================================
 * EXTRACT IMPLEMENTATION PHRASES
 * ============================================================
 */

function extractImplementationPhrases(
  text
) {

  if (!text) {
    return [];
  }

  const phrases =
    new Set();

  const patterns = [

    /\b[A-Za-z][A-Za-z0-9&/+.-]{1,50}\s+(?:Function|Functions|Type|Types|Header|Detail|Details|Route|Routes|Task|Tasking|Reader|Writer|Manifest|Record|Records|Flag|Status|Code|Number|Validation|Search|Screen|Menu)\b/gi,

    /\b(?:create|update|delete|save|search|validate|assign|remove|add|edit)\s+[A-Za-z][A-Za-z0-9&/+.-]*(?:\s+[A-Za-z][A-Za-z0-9&/+.-]*){0,5}/gi

  ];

  for (
    const pattern
    of patterns
  ) {

    const matches =
      text.match(
        pattern
      ) || [];

    for (
      const match
      of matches
    ) {

      const cleaned =
        cleanSearchTerm(
          match
        );

      if (
        cleaned &&
        cleaned.length <= 100
      ) {

        phrases.add(
          cleaned
        );

      }

    }

  }

  return [
    ...phrases
  ];

}


/**
 * ============================================================
 * BUILD TARGETED GITHUB QUERIES
 * ============================================================
 *
 * GitHub is used as an accuracy gate.
 *
 * We do NOT search every sentence from the Jira/Confluence
 * documents.
 *
 * We search high-value terms that can establish:
 *
 * - actual UI labels
 * - field names
 * - constants
 * - enums
 * - API routes
 * - validation/error messages
 * - SQL/table/column terminology
 * - implementation symbols
 */

export function buildGitHubImplementationQueries(
  jira,
  linkedIssues = [],
  domainContext = [],
  options = {}
) {

  const {
    maxQueries = 20
  } = options;

  const terms = [];


  /*
   * Primary feature name.
   */
  addSearchTerm(
    terms,
    jira?.summary,
    {
      exact: true
    }
  );


  /*
   * Labels.
   */
  for (
    const label
    of jira?.labels || []
  ) {

    addSearchTerm(
      terms,
      label
    );

  }


  /*
   * Components.
   */
  for (
    const component
    of jira?.components || []
  ) {

    if (
      typeof component === "string"
    ) {

      addSearchTerm(
        terms,
        component
      );

    } else {

      addSearchTerm(
        terms,
        component?.name
      );

    }

  }


  /*
   * Jira + linked issue content.
   */
  const jiraText =
    [

      jira?.summary,

      jira?.description,

      jira?.acceptanceCriteria,

      ...(linkedIssues || []).flatMap(
        issue => [

          issue?.summary,

          issue?.description,

          issue?.acceptanceCriteria

        ]
      )

    ]

      .filter(Boolean)

      .join("\n");


  /*
   * Successfully loaded Confluence content only.
   */
  const confluenceText =
    (domainContext || [])

      .filter(
        page =>
          page &&
          page.resolved !== false &&
          (
            page.title ||
            page.searchText
          )
      )

      .map(page =>
        [
          page.title,
          page.searchText
        ]
          .filter(Boolean)
          .join("\n")
      )

      .join("\n");


  const allText =
    `${jiraText}\n${confluenceText}`;


  /*
   * Exact-looking implementation identifiers first.
   */
  for (
    const identifier
    of extractImplementationIdentifiers(
      allText
    )
  ) {

    addSearchTerm(
      terms,
      identifier,
      {
        exact: true
      }
    );

  }


  /*
   * Then concise implementation/business phrases.
   */
  for (
    const phrase
    of extractImplementationPhrases(
      allText
    )
  ) {

    addSearchTerm(
      terms,
      phrase
    );

  }


  /*
   * Deduplicate while preserving priority.
   */
  const seen =
    new Set();

  const queries = [];

  for (
    const term
    of terms
  ) {

    const key =
      term.value.toLowerCase();

    if (
      seen.has(key)
    ) {

      continue;

    }

    seen.add(
      key
    );

    queries.push(
      term
    );

    if (
      queries.length >= maxQueries
    ) {

      break;

    }

  }

  return queries;

}


/**
 * ============================================================
 * GITHUB REPOSITORY-SCOPED QUERY
 * ============================================================
 */

function buildRepositoryScopedQuery(
  query,
  repository
) {

  const cleaned =
    String(query)
      .replace(/[\[\]{}()]+/g, " ")
      .replace(/[,:;]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const escapedRepository =
    repository.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const repositoryPattern =
    new RegExp(
      `(?:^|\\s)repo:${escapedRepository}(?:\\s|$)`,
      "i"
    );

  if (
    repositoryPattern.test(
      cleaned
    )
  ) {

    return cleaned;

  }

  return `${cleaned} repo:${repository}`;

}


/**
 * ============================================================
 * GITHUB CODE SEARCH
 * ============================================================
 */

export async function searchGitHub(
  query,
  repository
) {

  if (!query) {

    throw new Error(
      "GitHub search query is required."
    );

  }

  const normalizedRepository =
    normalizeGitHubRepository(
      repository
    );

  const github =
    await getGitHubClient();

  const scopedQuery =
    buildRepositoryScopedQuery(
      query,
      normalizedRepository
    );

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= 3;
    attempt++
  ) {
    try {
      const result =
        await github.callTool({

          name:
            "search_code",

          arguments: {

            query:
              scopedQuery,

            perPage:
              20

          }

        });

      return extractToolResult(
        result
      );

    } catch (error) {
      lastError = error;

      const message = String(
        error?.message || error
      );

      const retryMatch =
        message.match(
          /retry after\s*(\d+)s/i
        );

      if (
        attempt < 3 &&
        retryMatch
      ) {
        const retrySeconds =
          Math.max(
            Number(retryMatch[1]) || 1,
            1
          );

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              (retrySeconds + 1) * 1000
            )
        );

        continue;
      }

      if (attempt < 3) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              1500 * attempt
            )
        );

        continue;
      }
    }
  }

  throw (
    lastError ||
    new Error("GitHub search failed.")
  );

}


/**
 * ============================================================
 * SEARCH GITHUB IMPLEMENTATION
 * ============================================================
 */

export async function searchGitHubImplementation(
  jira,
  linkedIssues = [],
  domainContext = [],
  repository,
  options = {}
) {

  const queries =
    buildGitHubImplementationQueries(
      jira,
      linkedIssues,
      domainContext,
      options
    );

  const evidence = [];

  for (
    const query
    of queries
  ) {

    try {

      console.log(
        `Searching GitHub implementation: ${query.value}`
      );

      const result =
        await searchGitHub(

          query.exact
            ? `"${query.value}"`
            : query.value,

          repository

        );

      evidence.push({

        query:
          query.value,

        exact:
          query.exact,

        result

      });

    } catch (error) {

      console.warn(
        `GitHub implementation search failed for "${query.value}":`,
        error.message
      );

      evidence.push({

        query:
          query.value,

        exact:
          query.exact,

        result:
          null,

        error:
          error.message

      });

    }

  }

  return {

    queries,

    evidence

  };

}


/**
 * ============================================================
 * EXTRACT GITHUB IMPLEMENTATION NAMES
 * ============================================================
 */

export function extractGitHubImplementationNames(
  searchResult
) {

  const names =
    new Set();

  function walk(
    value
  ) {

    if (!value) {
      return;
    }

    if (
      typeof value === "string"
    ) {

      const patterns = [

        /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/g,

        /\b[A-Za-z][A-Za-z0-9]*(?:Service|Controller|Repository|Client|Mapper|Handler|Validator|Reader|Writer|Util|Constants)\b/g,

        /(?:^|\/)([A-Za-z0-9_.-]+\.(?:java|js|ts|tsx|jsx|sql|xml|json))\b/g,

        /\/api\/[A-Za-z0-9_./:{}?=&-]+/g

      ];

      for (
        const pattern
        of patterns
      ) {

        const matches =
          value.match(
            pattern
          ) || [];

        for (
          const match
          of matches
        ) {

          const cleaned =
            cleanSearchTerm(
              match
            );

          if (cleaned) {

            names.add(
              cleaned
            );

          }

        }

      }

      return;

    }

    if (
      Array.isArray(value)
    ) {

      for (
        const item
        of value
      ) {

        walk(item);

      }

      return;

    }

    if (
      typeof value === "object"
    ) {

      for (
        const child
        of Object.values(value)
      ) {

        walk(child);

      }

    }

  }

  walk(
    searchResult
  );

  return [
    ...names
  ];

}


/**
 * ============================================================
 * GITHUB COMMIT SEARCH
 * ============================================================
 */

export async function searchGitHubCommits(
  query,
  repository
) {

  if (!query) {

    throw new Error(
      "GitHub commit search query is required."
    );

  }

  const normalizedRepository =
    normalizeGitHubRepository(
      repository
    );

  const github =
    await getGitHubClient();

  const result =
    await github.callTool({

      name:
        "search_commits",

      arguments: {

        query:
          buildRepositoryScopedQuery(
            query,
            normalizedRepository
          ),

        perPage:
          30

      }

    });

  return extractToolResult(
    result
  );

}


/**
 * ============================================================
 * GITHUB FILE CONTENTS
 * ============================================================
 *
 * DO NOT GUESS THE MCP TOOL ARGUMENTS.
 *
 * QANEX.agent.md requires get_file_contents when a matched
 * source file needs to be inspected, but the exact MCP schema
 * must first be confirmed from testGitHubMcp().
 *
 * Once confirmed, replace this function with the exact call.
 */

export async function getGitHubFileContents(
  repository,
  path,
  ref = undefined
) {
  if (!repository) {
    throw new Error(
      "GitHub repository is required."
    );
  }

  if (!path) {
    throw new Error(
      "GitHub file path is required."
    );
  }

  const github =
    await getGitHubClient();

  const normalizedRepository =
    normalizeGitHubRepository(
      repository
    );

  const [owner, repo] =
    normalizedRepository.split("/");

  if (!owner || !repo) {
    throw new Error(
      `Invalid GitHub repository: ${repository}`
    );
  }

  const tools =
    await github.listTools();

  const fileTool =
    tools.tools.find(tool =>
      /get[_-]?file[_-]?contents/i.test(
        tool.name
      )
    );

  if (!fileTool) {
    throw new Error(
      "GitHub MCP get_file_contents tool is not available."
    );
  }

  const properties =
    fileTool.inputSchema?.properties ||
    fileTool.inputSchema?.json?.properties ||
    {};

  const args = {};

  if (properties.owner) {
    args.owner = owner;
  }

  if (properties.repo) {
    args.repo = repo;
  }

  if (properties.repository) {
    args.repository =
      normalizedRepository;
  }

  if (properties.path) {
    args.path = path;
  }

  if (properties.filePath) {
    args.filePath = path;
  }

  if (properties.ref && ref) {
    args.ref = ref;
  }

  if (properties.branch && ref) {
    args.branch = ref;
  }

  if (properties.sha && ref) {
    args.sha = ref;
  }

  console.log(
    `Reading GitHub file: ${normalizedRepository}/${path}`
  );

  const result =
    await github.callTool({
      name: fileTool.name,
      arguments: args
    });

  return extractToolResult(result);
}

function isLikelyGitHubSourcePath(
  value
) {

  if (
    typeof value !== "string"
  ) {
    return false;
  }


  const path =
    value.trim();


  if (!path) {
    return false;
  }


  /*
   * Must contain a filename extension.
   */
  if (
    !/\.[A-Za-z0-9]{1,12}$/.test(
      path
    )
  ) {
    return false;
  }


  /*
   * Reject obvious Jira/requirement identifiers.
   */
  if (
    /^AC\d+(?:\.\d+)*$/i.test(
      path
    )
  ) {
    return false;
  }


  if (
    /^[A-Z][A-Z0-9]+-\d+$/.test(
      path
    )
  ) {
    return false;
  }


  /*
   * Only allow realistic repository file types.
   */
  const allowedExtensions = [
    "java",
    "js",
    "jsx",
    "ts",
    "tsx",
    "json",
    "xml",
    "yaml",
    "yml",
    "sql",
    "properties",
    "html",
    "css",
    "scss",
    "md"
  ];


  const extension =
    path
      .split(".")
      .pop()
      .toLowerCase();


  if (
    !allowedExtensions.includes(
      extension
    )
  ) {
    return false;
  }


  /*
   * A real repository path normally contains
   * either a directory or a recognizable filename.
   */
  return (
    path.includes("/") ||
    /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/.test(
      path
    )
  );

}

export function extractGitHubFilePaths(value) {

  const paths = new Set();

  function addPath(value) {

  if (
    typeof value !== "string"
  ) {
    return;
  }


  const text =
    value
      .trim()
      .replace(/^\/+/, "");


  if (!text) {
    return;
  }


  /*
   * Never interpret Jira AC identifiers,
   * ticket IDs, URLs or search phrases as files.
   */
  if (
    /^AC\d+(?:\.\d+)*$/i.test(text) ||
    /^[A-Z][A-Z0-9]+-\d+$/.test(text) ||
    text.includes("://")
  ) {
    return;
  }


  /*
   * Handle GitHub blob URLs.
   */
  if (
    /^https?:\/\//i.test(text)
  ) {

    try {

      const url =
        new URL(text);

      const parts =
        url.pathname
          .split("/")
          .filter(Boolean);

      const blobIndex =
        parts.indexOf("blob");

      if (
        blobIndex >= 0 &&
        parts.length >
          blobIndex + 2
      ) {

        const path =
          parts
            .slice(
              blobIndex + 2
            )
            .join("/");

        if (
          isLikelyGitHubSourcePath(
            path
          )
        ) {

          paths.add(path);

        }

      }

    } catch {}

    return;
  }


  /*
   * Only accept actual source/config files.
   */
  if (
    isLikelyGitHubSourcePath(
      text
    )
  ) {

    paths.add(text);

  }

}

  function walk(item) {

    if (
      item === null ||
      item === undefined
    ) {
      return;
    }

    if (
      typeof item === "string"
    ) {
      addPath(item);
      return;
    }

    if (
      Array.isArray(item)
    ) {

      for (
        const child of item
      ) {

        walk(child);

      }

      return;
    }

    if (
      typeof item === "object"
    ) {

      for (
        const [
          key,
          child
        ] of Object.entries(item)
      ) {

        const lowerKey =
          key.toLowerCase();

        /*
         * These are the fields most likely
         * to contain repository file paths.
         */
        if (
          lowerKey === "path" ||
          lowerKey === "filepath" ||
          lowerKey === "file_path" ||
          lowerKey === "filename" ||
          lowerKey === "name" ||
          lowerKey === "url" ||
          lowerKey === "html_url" ||
          lowerKey === "htmlurl"
        ) {

          addPath(child);

        }

        walk(child);
      }
    }
  }

  walk(value);

  return [
    ...paths
  ];
}

/**
 * ============================================================
 * FUTURE QANEX FUNCTIONS
 * ============================================================
 */

export async function searchQMetryCases(query) {
  if (!query) {
    throw new Error(
      "QMetry search query is required."
    );
  }

  const qmetry =
    await getQMetryClient();

  const result =
    await qmetry.callTool({
      name: "search_test_cases",
      arguments: {
        query
      }
    });

  return extractToolResult(result);
}


export async function getQMetryCaseDetails(
  testCaseId
) {
  if (!testCaseId) {
    throw new Error(
      "QMetry test case ID is required."
    );
  }

  const qmetry =
    await getQMetryClient();

  const result =
    await qmetry.callTool({
      name: "get_test_case_details",
      arguments: {
        testCaseId
      }
    });

  return extractToolResult(result);
}

export async function getQMetryCaseRequirements(
  testCaseId
) {
  if (!testCaseId) {
    throw new Error(
      "QMetry test case ID is required."
    );
  }

  const qmetry =
    await getQMetryClient();

  const result =
    await qmetry.callTool({
      name: "get_test_case_requirements",
      arguments: {
        testCaseId
      }
    });

  return extractToolResult(result);
}

export async function getQMetryDomainContext() {
  const qmetry =
    await getQMetryClient();

  const result =
    await qmetry.callTool({
      name: "get_swms_domain_context",
      arguments: {}
    });

  return extractToolResult(result);
}

export async function generateTestCases() {

  throw new Error(
    "Not implemented yet"
  );

}


export async function exportExcel() {

  throw new Error(
    "Not implemented yet"
  );

}