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
const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const GROQ_API_BASE = "https://api.groq.com/openai/v1";
const MAX_VERCEL_PROXY_AUDIO_BYTES = 3.2 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 120000;

export type LLMProvider = "openai" | "deepseek";
export type ASRProvider = "openai" | "groq";

export interface OpenAIConfig {
  apiKey: string;
  deepSeekApiKey: string;
  groqApiKey: string;
  llmProvider: LLMProvider;
  asrProvider: ASRProvider;
  model: string;
  deepSeekModel: string;
  groqTranscriptionModel: string;
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
  return Boolean(config.apiKey.trim() || config.deepSeekApiKey.trim() || config.groqApiKey.trim() || config.proxyUrl.trim());
}

export async function assertOpenAIReady(config: OpenAIConfig, purpose: "asr" | "llm" = "llm") {
  if (purpose === "asr" && config.asrProvider === "groq" && config.groqApiKey.trim()) {
    return;
  }

  if (purpose === "llm" && config.llmProvider === "deepseek" && config.deepSeekApiKey.trim()) {
    return;
  }

  if (config.apiKey.trim()) {
    return;
  }

  const proxyUrl = normalizeProxyUrl(config.proxyUrl);
  if (!proxyUrl) {
    throw new Error("未配置 API Key 或代理地址。");
  }

  const response = await fetch(`${proxyUrl}/health`);
  if (!response.ok) {
    throw new Error(`代理健康检查失败：HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    hasApiKey?: boolean;
    hasOpenAIKey?: boolean;
    hasDeepSeekKey?: boolean;
    hasGroqKey?: boolean;
  };
  const hasOpenAIKey = Boolean(data.hasApiKey || data.hasOpenAIKey);
  const hasDeepSeekKey = Boolean(data.hasDeepSeekKey);
  const hasGroqKey = Boolean(data.hasGroqKey);

  if (purpose === "asr" && config.asrProvider === "openai" && !hasOpenAIKey) {
    throw new Error("录音转写选择 OpenAI/Whisper，但 Vercel 还没有配置 OPENAI_API_KEY。可在设置页切换到 Groq Whisper，或在 Vercel 配置 OPENAI_API_KEY。");
  }

  if (purpose === "asr" && config.asrProvider === "groq" && !hasGroqKey) {
    throw new Error("录音转写选择 Groq Whisper，但 Vercel 还没有配置 GROQ_API_KEY。请在 Vercel 环境变量配置 GROQ_API_KEY，或在设置页临时填写 Groq API Key。");
  }

  if (purpose === "llm" && config.llmProvider === "deepseek" && !hasDeepSeekKey) {
    throw new Error("DeepSeek 分析已选择，但 Vercel 还没有配置 DEEPSEEK_API_KEY。");
  }

  if (purpose === "llm" && config.llmProvider === "openai" && !hasOpenAIKey) {
    throw new Error("OpenAI 分析已选择，但 Vercel 还没有配置 OPENAI_API_KEY。");
  }
}

export async function transcribeAudioBlob(audioBlob: Blob, mode: SceneMode, config: OpenAIConfig) {
  if (!audioBlob.size) {
    throw new Error("录音文件为空，请重新录音或选择有效音频文件。");
  }

  await assertOpenAIReady(config, "asr");
  const proxyUrl = normalizeProxyUrl(config.proxyUrl);

  if (!config.apiKey.trim() && proxyUrl) {
    if (audioBlob.size > MAX_VERCEL_PROXY_AUDIO_BYTES) {
      throw new Error(
        "录音文件较大，Vercel /api 代理可能超过 4.5MB 请求限制。请先用 1-2 分钟短录音测试；长录音需要升级为对象存储或可续传上传。"
      );
    }

    const response = await fetchWithTimeout(`${proxyUrl}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64: await blobToBase64(audioBlob),
        mimeType: audioBlob.type || "audio/webm",
        mode,
        provider: config.asrProvider,
        model: config.asrProvider === "groq" ? config.groqTranscriptionModel : config.transcriptionModel
      })
    }, TRANSCRIPTION_TIMEOUT_MS, "录音转写");

    if (!response.ok) {
      throw new Error(await readProviderError(response, "Transcription failed"));
    }

    const data = (await response.json()) as { text?: string };
    if (!data.text) {
      throw new Error("Transcription completed but returned no text.");
    }
    return data.text;
  }

  const asrBaseUrl = config.asrProvider === "groq" ? GROQ_API_BASE : OPENAI_API_BASE;
  const asrApiKey = config.asrProvider === "groq" ? config.groqApiKey : config.apiKey;
  const asrModel = config.asrProvider === "groq" ? config.groqTranscriptionModel : config.transcriptionModel;
  const formData = new FormData();
  formData.append("file", audioBlob, `capture-${mode}.${audioExtensionForMime(audioBlob.type)}`);
  formData.append("model", asrModel);
  formData.append("language", mode === "intel" ? "zh" : "ja");

  const response = await fetchWithTimeout(`${asrBaseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${asrApiKey}` },
    body: formData
  }, TRANSCRIPTION_TIMEOUT_MS, "录音转写");

  if (!response.ok) {
    throw new Error(await readProviderError(response, "Transcription failed"));
  }

  const data = (await response.json()) as { text?: string };
  if (!data.text) {
    throw new Error("Transcription completed but returned no text.");
  }
  return data.text;
}

