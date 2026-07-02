import { OpenAIConfig } from "./openaiClient";
import { CorrectionRule, IntelItem, KnowledgeTerm, Session } from "../types";

const STORAGE_KEY = "multi-scene-voice-intel:v1";

export interface StoredAppState {
  sessions: Session[];
  intelItems: IntelItem[];
  terms: KnowledgeTerm[];
  correctionRules: CorrectionRule[];
  openAIConfig: Omit<OpenAIConfig, "apiKey" | "deepSeekApiKey" | "groqApiKey">;
  savedAt: string;
}

export interface AssetPackage {
  app: "multi-scene-voice-intel";
  version: 1;
  exportedAt: string;
  data: StoredAppState;
}

export function readStoredAppState(): Partial<StoredAppState> | null {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredAppState>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredAppState(state: StoredAppState) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(trimStoredState(state)));
}

export function clearStoredAppState() {
  const storage = getStorage();
  storage?.removeItem(STORAGE_KEY);
}

export function createAssetPackage(state: StoredAppState): AssetPackage {
  return {
    app: "multi-scene-voice-intel",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: trimStoredState(state)
  };
}

export function parseAssetPackage(raw: string): StoredAppState {
  const parsed = JSON.parse(raw) as Partial<AssetPackage> | Partial<StoredAppState>;
  if (isAssetPackage(parsed)) {
    return normalizeStoredState(parsed.data);
  }
  return normalizeStoredState(parsed as Partial<StoredAppState>);
}

function trimStoredState(state: StoredAppState): StoredAppState {
  return {
    ...state,
    sessions: state.sessions.slice(0, 80),
    intelItems: state.intelItems.slice(0, 300),
    terms: state.terms.slice(0, 500),
    correctionRules: state.correctionRules.slice(0, 300),
    openAIConfig: {
      model: state.openAIConfig.model,
      deepSeekModel: state.openAIConfig.deepSeekModel,
      groqTranscriptionModel: state.openAIConfig.groqTranscriptionModel,
      llmProvider: state.openAIConfig.llmProvider,
      asrProvider: state.openAIConfig.asrProvider,
      transcriptionModel: state.openAIConfig.transcriptionModel,
      proxyUrl: state.openAIConfig.proxyUrl
    },
    savedAt: state.savedAt
  };
}

function normalizeStoredState(value: Partial<StoredAppState>): StoredAppState {
  if (!value || typeof value !== "object") {
    throw new Error("Invalid asset package.");
  }

  return trimStoredState({
    sessions: Array.isArray(value.sessions) ? value.sessions : [],
    intelItems: Array.isArray(value.intelItems) ? value.intelItems : [],
    terms: Array.isArray(value.terms) ? value.terms : [],
    correctionRules: Array.isArray(value.correctionRules) ? value.correctionRules : [],
    openAIConfig: {
      model: value.openAIConfig?.model || "gpt-5.5",
      deepSeekModel: value.openAIConfig?.deepSeekModel || "deepseek-v4-flash",
      groqTranscriptionModel: value.openAIConfig?.groqTranscriptionModel || "whisper-large-v3-turbo",
      llmProvider: value.openAIConfig?.llmProvider || "deepseek",
      asrProvider: value.openAIConfig?.asrProvider || "groq",
      transcriptionModel: value.openAIConfig?.transcriptionModel || "gpt-4o-transcribe",
      proxyUrl: value.openAIConfig?.proxyUrl || "/api"
    },
    savedAt: value.savedAt || new Date().toISOString()
  });
}

function isAssetPackage(value: Partial<AssetPackage> | Partial<StoredAppState>): value is AssetPackage {
  return (
    value &&
    typeof value === "object" &&
    "app" in value &&
    value.app === "multi-scene-voice-intel" &&
    "data" in value &&
    Boolean(value.data)
  );
}

function getStorage(): Storage | null {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  return storage ?? null;
}
