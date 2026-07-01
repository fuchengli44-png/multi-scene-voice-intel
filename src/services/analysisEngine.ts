import {
  IntelItem,
  KnowledgeTerm,
  LanguageFeedback,
  MeetingSummary,
  SceneMode,
  Session
} from "../types";
import { glossary, intelLibrary } from "../data/mockData";

const nowText = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
};

export function analyzeMeeting(input: string): MeetingSummary {
  return {
    title: "OLED 成膜稳定性技术会议",
    keyFindings: [
      "客户关注膜厚均一性波动，倾向于将问题定位为制程窗口不稳定。",
      "日方工程师建议复核蒸着条件、基板温度和材料批次差异。",
      "你的翻译节点需要保留原始表达，同时输出商务日语和工程中文纪要版本。"
    ],
    segments: [
      {
        id: "seg-1",
        speaker: "日方工程师A",
        language: "ja",
        originalText: "膜厚のばらつきが少し大きくなっているようです。",
        normalizedText: "膜厚の均一性にばらつきが発生している可能性があります。",
        oralChinese: "膜厚好像变得不太均匀。",
        engineeringChinese: "当前样品存在膜厚均一性波动，需要进一步确认制程参数。"
      },
      {
        id: "seg-2",
        speaker: "客户B",
        language: "zh",
        originalText: "我们更担心这个问题会不会影响量产良率。",
        normalizedText: "量産時の歩留まりへの影響を確認したいというご懸念です。",
        oralChinese: "客户主要担心良率受影响。",
        engineeringChinese: "客户关注膜厚波动对量产良率的潜在影响。"
      },
      {
        id: "seg-3",
        speaker: "你",
        language: "ja",
        originalText: input || "ちょっと膜厚がバラバラになってると思うんですけど。",
        normalizedText: "膜厚の均一性にばらつきが発生している可能性があります。",
        oralChinese: "我觉得膜厚有点不均匀。",
        engineeringChinese: "初步判断膜厚均一性存在波动，建议复核蒸镀条件。"
      }
    ],
    actionItems: [
      {
        id: "action-1",
        owner: "日方工程师A",
        task: "提供蒸着条件、基板温度和材料批次的复核结果。",
        dueHint: "下次技术会议前",
        status: "待跟进"
      },
      {
        id: "action-2",
        owner: "你",
        task: "整理中文工程版会议纪要，并补充日语商务表达修正版。",
        dueHint: "24 小时内",
        status: "进行中"
      }
    ]
  };
}

export function analyzeLanguage(input: string): LanguageFeedback {
  const original = input || "これはちょっと問題あると思います";
  return {
    originalJapanese: original,
    businessJapanese: "このプロセスには安定性の課題があると考えられます。",
    oralChinese: "这个工艺可能有点不稳定。",
    engineeringChinese: "该制程存在稳定性课题，建议通过参数复核和样品数据进行验证。",
    pronunciationTips: [
      {
        phrase: "蒸着",
        reading: "shōkyaku",
        suggestion: "注意长音 shō，避免读成短音导致术语识别偏差。"
      },
      {
        phrase: "歩留まり",
        reading: "budomari",
        suggestion: "重音放在前半段，会议中建议与“良率”对应记忆。"
      }
    ],
    expressionUpgrades: [
      "把“問題ある”替换为“課題があると考えられます”，语气更商务。",
      "把“ちょっと”替换为“現時点では”或“定量的には”，减少主观感。",
      "技术会议里优先说明影响对象：歩留まり、膜厚均一性、プロセス安定性。"
    ],
    industryTerms: glossary.filter((term) => term.domain === "商务表达" || term.domain === "制程")
  };
}

export function extractIntel(input: string): IntelItem[] {
  const focusedItem: IntelItem = {
    id: "intel-live-capture",
    type: "客户动向",
    sourceScene: "非正式交流 / 现场记录",
    content:
      input ||
      "客户正在重新评估 OLED 材料供应商，可能与蒸镀稳定性、交期和报价压力有关。",
    confidence: "中",
    companies: ["目标客户", "潜在竞争供应商"],
    suggestedAction: "标记为待验证情报，通过技术窗口和采购侧进行交叉确认。"
  };

  return [focusedItem, ...intelLibrary.slice(0, 2)];
}

export function searchGlossary(query: string): KnowledgeTerm[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return glossary;
  }

  return glossary.filter((term) => {
    const haystack = [
      term.japanese,
      term.chinese,
      term.domain,
      term.explanation,
      term.recommendedExpression
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

export function createAnalyzedSession(mode: SceneMode, inputText: string): Session {
  const base = {
    id: `session-${mode}-${Date.now()}`,
    mode,
    createdAt: nowText(),
    inputText,
    status: "analyzed" as const
  };

  if (mode === "meeting") {
    const meeting = analyzeMeeting(inputText);
    return {
      ...base,
      title: meeting.title,
      meeting
    };
  }

  if (mode === "language") {
    return {
      ...base,
      title: "日语表达优化",
      language: analyzeLanguage(inputText)
    };
  }

  return {
    ...base,
    title: "非正式情报提取",
    intel: extractIntel(inputText)
  };
}
