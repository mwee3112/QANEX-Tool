const SAGE_RAW_PREDICT_URL =
  process.env.SAGE_RAW_PREDICT_URL ||
  "https://sage.paastry.sysco.net/api/sysco-gen-ai-platform/agents/v1/content/6a9d54ca8f549f3fcef8b291/DEV/raw-predict%22;

const SAGE_ANTHROPIC_RAW_PREDICT_URL =
  process.env.SAGE_ANTHROPIC_RAW_PREDICT_URL ||
  "https://sage-stg.paastry.sysco.net/api/sysco-gen-ai-platform/agents/v1/content/68516818616beb42263637ec/dev/direct-raw-predict%22;

const SAGE_ANTHROPIC_MAX_TOKENS =
  Number(process.env.SAGE_ANTHROPIC_MAX_TOKENS) || 16384;

const SAGE_DEFAULT_BEARER = "<your-token-here>";

function isAnthropicModel(model) {
  return /^claude/i.test(String(model || "").trim());
}

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

function normalizeBearerToken(anthropic = false) {
  const configured =
    (anthropic && process.env.SAGE_ANTHROPIC_BEARER_TOKEN) ||
    process.env.SAGE_BEARER_TOKEN ||
    process.env.SAGE_AUTH_TOKEN ||
    SAGE_DEFAULT_BEARER;

  const token = String(configured || "").trim();

  if (!token) {
    return SAGE_DEFAULT_BEARER;
  }

  return token.startsWith("Bearer ")
    ? token.slice("Bearer ".length)
    : token;
}

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

  return text.replace(/\\(?=[^"\\/bfnrtu])/g, "");
}

function parseMaybeJson(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = sanitizeJsonText(value);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Try extracting the JSON object from surrounding text.
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // Ignore and continue.
    }
  }

  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");

  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    } catch {
      // Ignore and continue.
    }
  }

  return null;
}

function extractCandidateText(candidate) {
  const parts =
    candidate?.content?.parts ||
    candidate?.parts ||
    [];

  const text = parts
    .map(part => {
      if (typeof part?.text === "string") {
        return part.text;
      }

      if (typeof part === "string") {
        return part;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");

  return text.trim();
}

function extractTextFromSageResponse(payload) {
  if (typeof payload === "string") {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return clean(payload);
  }

  if (
    payload.success === true &&
    Array.isArray(payload?.data?.content) &&
    payload.data.content.length > 0
  ) {
    const extractedParts = payload.data.content
      .map(item => {
        if (typeof item === "string") {
          try {
            const parsed = JSON.parse(item);

            if (typeof parsed?.answer === "string") {
              return parsed.answer;
            }
          } catch {
            return item;
          }

          return item;
        }

        if (item && typeof item === "object") {
          const nested =
            item.answer ??
            item.text ??
            item.content ??
            item.value ??
            item.output_text;

          if (typeof nested === "string") {
            return nested;
          }

          return clean(item);
        }

        return "";
      })
      .filter(Boolean);

    if (extractedParts.length > 0) {
      return extractedParts.join("\n");
    }
  }

  if (typeof payload.answer === "string") {
    const parsed = parseMaybeJson(payload.answer);

    if (typeof parsed === "string") {
      return parsed;
    }

    if (parsed && typeof parsed === "object") {
      const nested =
        parsed.answer ??
        parsed.text ??
        parsed.content ??
        parsed.value ??
        parsed.output_text;

      if (typeof nested === "string") {
        return nested;
      }
    }

    return payload.answer;
  }

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  if (payload.answer && typeof payload.answer === "object") {
    const nested =
      payload.answer.answer ??
      payload.answer.text ??
      payload.answer.content ??
      payload.answer.value;

    if (typeof nested === "string") {
      return nested;
    }
  }

  if (Array.isArray(payload.candidates) && payload.candidates.length > 0) {
    const text = extractCandidateText(payload.candidates[0]);

    if (text) {
      return text;
    }
  }

  if (Array.isArray(payload.predictions) && payload.predictions.length > 0) {
    const first = payload.predictions[0];

    if (typeof first?.answer === "string") {
      return first.answer;
    }

    const text = extractCandidateText(first);

    if (text) {
      return text;
    }

    if (typeof first === "string") {
      return first;
    }

    if (first && typeof first === "object") {
      return clean(first);
    }
  }

  const directText = extractCandidateText(payload);

  if (directText) {
    return directText;
  }

  return clean(payload);
}

function findAnthropicMessage(payload) {
  const candidates = [
    payload,
    payload?.data,
    payload?.data?.data,
    payload?.data?.response,
    payload?.response,
    payload?.result
  ];

  return candidates.find(
    candidate =>
      candidate &&
      typeof candidate === "object" &&
      (Array.isArray(candidate.content) ||
        typeof candidate.content === "string") &&
      (candidate.type === "message" ||
        candidate.role === "assistant" ||
        "stop_reason" in candidate)
  ) || null;
}

function extractTextFromAnthropicResponse(payload) {
  const message = findAnthropicMessage(payload);

  if (!message) {
    return extractTextFromSageResponse(payload);
  }

  if (message.stop_reason === "max_tokens") {
    console.warn(
      `[SAGE] Anthropic response was truncated at max_tokens (${SAGE_ANTHROPIC_MAX_TOKENS}).`
    );
  }

  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter(block => block?.type === "text" && typeof block.text === "string")
    .map(block => block.text)
    .join("\n")
    .trim();
}

function buildGeminiPayload({
  systemInstruction,
  prompt,
  llmModelName,
  llmGenerationConfig,
  safetySettings
}) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              String(systemInstruction || "You are a helpful assistant.")
          }
        ]
      },
      {
        role: "user",
        parts: [
          {
            text: String(prompt || "")
          }
        ]
      }
    ],
    llm_generation_config: {
      temperature: 0.1,
      top_p: 1.0,
      top_k: 40,
      candidate_count: 1,
      max_output_tokens: 16384,
      frequency_penalty: 0.0,
      presence_penalty: 0.0,
      thinking_config: {
        thinking_budget: 100
      },
      stop_sequences: [
        "END"
      ],
      response_logprobs: false,
      response_mime_type: "application/json",
      response_schema: {
        type: "object",
        properties: {
          answer: {
            type: "string"
          }
        }
      },
      ...(llmGenerationConfig || {})
    },
    safety_settings:
      safetySettings || [
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ],
    llm_model_name: llmModelName,
    location: "global"
  };
}