export async function transcribeAudioCapture(
  audioBlob: Blob,
  audioSegments: Blob[],
  mode: SceneMode,
  config: OpenAIConfig,
  onProgress?: (completed: number, total: number) => void
) {
  const usableSegments = audioSegments.filter((segment) => segment.size > 0);
  const proxyUrl = normalizeProxyUrl(config.proxyUrl);
  const shouldUseSegments =
    !config.apiKey.trim() &&
    Boolean(proxyUrl) &&
    audioBlob.size > MAX_VERCEL_PROXY_AUDIO_BYTES &&
    usableSegments.length > 1;

  if (!shouldUseSegments) {
    return transcribeAudioBlob(audioBlob, mode, config);
  }

  const texts: string[] = [];
  for (let index = 0; index < usableSegments.length; index += 1) {
    const segment = usableSegments[index];
    if (!segment) continue;
    onProgress?.(index + 1, usableSegments.length);
    const text = await transcribeAudioBlob(segment, mode, config);
    if (text.trim()) {
      texts.push(text.trim());
    }
  }
  onProgress?.(usableSegments.length, usableSegments.length);

  if (!texts.length) {
    throw new Error("分段转写完成但没有返回文本。");
  }

  return texts.join("\n");
}

export async function analyzeTextWithOpenAI(
  mode: SceneMode,
  inputText: string,
  config: OpenAIConfig,
  correctionRules: CorrectionRule[] = []
) {
  await assertOpenAIReady(config, "llm");
  const proxyUrl = normalizeProxyUrl(config.proxyUrl);

  if (!config.apiKey.trim() && !config.deepSeekApiKey.trim() && proxyUrl) {
    const response = await fetch(`${proxyUrl}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        inputText,
        provider: config.llmProvider,
        model: config.llmProvider === "deepseek" ? config.deepSeekModel : config.model,
        correctionRules: correctionRulesForPrompt(correctionRules)
      })
    });

    if (!response.ok) {
      throw new Error(await readProviderError(response, "Structured analysis failed"));
    }

    return normalizeModelResult(mode, await response.json());
  }

  const parsed = await callDirectLLM({
    provider: config.llmProvider,
    apiKey: config.llmProvider === "deepseek" ? config.deepSeekApiKey : config.apiKey,
    model: config.llmProvider === "deepseek" ? config.deepSeekModel : config.model,
    system:
      "You are a Chinese-Japanese industrial voice intelligence analysis engine. Return valid JSON only.",
    prompt: buildAnalysisPrompt(mode, inputText, correctionRules),
    fallback: "Structured analysis failed"
  });

  return normalizeModelResult(mode, parsed);
}

export async function learnFromRecordingText(
  inputText: string,
  config: OpenAIConfig,
  correctionRules: CorrectionRule[] = []
) {
  await assertOpenAIReady(config, "llm");
  const proxyUrl = normalizeProxyUrl(config.proxyUrl);

  if (!config.apiKey.trim() && !config.deepSeekApiKey.trim() && proxyUrl) {
    const response = await fetch(`${proxyUrl}/learn-recording`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputText,
        provider: config.llmProvider,
        model: config.llmProvider === "deepseek" ? config.deepSeekModel : config.model,
        correctionRules: correctionRulesForPrompt(correctionRules)
      })
    });

    if (!response.ok) {
      throw new Error(await readProviderError(response, "Recording language learning failed"));
    }

    return normalizeRecordingLearningResult(await response.json());
  }

  const parsed = await callDirectLLM({
    provider: config.llmProvider,
    apiKey: config.llmProvider === "deepseek" ? config.deepSeekApiKey : config.apiKey,
    model: config.llmProvider === "deepseek" ? config.deepSeekModel : config.model,
    system:
      "You extract reusable terminology, expression corrections, translation preferences, speaker hints, and intelligence from Chinese-Japanese industrial recordings. Return valid JSON only.",
    prompt: buildRecordingLearningPrompt(inputText, correctionRules),
    fallback: "Recording language learning failed"
  });

  return normalizeRecordingLearningResult(parsed);
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

async function callDirectLLM({
  provider,
  apiKey,
  model,
  system,
  prompt,
  fallback
}: {
  provider: LLMProvider;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  fallback: string;
}) {
  if (provider === "deepseek") {
    const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "deepseek-v4-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    if (!response.ok) {
      throw new Error(await readProviderError(response, `DeepSeek ${fallback}`));
    }

    const data = await response.json();
    const text = extractChatCompletionText(data);
    if (!text) {
      throw new Error("DeepSeek returned no parseable output text.");
    }
    return parseJson(text);
  }

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await readProviderError(response, fallback));
  }

  const data = await response.json();
  const text = extractOutputText(data);
  if (!text) {
    throw new Error("The model returned no parseable output text.");
  }
  return parseJson(text);
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
        "startMs": 0,
        "endMs": 12000,
        "speakerId": "speaker-1",
        "speaker": "Japanese engineer A / customer B / you",
        "language": "ja|zh|mixed",
        "confidence": 0.92,
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
      "confidenceScore": 62,
      "verificationStatus": "待验证|交叉验证中|已验证|不采用",
      "evidenceSignals": ["source clue", "company clue", "verification clue"],
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
      "confidenceScore": 62,
      "verificationStatus": "待验证|交叉验证中|已验证|不采用",
      "evidenceSignals": ["source clue", "company clue", "verification clue"],
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

function extractChatCompletionText(data: unknown) {
  const choice = (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0];
  return choice?.message?.content ?? "";
}

async function readProviderError(response: Response, fallback: string) {
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

function audioExtensionForMime(mimeType: string) {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
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

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label}超时。请先用 1-2 分钟短录音测试，长录音需要分段或升级为对象存储上传。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
