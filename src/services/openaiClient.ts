import { analyzeLanguage, analyzeMeeting, extractIntel } from "./analysisEngine";
import {
  CorrectionRule,
  IntelItem,
  KnowledgeTerm,
  LanguageFeedback,
  MeetingSummary,
  SceneMode,
  Session
} from "../types";

const OPENAI_API_BASE = "https://api.openai.com/v1";

export interface OpenAIConfig {
  apiKey: string;
  model: string;
  transcriptionModel: string;
  proxyUrl: string;
}

export interface OpenAIAnalysisResult {
  title: string;
  meeting?: MeetingSummary;
  language?: LanguageFeedback;
  intel?: IntelItem[];
}

export interface RecordingLearningResult {
  title: string;
  terms: KnowledgeTerm[];
  corrections: Array<Pick<CorrectionRule, "kind" | "original" | "corrected" | "note">>;
  intel: IntelItem[];
}

const nowText = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};

export function hasConfiguredOpenAI(config: OpenAIConfig) {
  return Boolean(config.apiKey.trim() || config.proxyUrl.trim());
}

export async function transcribeAudioBlob(audioBlob: Blob, mode: SceneMode, config: OpenAIConfig) {
  const proxyUrl = normalizeProxyUrl(config.proxyUrl);

  if (!config.apiKey.trim() && proxyUrl) {
    const response = await fetch(`${proxyUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: await blobToBase64(audioBlob),
        mimeType: audioBlob.type || "audio/webm",
        mode,
        model: config.transcriptionModel
      })
    });

    if (!response.ok) {
      throw new Error(await readOpenAIError(response, "Transcription failed"));
    }

    const data = (await response.json()) as { text?: string };
    if (!data.text) {
      throw new Error("Transcription completed but returned no text.");
    }
    return data.text;
  }

  const formData = new FormData();
  formData.append("file", audioBlob, `capture-${mode}.webm`);
  formData.append("model", config.transcriptionModel);
  formData.append("language", mode === "intel" ? "zh" : "ja");

  const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData
  });

  if (!response.ok) {
    throw new Error(await readOpenAIError(response, "Transcription failed"));
  }

  const data = (await response.json()) as { text?: string };
  if (!data.text) {
    throw new Error("Transcription completed but returned no text.");
  }
  return data.text;
}

export async function analyzeTextWithOpenAI(
  mode: SceneMode,
  inputText: string,
  config: OpenAIConfig,
  correctionRules: CorrectionRule[] = []
) {
  const proxyUrl = normalizeProxyUrl(config.proxyUrl);

  if (!config.apiKey.trim() && proxyUrl) {
    const response = await fetch(`${proxyUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        inputText,
        model: config.model,
        correctionRules: correctionRulesForPrompt(correctionRules)
      })
    });

    if (!response.ok) {
      throw new Error(await readOpenAIError(response, "Structured analysis failed"));
    }

    return normalizeModelResult(mode, await response.json());
  }

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "system",
          content:
            "You are a Chinese-Japanese industrial voice intelligence analysis engine. Return valid JSON only."
        },
        {
          role: "user",
          content: buildAnalysisPrompt(mode, inputText, correctionRules)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await readOpenAIError(response, "Structured analysis failed"));
  }

  const data = await response.json();
  const text = extractOutputText(data);
  if (!text) {
    throw new Error("The model returned no parseable output text.");
  }

  return normalizeModelResult(mode, parseJson(text));
}

export async function learnFromRecordingText(
  inputText: string,
  config: OpenAIConfig,
  correctionRules: CorrectionRule[] = []
) {
  const proxyUrl = normalizeProxyUrl(config.proxyUrl);

  if (!config.apiKey.trim() && proxyUrl) {
    const response = await fetch(`${proxyUrl}/learn-recording`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputText,
        model: config.model,
        correctionRules: correctionRulesForPrompt(correctionRules)
      })
    });

    if (!response.ok) {
      throw new Error(await readOpenAIError(response, "Recording language learning failed"));
    }

    return normalizeRecordingLearningResult(await response.json());
  }

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      input: [
        {
          role: "system",
          content:
            "You extract reusable terminology, expression corrections, translation preferences, speaker hints, and intelligence from Chinese-Japanese industrial recordings. Return valid JSON only."
        },
        {
          role: "user",
          content: buildRecordingLearningPrompt(inputText, correctionRules)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await readOpenAIError(response, "Recording language learning failed"));
  }

  const data = await response.json();
  const text = extractOutputText(data);
  if (!text) {
    throw new Error("The model returned no recording learning result.");
  }

  return normalizeRecordingLearningResult(parseJson(text));
}

