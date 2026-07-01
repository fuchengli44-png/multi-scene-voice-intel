const OPENAI_API_BASE = "https://api.openai.com/v1";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  setCors(res);
  res.status(status).json(payload);
}

function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    res.status(204).end();
    return true;
  }
  return false;
}

function assertPost(req) {
  if (req.method !== "POST") {
    const error = new Error("Method not allowed.");
    error.statusCode = 405;
    throw error;
  }
}

function assertApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    const error = new Error("OPENAI_API_KEY is not configured in Vercel environment variables.");
    error.statusCode = 500;
    throw error;
  }
}

async function analyze(body) {
  const mode = typeof body.mode === "string" ? body.mode : "meeting";
  const inputText = typeof body.inputText === "string" ? body.inputText : "";
  const model = typeof body.model === "string" && body.model ? body.model : "gpt-5.5";
  const correctionRules = Array.isArray(body.correctionRules) ? body.correctionRules : [];

  if (!inputText.trim()) {
    throw new Error("No inputText provided.");
  }

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You are a Chinese-Japanese industrial intelligence analysis engine. Return valid JSON only."
        },
        {
          role: "user",
          content: buildAnalysisPrompt(mode, inputText, correctionRules)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await readOpenAIError(response, "OpenAI analysis failed"));
  }

  const data = await response.json();
  const text = extractOutputText(data);
  if (!text) {
    throw new Error("OpenAI returned no output text.");
  }

  return parseJson(text);
}

async function transcribe(body) {
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
  const mode = typeof body.mode === "string" ? body.mode : "meeting";
  const model = typeof body.model === "string" && body.model ? body.model : "gpt-4o-transcribe";

  if (!audioBase64) {
    throw new Error("No audioBase64 provided.");
  }

  const extension = mimeType.includes("mp4")
    ? "m4a"
    : mimeType.includes("mpeg") || mimeType.includes("mp3")
      ? "mp3"
      : mimeType.includes("wav")
        ? "wav"
        : "webm";
  const audioBuffer = Buffer.from(audioBase64, "base64");
  const audioBlob = new Blob([audioBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("file", audioBlob, `recording-${mode}.${extension}`);
  formData.append("model", model);
  formData.append("language", mode === "intel" ? "zh" : "ja");

  const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readOpenAIError(response, "OpenAI transcription failed"));
  }

  return response.json();
}

async function learnRecording(body) {
  const inputText = typeof body.inputText === "string" ? body.inputText : "";
  const model = typeof body.model === "string" && body.model ? body.model : "gpt-5.5";
  const correctionRules = Array.isArray(body.correctionRules) ? body.correctionRules : [];

  if (!inputText.trim()) {
    throw new Error("No inputText provided.");
  }

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "You extract reusable terminology, expression corrections, and industrial intelligence from Chinese-Japanese recordings. Return valid JSON only."
        },
        {
          role: "user",
          content: buildRecordingLearningPrompt(inputText, correctionRules)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await readOpenAIError(response, "OpenAI recording learning failed"));
  }

  const data = await response.json();
  const text = extractOutputText(data);
  if (!text) {
    throw new Error("OpenAI returned no learning output text.");
  }

  return parseJson(text);
}

