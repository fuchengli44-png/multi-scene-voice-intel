import { IntelItem, KnowledgeTerm, Session } from "../types";

export const glossary: KnowledgeTerm[] = [
  {
    id: "term-film-uniformity",
    japanese: "膜厚の均一性",
    chinese: "膜厚均一性",
    domain: "OLED",
    explanation: "用于评价蒸镀或成膜过程中薄膜厚度在基板上的一致性。",
    recommendedExpression: "膜厚の均一性にばらつきが発生している可能性があります"
  },
  {
    id: "term-deposition",
    japanese: "蒸着",
    chinese: "蒸镀",
    domain: "OLED",
    explanation: "OLED 制程中常见的真空成膜工艺。",
    recommendedExpression: "蒸着条件の再現性を確認する必要があります"
  },
  {
    id: "term-stability",
    japanese: "プロセス安定性",
    chinese: "制程稳定性",
    domain: "制程",
    explanation: "用于描述设备、材料和参数在连续生产中的波动控制能力。",
    recommendedExpression: "このプロセスには安定性の課題があると考えられます"
  },
  {
    id: "term-yield",
    japanese: "歩留まり",
    chinese: "良率",
    domain: "半导体",
    explanation: "实际合格产出占总投入的比例，是工艺成熟度的重要指标。",
    recommendedExpression: "歩留まりへの影響を定量的に確認します"
  },
  {
    id: "term-soft-issue",
    japanese: "課題があると考えられます",
    chinese: "存在需要确认的课题",
    domain: "商务表达",
    explanation: "比“有问题”更适合会议和客户沟通的商务日语表达。",
    recommendedExpression: "現時点では課題があると考えられます"
  }
];

export const intelLibrary: IntelItem[] = [
  {
    id: "intel-oled-switch",
    type: "客户动向",
    sourceScene: "酒局 / 客户交流",
    content: "某客户正在评估切换 OLED 材料供应商，原因可能与蒸镀稳定性和交期风险有关。",
    confidence: "中",
    companies: ["XX显示", "候选材料商A"],
    suggestedAction: "安排技术窗口，确认客户当前材料验证阶段和关键决策人。"
  },
  {
    id: "intel-price-pressure",
    type: "价格信息",
    sourceScene: "高尔夫 / 非正式交流",
    content: "竞争对手可能在 Q3 对核心材料报价下调 8%-10%，试图进入客户新产线。",
    confidence: "低",
    companies: ["竞争对手B", "客户C"],
    suggestedAction: "不要直接引用价格信息，先通过采购侧和代理渠道交叉验证。"
  },
  {
    id: "intel-process-window",
    type: "技术信息",
    sourceScene: "展会晚宴",
    content: "客户的量产窗口对膜厚均一性更敏感，当前希望供应商提供更稳定的蒸着条件建议。",
    confidence: "高",
    companies: ["客户D"],
    suggestedAction: "准备制程稳定性说明和膜厚分布案例，作为下次技术会议材料。"
  }
];

export const recentSessions: Session[] = [
  {
    id: "session-meeting-demo",
    mode: "meeting",
    title: "OLED 膜厚异常技术会议",
    createdAt: "2026-06-13 21:20",
    inputText: "多人会议模拟音频",
    status: "analyzed"
  },
  {
    id: "session-language-demo",
    mode: "language",
    title: "客户沟通表达训练",
    createdAt: "2026-06-13 20:45",
    inputText: "これはちょっと問題あると思います",
    status: "analyzed"
  },
  {
    id: "session-intel-demo",
    mode: "intel",
    title: "酒局客户动向记录",
    createdAt: "2026-06-12 23:10",
    inputText: "客户可能切换 OLED 供应商",
    status: "analyzed"
  }
];