export function createOpenAIBackedSession(mode: SceneMode, inputText: string, result: OpenAIAnalysisResult): Session {
  const base = {
    id: `session-openai-${mode}-${Date.now()}`,
    mode,
    createdAt: nowText(),
    inputText,
    status: "analyzed" as const,
    title: result.title
  };

  if (mode === "meeting") {
    return {
      ...base,
      meeting: result.meeting ?? analyzeMeeting(inputText)
    };
  }

  if (mode === "language") {
    return {
      ...base,
      language: result.language ?? analyzeLanguage(inputText)
    };
  }

  return {
    ...base,
    intel: result.intel ?? extractIntel(inputText)
  };
}

function buildAnalysisPrompt(mode: SceneMode, inputText: string, correctionRules: CorrectionRule[] = []) {
  const common = `Input text:
${inputText}

User correction rules to obey:
${buildCorrectionContext(correctionRules)}`;

  if (mode === "meeting") {
    return `Analyze this Chinese/Japanese industrial meeting transcript. Return valid JSON only with this shape:
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

${common}`;
  }

  if (mode === "language") {
    return `Act as a Japanese expression coach for Chinese-Japanese industrial business. Return valid JSON only:
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

${common}`;
  }

  return `Extract only useful technical or commercial intelligence from this informal conversation. Ignore small talk. Return valid JSON only:
{
  "title": "非正式情报提取",
  "intel": [
    {
      "id": "intel-1",
      "type": "技术信息|人事信息|价格信息|客户动向|竞争情报",
      "sourceScene": "酒局 / 高尔夫 / 客户交流 / 未知",
      "content": "intelligence content",
      "confidence": "高|中|低",
      "companies": ["company"],
      "suggestedAction": "recommended follow-up"
    }
  ]
}

${common}`;
}

function buildRecordingLearningPrompt(inputText: string, correctionRules: CorrectionRule[] = []) {
  return `Extract reusable learning assets from this Chinese/Japanese industrial recording transcript.

Focus on:
- Japanese technical terms and Chinese equivalents
- Semiconductor/OLED/materials/optics/display/AI supply-chain terminology
- Low-quality Japanese expressions and better business/engineering Japanese
- Translation preferences between spoken Chinese and engineering Chinese
- Potential business or technical intelligence
- Speaker naming hints if present

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
      "domain": "OLED|半导体|商务表达|制程",
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

function buildCorrectionContext(correctionRules: CorrectionRule[]) {
  const rules = correctionRulesForPrompt(correctionRules);
  if (!rules.length) {
    return "No user correction rules yet.";
  }

  return rules
    .map(
      (rule, index) =>
        `${index + 1}. [${rule.kind}] "${rule.original}" => "${rule.corrected}". Note: ${rule.note}`
    )
    .join("\n");
}

function correctionRulesForPrompt(correctionRules: CorrectionRule[]) {
  return correctionRules
    .filter((rule) => rule.original.trim() && rule.corrected.trim())
    .slice(0, 30)
    .map((rule) => ({
      kind: rule.kind,
      original: rule.original,
      corrected: rule.corrected,
      note: rule.note
    }));
}

function normalizeModelResult(mode: SceneMode, parsed: unknown): OpenAIAnalysisResult {
  const fallbackTitle =
    mode === "meeting" ? "真实会议分析" : mode === "language" ? "真实日语表达优化" : "真实情报提取";

  if (!parsed || typeof parsed !== "object") {
    return { title: fallbackTitle };
  }

  const value = parsed as Partial<OpenAIAnalysisResult>;
  return {
    title: typeof value.title === "string" ? value.title : fallbackTitle,
    meeting: value.meeting,
    language: value.language,
    intel: value.intel
  };
}

function normalizeRecordingLearningResult(parsed: unknown): RecordingLearningResult {
  const value = parsed && typeof parsed === "object" ? (parsed as Partial<RecordingLearningResult>) : {};
  return {
    title: typeof value.title === "string" ? value.title : "录音语言学习",
    terms: Array.isArray(value.terms) ? value.terms.slice(0, 30) : [],
    corrections: Array.isArray(value.corrections) ? value.corrections.slice(0, 30) : [],
    intel: Array.isArray(value.intel) ? value.intel.slice(0, 20) : []
  };
}

function parseJson(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("The model response was not valid JSON.");
    }
    return JSON.parse(jsonMatch[0]);
  }
}

function extractOutputText(data: unknown) {
  if (data && typeof data === "object" && "output_text" in data) {
    const outputText = (data as { output_text?: unknown }).output_text;
    return typeof outputText === "string" ? outputText : "";
  }

  const output = (data as { output?: Array<{ content?: Array<{ text?: string }> }> })?.output;
  return output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n") ?? "";
}

async function readOpenAIError(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? `${fallback}: HTTP ${response.status}`;
  } catch {
    return `${fallback}: HTTP ${response.status}`;
  }
}

function normalizeProxyUrl(proxyUrl: string) {
  const trimmed = proxyUrl.trim();
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