function buildAnthropicPayload({
  systemInstruction,
  prompt,
  llmModelName,
  llmGenerationConfig
}) {
  return {
    data: {
      model: llmModelName,
      max_tokens:
        llmGenerationConfig?.max_output_tokens ||
        SAGE_ANTHROPIC_MAX_TOKENS,
      temperature:
        llmGenerationConfig?.temperature ?? 0.1,
      system:
        String(systemInstruction || "You are a helpful assistant."),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: String(prompt || "")
            }
          ]
        }
      ],
      stream: false
    }
  };
}

export async function callSageRawPredict({
  systemInstruction,
  prompt,
  timeoutMs = 1800000,
  maxAttempts = 2,
  llmModelName,
  llmGenerationConfig,
  safetySettings
}) {
  let lastError = null;

  const model =
    llmModelName ||
    process.env.SAGE_LLM_MODEL ||
    "gemini-3.5-flash";

  const anthropic = isAnthropicModel(model);

  const url = anthropic
    ? SAGE_ANTHROPIC_RAW_PREDICT_URL
    : SAGE_RAW_PREDICT_URL;

  const payload = anthropic
    ? buildAnthropicPayload({
        systemInstruction,
        prompt,
        llmModelName: model,
        llmGenerationConfig
      })
    : buildGeminiPayload({
        systemInstruction,
        prompt,
        llmModelName: model,
        llmGenerationConfig,
        safetySettings
      });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "User-Agent": process.env.SAGE_USER_AGENT || "insomnium/1.3.0",
          "Authorization": `Bearer ${normalizeBearerToken(anthropic)}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const rawBody = await response.text();

      if (!response.ok) {
        throw new Error(`SAGE HTTP ${response.status}: ${rawBody}`);
      }

      let parsedBody = null;

      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }

      return anthropic
        ? extractTextFromAnthropicResponse(parsedBody)
        : extractTextFromSageResponse(parsedBody);
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("SAGE raw-predict call failed.");
}