function buildAnalysisPrompt(mode, inputText, correctionRules = []) {
  const correctionContext = buildCorrectionContext(correctionRules);
  const inputWithCorrections = `${inputText}

User correction rules to obey:
${correctionContext}`;

  if (mode === "meeting") {
    return `Analyze this Chinese/Japanese industrial meeting transcript. Use Chinese for summaries and Japanese where appropriate. Return JSON only:
{
  "title": "meeting title",
  "meeting": {
    "title": "meeting title",
    "keyFindings": ["key finding"],
    "segments": [
      {
        "id": "seg-1",
        "speaker": "Japanese engineer A / customer B / you",
        "language": "ja|zh|mixed",
        "originalText": "original utterance",
        "normalizedText": "standard business Japanese or normalized expression",
        "oralChinese": "plain Chinese",
        "engineeringChinese": "engineering meeting Chinese"
      }
    ],
    "actionItems": [
      {
        "id": "action-1",
        "owner": "owner",
        "task": "task",
        "dueHint": "due hint",
        "status": "待跟进"
      }
    ]
  }
}

Transcript:
${inputWithCorrections}`;
  }

  if (mode === "language") {
    return `Act as a Japanese expression coach for Chinese-Japanese industrial business. Return JSON only:
{
  "title": "日语表达优化",
  "language": {
    "originalJapanese": "original Japanese",
    "businessJapanese": "polished business Japanese",
    "oralChinese": "plain Chinese",
    "engineeringChinese": "engineering Chinese",
    "pronunciationTips": [
      {"phrase": "term", "reading": "reading or romaji", "suggestion": "pronunciation advice"}
    ],
    "expressionUpgrades": ["upgrade advice"],
    "industryTerms": [
      {
        "id": "term-1",
        "japanese": "Japanese term",
        "chinese": "Chinese term",
        "domain": "OLED",
        "explanation": "explanation",
        "recommendedExpression": "recommended expression"
      }
    ]
  }
}

Text:
${inputWithCorrections}`;
  }

  return `Extract only useful technical or commercial intelligence from this informal conversation. Ignore small talk. Return JSON only:
{
  "title": "非正式情报提取",
  "intel": [
    {
      "id": "intel-1",
      "type": "技术信息|人事信息|价格信息|客户动向|竞争情报",
      "sourceScene": "酒局 / 高尔夫 / 客户交流 / 公开讲座 / 未知",
      "content": "intelligence content",
      "confidence": "高|中|低",
      "companies": ["company"],
      "suggestedAction": "recommended follow-up"
    }
  ]
}

Text:
${inputWithCorrections}`;
}

function buildRecordingLearningPrompt(inputText, correctionRules = []) {
  return `Extract reusable learning assets from this Chinese/Japanese industrial recording transcript.

Focus on terminology, Japanese expression upgrades, translation preferences, speaker hints, and industry intelligence.

Existing correction rules:
${buildCorrectionContext(correctionRules)}

Return valid JSON only:
{
  "title": "recording learning title",
  "terms": [
    {
      "id": "term-...",
      "japanese": "Japanese term or expression",
      "chinese": "Chinese equivalent",
      "domain": "OLED|半导体|材料|光学|AI|商务表达|制程",
      "explanation": "why it matters",
      "recommendedExpression": "meeting-ready Japanese expression"
    }
  ],
  "corrections": [
    {
      "kind": "term|speaker|expression|translation|intel_confidence",
      "original": "original wording or model error",
      "corrected": "preferred wording",
      "note": "when to apply"
    }
  ],
  "intel": [
    {
      "id": "intel-...",
      "type": "技术信息|人事信息|价格信息|客户动向|竞争情报",
      "sourceScene": "录音投喂 / 会议 / 公开讲座",
      "content": "intelligence content",
      "confidence": "高|中|低",
      "companies": ["company or institution"],
      "suggestedAction": "follow-up action"
    }
  ]
}

Transcript:
${inputText}`;
}

function buildCorrectionContext(correctionRules) {
  const rules = correctionRules
    .filter((rule) => typeof rule?.original === "string" && typeof rule?.corrected === "string")
    .slice(0, 30);

  if (!rules.length) {
    return "No user correction rules yet.";
  }

  return rules
    .map((rule, index) => {
      const kind = typeof rule.kind === "string" ? rule.kind : "unknown";
      const note = typeof rule.note === "string" ? rule.note : "";
      return `${index + 1}. [${kind}] "${rule.original}" => "${rule.corrected}". Note: ${note}`;
    })
    .join("\n");
}

function parseJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("OpenAI response was not valid JSON.");
    }
    return JSON.parse(match[0]);
  }
}

function extractOutputText(data) {
  if (typeof data?.output_text === "string") {
    return data.output_text;
  }
  return data?.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .join("\n");
}

async function readOpenAIError(response, fallback) {
  try {
    const body = await response.json();
    return body?.error?.message ?? `${fallback}: HTTP ${response.status}`;
  } catch {
    return `${fallback}: HTTP ${response.status}`;
  }
}

function handleError(res, error) {
  const status = Number(error?.statusCode) || 500;
  const message = error instanceof Error ? error.message : "API error.";
  sendJson(res, status, { error: { message } });
}

module.exports = {
  analyze,
  assertApiKey,
  assertPost,
  handleError,
  handleOptions,
  learnRecording,
  sendJson,
  transcribe
};
