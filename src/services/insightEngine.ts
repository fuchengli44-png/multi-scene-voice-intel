import { IntelItem, LearningInsight, Session, SessionInsights, TranscriptSegment } from "../types";

export function createSessionInsights(session: Session): SessionInsights {
  const learningReport = buildLearningReport(session);
  return {
    benchmark: session.mode === "meeting" ? "Notta" : session.mode === "intel" ? "Soniox" : "System",
    summary: buildInsightSummary(session),
    followUpQuestions: buildFollowUpQuestions(session),
    learningReport
  };
}

export function answerSessionQuestion(session: Session, question: string) {
  const normalized = question.trim();
  if (!normalized) {
    return "请输入你想追问的问题，例如：客户真正担心什么？下一步应该怎么跟进？";
  }

  if (session.meeting) {
    const findings = session.meeting.keyFindings.join("；");
    const actions = session.meeting.actionItems.map((item) => `${item.owner}: ${item.task}`).join("；");
    return `基于本次会议，核心判断是：${findings || "暂未形成明确结论"}。建议下一步优先处理：${actions || "补充会议结论和负责人"}。`;
  }

  if (session.language) {
    return `这段表达的重点不是逐字翻译，而是把口语日语升级为商务工程表达。推荐版本：${session.language.businessJapanese}。中文工程表达可写为：${session.language.engineeringChinese}`;
  }

  const intel = session.intel ?? [];
  const top = intel[0];
  if (!top) {
    return "当前没有可追问的情报条目。";
  }
  return `优先关注：${top.content}。可信度建议按 ${scoreIntelItem(top)} 分处理，先通过公开资料、客户窗口或采购侧交叉验证，再决定是否进入正式行动。`;
}

export function exportSessionMarkdown(session: Session) {
  const lines = [`# ${session.title}`, "", `- 时间：${session.createdAt}`, `- 模式：${session.mode}`, ""];

  if (session.meeting) {
    lines.push("## 关键结论", ...session.meeting.keyFindings.map((item) => `- ${item}`), "");
    lines.push("## 转写与双语规范化");
    for (const segment of session.meeting.segments) {
      lines.push(
        `### ${formatTimeRange(segment)} ${segment.speaker}`,
        `- 语言：${segment.language}`,
        `- 置信度：${formatConfidence(segment.confidence)}`,
        `- 原文：${segment.originalText}`,
        `- 规范化：${segment.normalizedText}`,
        `- 口语中文：${segment.oralChinese ?? ""}`,
        `- 工程中文：${segment.engineeringChinese ?? ""}`,
        ""
      );
    }
    lines.push("## Action Items");
    for (const item of session.meeting.actionItems) {
      lines.push(`- ${item.owner}：${item.task}（${item.dueHint} / ${item.status}）`);
    }
    lines.push("");
  }

  if (session.language) {
    lines.push(
      "## 表达优化",
      `- 原始日语：${session.language.originalJapanese}`,
      `- 商务日语：${session.language.businessJapanese}`,
      `- 口语中文：${session.language.oralChinese}`,
      `- 工程中文：${session.language.engineeringChinese}`,
      "",
      "## 发音与表达建议",
      ...session.language.pronunciationTips.map((tip) => `- ${tip.phrase} / ${tip.reading}：${tip.suggestion}`),
      ...session.language.expressionUpgrades.map((item) => `- ${item}`),
      ""
    );
  }

  if (session.intel?.length) {
    lines.push("## 情报条目");
    for (const item of session.intel) {
      lines.push(
        `### ${item.type}`,
        `- 来源：${item.sourceScene}`,
        `- 可信度：${item.confidence} / ${scoreIntelItem(item)} 分`,
        `- 状态：${item.verificationStatus ?? "待验证"}`,
        `- 公司：${item.companies.join(" / ")}`,
        `- 内容：${item.content}`,
        `- 建议行动：${item.suggestedAction}`,
        ""
      );
    }
  }

  const insights = session.insights ?? createSessionInsights(session);
  lines.push("## 自动学习报告", insights.summary);
  for (const item of insights.learningReport) {
    lines.push(`- [${item.category}] ${item.title}：${item.detail}`);
  }

  return lines.join("\n");
}

export function scoreIntelItem(item: IntelItem) {
  if (typeof item.confidenceScore === "number") {
    return clampScore(item.confidenceScore);
  }

  let score = item.confidence === "高" ? 82 : item.confidence === "中" ? 62 : 38;
  if (item.companies.length) score += 6;
  if (item.sourceScene.includes("公开") || item.sourceScene.includes("会议")) score += 6;
  if (item.sourceScene.includes("酒局") || item.sourceScene.includes("非正式")) score -= 8;
  if (item.suggestedAction.includes("验证") || item.suggestedAction.includes("确认")) score += 4;
  return clampScore(score);
}

export function formatTimeRange(segment: TranscriptSegment) {
  if (typeof segment.startMs !== "number" && typeof segment.endMs !== "number") {
    return "[--:--]";
  }
  return `[${formatMs(segment.startMs ?? 0)}-${formatMs(segment.endMs ?? segment.startMs ?? 0)}]`;
}

export function formatConfidence(value?: number) {
  if (typeof value !== "number") {
    return "未标注";
  }
  return `${Math.round(value * 100)}%`;
}

function buildInsightSummary(session: Session) {
  if (session.meeting) {
    return "已按 Notta 式会后闭环整理：结论、逐段转写、双语规范化、行动项、可追问问题。";
  }
  if (session.language) {
    return "已按个人语言教练闭环整理：原始表达、商务日语、工程中文、发音与术语资产。";
  }
  return "已按 Soniox 式可追溯情报流整理：来源、可信度、涉及公司、建议行动与验证状态。";
}

function buildFollowUpQuestions(session: Session) {
  if (session.meeting) {
    return ["客户真正担心什么？", "下一次会议前要准备什么材料？", "哪些术语需要沉淀到词库？"];
  }
  if (session.language) {
    return ["这句话怎么说更商务？", "哪些发音最容易被误识别？", "如何改成工程会议纪要用语？"];
  }
  return ["这条情报可信度为什么是这个等级？", "需要通过哪些渠道验证？", "对竞争策略有什么影响？"];
}

function buildLearningReport(session: Session): LearningInsight[] {
  const items: LearningInsight[] = [];

  if (session.meeting) {
    items.push({
      id: "learn-speaker",
      category: "行动",
      title: "Speaker 与行动项可复用",
      detail: "保留说话人、时间段和负责人，后续可用于回听定位和责任追踪。"
    });
    items.push({
      id: "learn-bilingual",
      category: "表达",
      title: "双语规范化资产",
      detail: "每段同时保留原文、商务日语、口语中文和工程中文，适合训练个人表达偏好。"
    });
  }

  if (session.language) {
    items.push({
      id: "learn-expression",
      category: "表达",
      title: "商务日语升级",
      detail: session.language.businessJapanese
    });
    for (const term of session.language.industryTerms.slice(0, 3)) {
      items.push({
        id: `learn-term-${term.id}`,
        category: "术语",
        title: `${term.japanese} / ${term.chinese}`,
        detail: term.recommendedExpression
      });
    }
  }

  for (const item of session.intel ?? []) {
    items.push({
      id: `learn-intel-${item.id}`,
      category: "情报",
      title: `${item.type}，${scoreIntelItem(item)} 分`,
      detail: item.suggestedAction
    });
  }

  return items.slice(0, 8);
}

function formatMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clampScore(score: number) {
  return Math.max(1, Math.min(99, Math.round(score)));
}
