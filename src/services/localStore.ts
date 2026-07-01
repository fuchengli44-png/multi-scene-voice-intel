import { OpenAIConfig } from "./openaiClient";
import { CorrectionRule, IntelItem, KnowledgeTerm, Session } from "../types";

const STORAGE_KEY = "multi-scene-voice-intel:v1";

export interface StoredAppState {
  sessions: Session[];
  intelItems: IntelItem[];
  terms: KnowledgeTerm[];
  correctionRules: CorrectionRule[];
  openAIConfig: Omit<OpenAIConfig, "apiKey">;
  savedAt: string;
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

function trimStoredState(state: StoredAppState): StoredAppState {
  return {
    ...state,
    sessions: state.sessions.slice(0, 80),
    intelItems: state.intelItems.slice(0, 300),
    terms: state.terms.slice(0, 500),
    correctionRules: state.correctionRules.slice(0, 300),
    openAIConfig: {
      model: state.openAIConfig.model,
      transcriptionModel: state.openAIConfig.transcriptionModel,
      proxyUrl: state.openAIConfig.proxyUrl
    },
    savedAt: state.savedAt
  };
}

function getStorage(): Storage | null {
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  return storage ?? null;
}
