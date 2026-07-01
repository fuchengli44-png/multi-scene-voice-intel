export type SceneMode = "meeting" | "language" | "intel";

export type Language = "ja" | "zh" | "mixed";

export type Confidence = "高" | "中" | "低";

export type IntelType =
  | "技术信息"
  | "人事信息"
  | "价格信息"
  | "客户动向"
  | "竞争情报";

export interface TranscriptSegment {
  id: string;
  speaker: string;
  language: Language;
  originalText: string;
  normalizedText: string;
  oralChinese?: string;
  engineeringChinese?: string;
}

export interface ActionItem {
  id: string;
  owner: string;
  task: string;
  dueHint: string;
  status: "待跟进" | "进行中" | "已完成";
}

export interface MeetingSummary {
  title: string;
  keyFindings: string[];
  segments: TranscriptSegment[];
  actionItems: ActionItem[];
}

export interface PronunciationTip {
  phrase: string;
  reading: string;
  suggestion: string;
}

export interface LanguageFeedback {
  originalJapanese: string;
  businessJapanese: string;
  oralChinese: string;
  engineeringChinese: string;
  pronunciationTips: PronunciationTip[];
  expressionUpgrades: string[];
  industryTerms: KnowledgeTerm[];
}

export interface IntelItem {
  id: string;
  type: IntelType;
  sourceScene: string;
  content: string;
  confidence: Confidence;
  companies: string[];
  suggestedAction: string;
}

export interface KnowledgeTerm {
  id: string;
  japanese: string;
  chinese: string;
  domain: "OLED" | "半导体" | "商务表达" | "制程";
  explanation: string;
  recommendedExpression: string;
}

export interface Session {
  id: string;
  mode: SceneMode;
  title: string;
  createdAt: string;
  inputText: string;
  status: "draft" | "analyzed";
  meeting?: MeetingSummary;
  language?: LanguageFeedback;
  intel?: IntelItem[];
}

export interface MeetingFeedItem {
  title: string;
  sourceUrl: string;
  institution: string;
  country: string;
  transcript?: string;
  summary?: string;
  tags?: string[];
}

export interface LearningFeedPayload {
  sourceDate?: string;
  theme?: string;
  terms?: KnowledgeTerm[];
  intel?: IntelItem[];
  meetings?: MeetingFeedItem[];
}

export type CorrectionKind = "term" | "speaker" | "expression" | "translation" | "intel_confidence";

export interface CorrectionRule {
  id: string;
  kind: CorrectionKind;
  original: string;
  corrected: string;
  note: string;
  sourceSessionId?: string;
  createdAt: string;
  usageCount: number;
}
