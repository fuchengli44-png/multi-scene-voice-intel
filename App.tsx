import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { createAnalyzedSession } from "./src/services/analysisEngine";
import { glossary, intelLibrary, recentSessions } from "./src/data/mockData";
import { useWebVoiceCapture } from "./src/hooks/useWebVoiceCapture";
import {
  createAssetPackage,
  parseAssetPackage,
  readStoredAppState,
  StoredAppState,
  writeStoredAppState
} from "./src/services/localStore";
import {
  answerSessionQuestion,
  createSessionInsights,
  exportSessionMarkdown,
  formatConfidence,
  formatTimeRange,
  scoreIntelItem
} from "./src/services/insightEngine";
import {
  createOpenAIBackedSession,
  transcribeAudioBlob,
  analyzeTextWithOpenAI,
  learnFromRecordingText,
  hasConfiguredOpenAI,
  OpenAIConfig
} from "./src/services/openaiClient";
import { colors, spacing } from "./src/styles/theme";
import {
  CorrectionKind,
  CorrectionRule,
  IntelItem,
  KnowledgeTerm,
  LearningFeedPayload,
  LearningInsight,
  SceneMode,
  Session
} from "./src/types";

type TabKey = "dashboard" | "capture" | "intel" | "glossary" | "feed" | "correction" | "settings";

const modeMeta: Record<
  SceneMode,
  {
    label: string;
    short: string;
    color: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
    placeholder: string;
  }
> = {
  meeting: {
    label: "会议模式",
    short: "Meeting",
    color: colors.meeting,
    icon: "account-voice",
    placeholder: "输入会议片段，例：ちょっと膜厚がバラバラになってると思うんですけど..."
  },
  language: {
    label: "个人表达",
    short: "Coach",
    color: colors.language,
    icon: "translate",
    placeholder: "输入你的日语表达，例：これはちょっと問題あると思います"
  },
  intel: {
    label: "情报场景",
    short: "Intel",
    color: colors.intel,
    icon: "radar",
    placeholder: "输入非正式交流记录，例：客户可能准备切换 OLED 供应商..."
  }
};

const tabItems: Array<{
  key: TabKey;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}> = [
  { key: "dashboard", label: "总览", icon: "view-dashboard-outline" },
  { key: "capture", label: "采集", icon: "microphone-outline" },
  { key: "intel", label: "情报", icon: "database-search-outline" },
  { key: "glossary", label: "词库", icon: "book-open-page-variant-outline" },
  { key: "feed", label: "投喂", icon: "tray-arrow-down" },
  { key: "correction", label: "纠错", icon: "playlist-check" },
  { key: "settings", label: "设置", icon: "cog-outline" }
];

const sampleLearningFeed = JSON.stringify(
  {
    sourceDate: "2026-06-29",
    theme: "OLED materials and display supply chain",
    terms: [
      {
        id: "feed-term-micro-oled",
        japanese: "Micro OLED",
        chinese: "硅基 OLED 微显示",
        domain: "OLED",
        explanation: "用于 VR/AR 近眼显示的高像素密度 OLED 微显示技术。",
        recommendedExpression: "Micro OLED の量産性と輝度特性を確認する必要があります。"
      }
    ],
    intel: [
      {
        id: "feed-intel-display-sample",
        type: "技术信息",
        sourceScene: "公开大学讲座 / 技术报告",
        content: "近眼显示对亮度、寿命、像素密度和光学耦合效率提出更高要求。",
        confidence: "中",
        companies: ["公开资料"],
        suggestedAction: "加入 VR/AR 显示路线词库，并跟踪 Micro OLED 与 Micro LED 技术差异。"
      }
    ],
    meetings: [
      {
        title: "Public lecture sample: OLED display materials",
        sourceUrl: "https://example.edu/public-lecture",
        institution: "Example University",
        country: "US",
        summary: "公开讲座样本，用于测试会议/讲座资料投喂流程。",
        tags: ["OLED", "materials", "display"]
      }
    ]
  },
  null,
  2
);

const sampleCorrectionRules: CorrectionRule[] = [
  {
    id: "correction-term-shochaku",
    kind: "term",
    original: "しょうきゃく",
    corrected: "蒸着 / しょうちゃく / deposition",
    note: "OLED 制程术语，语音识别常误判读音；会议纪要中统一写作蒸着。",
    createdAt: "2026-06-29 08:00",
    usageCount: 0
  },
  {
    id: "correction-expression-problem",
    kind: "expression",
    original: "これはちょっと問題あると思います",
    corrected: "このプロセスには安定性の課題があると考えられます",
    note: "客户会议中避免直接说“有问题”，改成商务且可验证的表达。",
    createdAt: "2026-06-29 08:00",
    usageCount: 0
  }
];

const correctionKindLabels: Record<CorrectionKind, string> = {
  term: "术语纠错",
  speaker: "Speaker 纠错",
  expression: "表达修正",
  translation: "翻译修正",
  intel_confidence: "情报可信度"
};

function getDefaultProxyUrl() {
  const locationLike = (globalThis as { location?: { protocol?: string; hostname?: string } }).location;
  const hostname = locationLike?.hostname;

  if (!hostname || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return "http://127.0.0.1:8787";
  }

  if (locationLike?.protocol === "https:") {
    return "/api";
  }

  return `http://${hostname}:8787`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [selectedMode, setSelectedMode] = useState<SceneMode>("meeting");
  const [sessions, setSessions] = useState<Session[]>(recentSessions);
  const [intelItems, setIntelItems] = useState<IntelItem[]>(intelLibrary);
  const [terms, setTerms] = useState<KnowledgeTerm[]>(glossary);
  const [correctionRules, setCorrectionRules] = useState<CorrectionRule[]>(sampleCorrectionRules);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [openAIConfig, setOpenAIConfig] = useState<OpenAIConfig>({
    apiKey: "",
    deepSeekApiKey: "",
    groqApiKey: "",
    llmProvider: "deepseek",
    asrProvider: "groq",
    model: "gpt-5.5",
    deepSeekModel: "deepseek-v4-flash",
    groqTranscriptionModel: "whisper-large-v3-turbo",
    transcriptionModel: "gpt-4o-transcribe",
    proxyUrl: getDefaultProxyUrl()
  });
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [assetTransferStatus, setAssetTransferStatus] = useState("本机资产会自动保存，API Key 不会写入备份。");

  useEffect(() => {
    const stored = readStoredAppState();
    if (stored?.sessions?.length) {
      setSessions(stored.sessions);
    }
    if (stored?.intelItems?.length) {
      setIntelItems(stored.intelItems);
    }
    if (stored?.terms?.length) {
      setTerms(stored.terms);
    }
    if (stored?.correctionRules?.length) {
      setCorrectionRules(stored.correctionRules);
    }
    if (stored?.openAIConfig) {
      setOpenAIConfig((current) => ({
        ...current,
        ...stored.openAIConfig,
        apiKey: "",
        deepSeekApiKey: "",
        groqApiKey: ""
      }));
    }
    setIsStorageReady(true);
  }, []);

  useEffect(() => {
    if (!isStorageReady || !openAIConfig.proxyUrl.trim()) {
      return;
    }

    let cancelled = false;
    const proxyUrl = openAIConfig.proxyUrl.trim().replace(/\/$/, "");

    fetch(`${proxyUrl}/health`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) {
          return;
        }

        const hasOpenAIKey = Boolean(data.hasApiKey || data.hasOpenAIKey);
        const hasDeepSeekKey = Boolean(data.hasDeepSeekKey);
        const hasGroqKey = Boolean(data.hasGroqKey);

        setOpenAIConfig((current) => {
          const next = { ...current };
          if (current.llmProvider === "openai" && !hasOpenAIKey && hasDeepSeekKey) {
            next.llmProvider = "deepseek";
          }
          if (current.asrProvider === "openai" && !hasOpenAIKey && hasGroqKey) {
            next.asrProvider = "groq";
          }
          return next.llmProvider === current.llmProvider && next.asrProvider === current.asrProvider ? current : next;
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [isStorageReady, openAIConfig.proxyUrl]);

  useEffect(() => {
    if (!isStorageReady) {
      return;
    }

    writeStoredAppState({
      sessions,
      intelItems,
      terms,
      correctionRules,
      openAIConfig: {
        model: openAIConfig.model,
        deepSeekModel: openAIConfig.deepSeekModel,
        groqTranscriptionModel: openAIConfig.groqTranscriptionModel,
        llmProvider: openAIConfig.llmProvider,
        asrProvider: openAIConfig.asrProvider,
        transcriptionModel: openAIConfig.transcriptionModel,
        proxyUrl: openAIConfig.proxyUrl
      },
      savedAt: new Date().toISOString()
    });
  }, [
    correctionRules,
    intelItems,
    isStorageReady,
    openAIConfig.asrProvider,
    openAIConfig.deepSeekModel,
    openAIConfig.groqTranscriptionModel,
    openAIConfig.llmProvider,
    openAIConfig.model,
    openAIConfig.proxyUrl,
    openAIConfig.transcriptionModel,
    sessions,
    terms
  ]);

  const openCapture = (mode: SceneMode) => {
    setSelectedMode(mode);
    setActiveTab("capture");
  };

  const openSession = (session: Session) => {
    setSelectedSession(ensureSessionDetails(session));
  };

  const currentStoredState = (): StoredAppState => ({
    sessions,
    intelItems,
    terms,
    correctionRules,
    openAIConfig: {
      model: openAIConfig.model,
      deepSeekModel: openAIConfig.deepSeekModel,
      groqTranscriptionModel: openAIConfig.groqTranscriptionModel,
      llmProvider: openAIConfig.llmProvider,
      asrProvider: openAIConfig.asrProvider,
      transcriptionModel: openAIConfig.transcriptionModel,
      proxyUrl: openAIConfig.proxyUrl
    },
    savedAt: new Date().toISOString()
  });

  const exportAssets = async () => {
    const assetPackage = createAssetPackage(currentStoredState());
    await downloadTextFile(
      JSON.stringify(assetPackage, null, 2),
      `voice-intel-assets-${formatDateForFilename(new Date())}.json`,
      "application/json;charset=utf-8"
    );
    setAssetTransferStatus("资产包已导出，可用于备份或迁移到另一台手机。");
  };

  const importAssets = async () => {
    try {
      const raw = await selectTextFile(".json,application/json,text/plain");
      if (!raw) {
        return;
      }
      const imported = parseAssetPackage(raw);
      setSessions((items) => mergeById(imported.sessions, items));
      setIntelItems((items) => mergeById(imported.intelItems, items));
      setTerms((items) => mergeById(imported.terms, items));
      setCorrectionRules((items) => mergeById(imported.correctionRules, items));
      setOpenAIConfig((current) => ({
        ...current,
        model: imported.openAIConfig.model || current.model,
        deepSeekModel: imported.openAIConfig.deepSeekModel || current.deepSeekModel,
        groqTranscriptionModel: imported.openAIConfig.groqTranscriptionModel || current.groqTranscriptionModel,
        llmProvider: imported.openAIConfig.llmProvider || current.llmProvider,
        asrProvider: imported.openAIConfig.asrProvider || current.asrProvider,
        transcriptionModel: imported.openAIConfig.transcriptionModel || current.transcriptionModel,
        proxyUrl: imported.openAIConfig.proxyUrl || current.proxyUrl,
        apiKey: "",
        deepSeekApiKey: "",
        groqApiKey: ""
      }));
      setAssetTransferStatus(
        `导入完成：${imported.sessions.length} 个任务、${imported.intelItems.length} 条情报、${imported.terms.length} 个术语、${imported.correctionRules.length} 条纠错规则。`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法导入资产包。";
      setAssetTransferStatus(`导入失败：${message}`);
    }
  };

  const handleAnalyzed = (session: Session) => {
    setSessions((items) => [session, ...items]);
    if (session.intel?.length) {
      setIntelItems((items) => mergeById(session.intel ?? [], items));
    }
    setSelectedSession(session);
  };

  const handleLearningFeed = (payload: LearningFeedPayload) => {
    if (payload.terms?.length) {
      setTerms((items) => mergeById(payload.terms ?? [], items));
    }
    if (payload.intel?.length) {
      setIntelItems((items) => mergeById(payload.intel ?? [], items));
    }
    if (payload.meetings?.length) {
      const importedSessions = payload.meetings.map((meeting, index) =>
        createAnalyzedSession(
          "meeting",
          meeting.transcript ||
            `${meeting.title}\n${meeting.summary || ""}\nSource: ${meeting.sourceUrl}`.trim()
        )
      ).map((session, index) => ({
        ...session,
        id: `feed-meeting-${Date.now()}-${index}`,
        title: payload.meetings?.[index]?.title || session.title
      }));
      setSessions((items) => [...importedSessions, ...items]);
      setSelectedSession(importedSessions[0] ?? null);
    }
  };

  const handleRecordingLearning = (learning: {
    terms?: KnowledgeTerm[];
    intel?: IntelItem[];
    corrections?: Array<Pick<CorrectionRule, "kind" | "original" | "corrected" | "note">>;
  }) => {
    if (learning.terms?.length) {
      setTerms((items) => mergeById(learning.terms ?? [], items));
    }
    if (learning.intel?.length) {
      setIntelItems((items) => mergeById(learning.intel ?? [], items));
    }
    if (learning.corrections?.length) {
      const rules = learning.corrections.map((item, index) => ({
        id: `recording-correction-${Date.now()}-${index}`,
        kind: item.kind,
        original: item.original,
        corrected: item.corrected,
        note: item.note,
        createdAt: formatNow(),
        usageCount: 0
      }));
      setCorrectionRules((items) => [...rules, ...items]);
    }
  };

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="dark" />
      <View style={styles.shell}>
        {activeTab === "dashboard" && (
          <DashboardScreen
            sessions={sessions}
            intelCount={intelItems.length}
            termCount={terms.length}
            onOpenCapture={openCapture}
            onOpenSession={openSession}
          />
        )}
        {activeTab === "capture" && (
          <CaptureScreen
            selectedMode={selectedMode}
            onModeChange={setSelectedMode}
            onAnalyzed={handleAnalyzed}
            openAIConfig={openAIConfig}
            onConfigChange={setOpenAIConfig}
            correctionRules={correctionRules}
            onLearningReady={handleRecordingLearning}
          />
        )}
        {activeTab === "intel" && <IntelLibraryScreen items={intelItems} />}
        {activeTab === "glossary" && <GlossaryScreen terms={terms} />}
        {activeTab === "feed" && (
          <LearningFeedScreen
            openAIConfig={openAIConfig}
            correctionRules={correctionRules}
            onImport={handleLearningFeed}
            onLearningReady={handleRecordingLearning}
            onSessionReady={handleAnalyzed}
          />
        )}
        {activeTab === "correction" && (
          <CorrectionScreen
            rules={correctionRules}
            onAddRule={(rule) => setCorrectionRules((items) => [rule, ...items])}
          />
        )}
        {activeTab === "settings" && (
          <SettingsScreen
            openAIConfig={openAIConfig}
            onConfigChange={setOpenAIConfig}
            assetCounts={{
              sessions: sessions.length,
              intel: intelItems.length,
              terms: terms.length,
              corrections: correctionRules.length
            }}
            assetTransferStatus={assetTransferStatus}
            onExportAssets={exportAssets}
            onImportAssets={importAssets}
          />
        )}
      </View>
      <BottomTabs activeTab={activeTab} onChange={setActiveTab} />
      {selectedSession ? <ResultSheet session={selectedSession} onClose={() => setSelectedSession(null)} /> : null}
    </SafeAreaView>
  );
}

function DashboardScreen({
  sessions,
  intelCount,
  termCount,
  onOpenCapture,
  onOpenSession
}: {
  sessions: Session[];
  intelCount: number;
  termCount: number;
  onOpenCapture: (mode: SceneMode) => void;
  onOpenSession: (session: Session) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Cognitive Augmentation System</Text>
        <Text style={styles.title}>多场景语音情报系统</Text>
        <Text style={styles.subtitle}>会议、表达训练与非正式情报提炼的一体化移动工作台。</Text>
      </View>

      <View style={styles.modeGrid}>
        {(Object.keys(modeMeta) as SceneMode[]).map((mode) => (
          <SceneButton key={mode} mode={mode} onPress={() => onOpenCapture(mode)} />
        ))}
      </View>

      <View style={styles.metricsRow}>
        <Metric label="情报条目" value={String(intelCount)} color={colors.intel} />
        <Metric label="术语资产" value={String(termCount)} color={colors.meeting} />
        <Metric label="模拟模式" value="ON" color={colors.accent} />
      </View>

      <SectionHeader title="最近任务" action="查看结果" />
      {sessions.map((session) => (
        <Pressable key={session.id} accessibilityRole="button" style={styles.sessionCard} onPress={() => onOpenSession(session)}>
          <View style={[styles.modeRail, { backgroundColor: modeMeta[session.mode].color }]} />
          <View style={styles.sessionBody}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{session.title}</Text>
              <Text style={styles.modePill}>{modeMeta[session.mode].short}</Text>
            </View>
            <Text style={styles.cardMeta}>{session.createdAt}</Text>
            <Text style={styles.cardText} numberOfLines={2}>
              {session.inputText}
            </Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function CaptureScreen({
  selectedMode,
  onModeChange,
  onAnalyzed,
  openAIConfig,
  onConfigChange,
  correctionRules,
  onLearningReady
}: {
  selectedMode: SceneMode;
  onModeChange: (mode: SceneMode) => void;
  onAnalyzed: (session: Session) => void;
  openAIConfig: OpenAIConfig;
  onConfigChange: (config: OpenAIConfig) => void;
  correctionRules: CorrectionRule[];
  onLearningReady: (learning: {
    terms?: KnowledgeTerm[];
    intel?: IntelItem[];
    corrections?: Array<Pick<CorrectionRule, "kind" | "original" | "corrected" | "note">>;
  }) => void;
}) {
  const [input, setInput] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState("HTTPS 线上版默认使用 /api；清空代理和 API Key 后使用模拟分析。");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const meta = modeMeta[selectedMode];
  const voiceCapture = useWebVoiceCapture(selectedMode);
  const lastAutoTranscribedBlobRef = useRef<Blob | null>(null);
  const asrLabel = openAIConfig.asrProvider === "groq" ? "Groq Whisper" : "OpenAI Whisper";
  const llmLabel = openAIConfig.llmProvider === "deepseek" ? "DeepSeek" : "OpenAI";

  useEffect(() => {
    if (voiceCapture.transcript) {
      setInput(voiceCapture.transcript);
    }
  }, [voiceCapture.transcript]);

  useEffect(() => {
    const audioBlob = voiceCapture.audioBlob;
    if (!audioBlob || lastAutoTranscribedBlobRef.current === audioBlob) {
      return;
    }

    lastAutoTranscribedBlobRef.current = audioBlob;
    if (!hasConfiguredOpenAI(openAIConfig)) {
      setAnalysisStatus("录音已生成音频；配置 /api、Vercel ASR Key 或前端 API Key 后可自动转写。");
      return;
    }

    let cancelled = false;
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAnalysisStatus("录音已停止，正在自动转写...");

    (async () => {
      try {
        const text = await transcribeAudioBlob(audioBlob, selectedMode, openAIConfig);
        if (cancelled) return;
        setInput(text);
        setAnalysisStatus("自动转写完成，正在学习录音中的术语、表达和情报...");
        try {
          const learning = await learnFromRecordingText(text, openAIConfig, correctionRules);
          if (cancelled) return;
          onLearningReady({
            terms: learning.terms,
            intel: learning.intel,
            corrections: learning.corrections
          });
          setAnalysisStatus(
            `自动转写完成并已学习：${learning.terms.length} 个术语，${learning.corrections.length} 条纠错，${learning.intel.length} 条情报。`
          );
        } catch (learningError) {
          if (cancelled) return;
          const message = learningError instanceof Error ? learningError.message : "自动学习失败。";
          setAnalysisError(message);
          setAnalysisStatus("自动转写已完成，但自动学习失败。转写文本已保留，请检查 DeepSeek 余额或 API Key。");
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "自动转写失败。";
        setAnalysisError(message);
        setAnalysisStatus("自动转写失败。请检查 /api、Vercel ASR Key、网络或音频格式。");
      } finally {
        if (!cancelled) {
          setIsAnalyzing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [correctionRules, onLearningReady, openAIConfig, selectedMode, voiceCapture.audioBlob]);

  const analyze = async () => {
    if (isAnalyzing) return;

    let textForAnalysis = input.trim();
    setAnalysisError(null);
    setIsAnalyzing(true);

    try {
      const hasOpenAIConnection = await hasConfiguredOpenAI(openAIConfig);

      if (hasOpenAIConnection) {
        if (!textForAnalysis && voiceCapture.audioBlob) {
          setAnalysisStatus(`正在调用 ${asrLabel} 转写音频...`);
          textForAnalysis = await transcribeAudioBlob(voiceCapture.audioBlob, selectedMode, openAIConfig);
          setInput(textForAnalysis);
        }

        if (!textForAnalysis) {
          throw new Error("请先录音或输入文本。");
        }

        setAnalysisStatus(`正在调用 ${llmLabel} 生成结构化分析...`);
        const result = await analyzeTextWithOpenAI(selectedMode, textForAnalysis, openAIConfig, correctionRules);
        onAnalyzed(createOpenAIBackedSession(selectedMode, textForAnalysis, result));
        setAnalysisStatus("真实分析完成。");
      } else {
        const correctedText = applyCorrectionRules(textForAnalysis, correctionRules);
        if (!correctedText.trim()) {
          throw new Error("请先录音或输入文本；录音转写需要配置 ASR Key。");
        }
        const session = createAnalyzedSession(selectedMode, correctedText);
        onAnalyzed(session);
        setAnalysisStatus("已使用本地模拟分析。");
      }

      setInput("");
      voiceCapture.reset();
    } catch (error) {
      const message = error instanceof Error ? error.message : "分析失败。";
      setAnalysisError(message);
        setAnalysisStatus("真实分析失败，可检查 /api 代理、API Key、网络，或清空代理和 API Key 使用模拟分析。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleRecording = () => {
    if (voiceCapture.isRecording) {
      voiceCapture.stop();
      return;
    }
    voiceCapture.start();
  };

  const pickAudioFile = async () => {
    try {
      setAnalysisError(null);
      const audioFile = await selectAudioFile();
      if (!audioFile) return;
      setAnalysisStatus(`已选择录音文件：${audioFile.name}`);
      if (hasConfiguredOpenAI(openAIConfig)) {
        setIsAnalyzing(true);
        setAnalysisStatus("正在转写录音文件...");
        const text = await transcribeAudioBlob(audioFile.blob, selectedMode, openAIConfig);
        setInput(text);
        setAnalysisStatus("转写完成，正在自动学习录音中的术语、表达和情报...");
        try {
          const learning = await learnFromRecordingText(text, openAIConfig, correctionRules);
          onLearningReady({
            terms: learning.terms,
            intel: learning.intel,
            corrections: learning.corrections
          });
          setAnalysisStatus(
            `转写完成并已学习：${learning.terms.length} 个术语，${learning.corrections.length} 条纠错，${learning.intel.length} 条情报。`
          );
        } catch (learningError) {
          const message = learningError instanceof Error ? learningError.message : "自动学习失败。";
          setAnalysisError(message);
          setAnalysisStatus("转写已完成，但自动学习失败。转写文本已保留，请检查 DeepSeek 余额或 API Key。");
        }
      } else {
        setAnalysisStatus("已选择录音文件；配置 /api、本地代理或 API Key 后可自动转写。");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取录音文件。";
      setAnalysisError(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>Capture</Text>
        <Text style={styles.titleSmall}>语音采集与模拟分析</Text>
      </View>

      <View style={styles.segmented}>
        {(Object.keys(modeMeta) as SceneMode[]).map((mode) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            style={[styles.segmentItem, selectedMode === mode && { backgroundColor: modeMeta[mode].color }]}
            onPress={() => onModeChange(mode)}
          >
            <MaterialCommunityIcons
              name={modeMeta[mode].icon}
              size={18}
              color={selectedMode === mode ? "#ffffff" : colors.subtext}
            />
            <Text style={[styles.segmentText, selectedMode === mode && styles.segmentTextActive]}>
              {modeMeta[mode].label}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.capturePanel}>
        <View style={[styles.captureIcon, { backgroundColor: meta.color }]}>
          <MaterialCommunityIcons name={meta.icon} size={34} color="#ffffff" />
        </View>
        <Text style={styles.panelTitle}>{meta.label}</Text>
        <Text style={styles.panelText}>
          浏览器预览中可直接调用麦克风，并尝试实时语音识别；识别文本会进入下方分析输入框。
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.recordButton, voiceCapture.isRecording && styles.recordButtonActive]}
          onPress={toggleRecording}
        >
          <MaterialCommunityIcons
            name={voiceCapture.isRecording ? "stop-circle-outline" : "record-circle-outline"}
            size={22}
            color="#ffffff"
          />
          <Text style={styles.recordButtonText}>{voiceCapture.isRecording ? "停止录音" : "开始录音"}</Text>
        </Pressable>
        <View style={styles.captureStatus}>
          <View style={[styles.statusDot, voiceCapture.isRecording && styles.statusDotActive]} />
          <Text style={styles.captureStatusText}>
            {voiceCapture.isSupported ? voiceCapture.status : "当前平台不支持浏览器录音，请手动输入文本"}
          </Text>
        </View>
        {voiceCapture.interimTranscript ? (
          <Text style={styles.liveTranscript}>识别中：{voiceCapture.interimTranscript}</Text>
        ) : null}
        {voiceCapture.error ? <Text style={styles.errorText}>{voiceCapture.error}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={pickAudioFile}>
          <MaterialCommunityIcons name="file-music-outline" size={20} color={colors.text} />
          <Text style={styles.secondaryButtonText}>选择手机已有录音</Text>
        </Pressable>
      </View>

      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder={meta.placeholder}
        placeholderTextColor="#89939d"
        multiline
        style={styles.input}
        textAlignVertical="top"
      />
      <View style={styles.analysisStatusBox}>
        <MaterialCommunityIcons
          name={openAIConfig.apiKey || openAIConfig.deepSeekApiKey || openAIConfig.groqApiKey || openAIConfig.proxyUrl ? "cloud-check-outline" : "flask-outline"}
          size={18}
          color={colors.subtext}
        />
        <Text style={styles.analysisStatusText}>{analysisStatus}</Text>
      </View>
      <View style={styles.providerStatusBox}>
        <Text style={styles.providerStatusText}>当前转写：{asrLabel}</Text>
        <Text style={styles.providerStatusText}>当前分析：{llmLabel}</Text>
        {openAIConfig.asrProvider === "openai" ? (
          <Pressable
            accessibilityRole="button"
            style={styles.providerSwitchButton}
            onPress={() => onConfigChange({ ...openAIConfig, asrProvider: "groq" })}
          >
            <Text style={styles.providerSwitchText}>切到 Groq Whisper</Text>
          </Pressable>
        ) : null}
        {openAIConfig.llmProvider === "openai" ? (
          <Pressable
            accessibilityRole="button"
            style={styles.providerSwitchButton}
            onPress={() => onConfigChange({ ...openAIConfig, llmProvider: "deepseek" })}
          >
            <Text style={styles.providerSwitchText}>切到 DeepSeek</Text>
          </Pressable>
        ) : null}
      </View>
      {correctionRules.length ? (
        <Text style={styles.ruleHint}>本次分析将应用 {correctionRules.length} 条纠错/表达偏好规则。</Text>
      ) : null}
      {analysisError ? <Text style={styles.errorText}>{analysisError}</Text> : null}
      <Pressable
        accessibilityRole="button"
        style={[styles.primaryButton, { backgroundColor: meta.color }, isAnalyzing && styles.primaryButtonDisabled]}
        onPress={analyze}
      >
        <MaterialCommunityIcons name={isAnalyzing ? "timer-sand" : "auto-fix"} size={20} color="#ffffff" />
        <Text style={styles.primaryButtonText}>{isAnalyzing ? "分析中..." : "生成结构化分析"}</Text>
      </Pressable>
    </ScrollView>
  );
}

function IntelLibraryScreen({ items: intelItems }: { items: IntelItem[] }) {
  const [filter, setFilter] = useState<IntelItem["type"] | "全部">("全部");
  const filters: Array<IntelItem["type"] | "全部"> = ["全部", "客户动向", "技术信息", "价格信息", "竞争情报"];
  const items = filter === "全部" ? intelItems : intelItems.filter((item) => item.type === filter);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>Field Intelligence</Text>
        <Text style={styles.titleSmall}>情报库</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {filters.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            style={[styles.filterChip, filter === item && styles.filterChipActive]}
            onPress={() => setFilter(item)}
          >
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {items.map((item) => (
        <IntelCard item={item} key={item.id} />
      ))}
    </ScrollView>
  );
}

function GlossaryScreen({ terms }: { terms: KnowledgeTerm[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchTerms(terms, query), [terms, query]);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>Bilingual Knowledge Graph</Text>
        <Text style={styles.titleSmall}>半导体 / OLED 词库</Text>
      </View>
      <View style={styles.searchBox}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.subtext} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="搜索：膜厚、蒸着、良率..."
          placeholderTextColor="#89939d"
          style={styles.searchInput}
        />
      </View>
      {results.map((term) => (
        <View key={term.id} style={styles.termCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.termJapanese}>{term.japanese}</Text>
            <Text style={styles.domainTag}>{term.domain}</Text>
          </View>
          <Text style={styles.termChinese}>{term.chinese}</Text>
          <Text style={styles.cardText}>{term.explanation}</Text>
          <Text style={styles.recommendation}>{term.recommendedExpression}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function LearningFeedScreen({
  openAIConfig,
  correctionRules,
  onImport,
  onLearningReady,
  onSessionReady
}: {
  openAIConfig: OpenAIConfig;
  correctionRules: CorrectionRule[];
  onImport: (payload: LearningFeedPayload) => void;
  onLearningReady: (learning: {
    terms?: KnowledgeTerm[];
    intel?: IntelItem[];
    corrections?: Array<Pick<CorrectionRule, "kind" | "original" | "corrected" | "note">>;
  }) => void;
  onSessionReady: (session: Session) => void;
}) {
  const [feedText, setFeedText] = useState(sampleLearningFeed);
  const [status, setStatus] = useState("粘贴每日学习任务输出的 APP_FEED_JSON，然后导入。");
  const [error, setError] = useState<string | null>(null);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);

  const importFeed = () => {
    try {
      setError(null);
      const payload = JSON.parse(feedText) as LearningFeedPayload;
      const termCount = payload.terms?.length ?? 0;
      const intelCount = payload.intel?.length ?? 0;
      const meetingCount = payload.meetings?.length ?? 0;

      if (!termCount && !intelCount && !meetingCount) {
        throw new Error("JSON 中没有 terms、intel 或 meetings。");
      }

      onImport(payload);
      setStatus(`已导入：${termCount} 个术语，${intelCount} 条情报，${meetingCount} 个会议/讲座样本。`);
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : "导入失败。";
      setError(message);
      setStatus("导入失败，请检查 JSON 格式。");
    }
  };

  const importAudioMeeting = async () => {
    try {
      setError(null);
      if (!openAIConfig.apiKey.trim() && !openAIConfig.proxyUrl.trim()) {
        throw new Error("请先在设置页配置 /api、本地代理或 ASR API Key。");
      }

      const audioFile = await selectAudioFile();
      if (!audioFile) return;

      setIsProcessingAudio(true);
      setStatus(`正在转写录音：${audioFile.name}`);
      const transcript = await transcribeAudioBlob(audioFile.blob, "meeting", openAIConfig);
      setStatus("转写完成，正在整理会议纪要...");
      const result = await analyzeTextWithOpenAI("meeting", transcript, openAIConfig, correctionRules);
      const session = createOpenAIBackedSession("meeting", transcript, {
        ...result,
        title: result.title || audioFile.name
      });
      setStatus("会议纪要完成，正在从录音中学习术语、表达和情报...");
      const learning = await learnFromRecordingText(transcript, openAIConfig, correctionRules);
      onLearningReady({
        terms: learning.terms,
        intel: learning.intel,
        corrections: learning.corrections
      });
      onSessionReady({
        ...session,
        title: session.title || audioFile.name
      });
      setStatus(
        `录音已整理并自动学习：${learning.terms.length} 个术语，${learning.corrections.length} 条纠错，${learning.intel.length} 条情报。`
      );
    } catch (importError) {
      const message = importError instanceof Error ? importError.message : "录音投喂失败。";
      setError(message);
      setStatus("录音投喂失败，请检查 /api 代理、API Key 或音频格式。");
    } finally {
      setIsProcessingAudio(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>Learning Feed</Text>
        <Text style={styles.titleSmall}>学习内容投喂</Text>
      </View>
      <View style={styles.feedGuide}>
        <Text style={styles.cardTitle}>APP_FEED_JSON</Text>
        <Text style={styles.cardText}>
          每日自动学习任务会输出术语、情报和公开会议/讲座录音链接。粘贴到这里后，可沉淀进 APP 的词库、情报库和会议样本。
        </Text>
      </View>
      <View style={styles.feedGuide}>
        <Text style={styles.cardTitle}>投喂录音并整理会议纪要</Text>
        <Text style={styles.cardText}>
          可选择手机已有录音、公开会议录音片段或讲座音频文件。系统会先转写，再按会议模式生成纪要、Speaker 内容和 Action Items。
        </Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.secondaryButton, isProcessingAudio && styles.primaryButtonDisabled]}
          onPress={importAudioMeeting}
        >
          <MaterialCommunityIcons name={isProcessingAudio ? "timer-sand" : "file-music-outline"} size={20} color={colors.text} />
          <Text style={styles.secondaryButtonText}>{isProcessingAudio ? "整理中..." : "选择录音并整理"}</Text>
        </Pressable>
      </View>
      <TextInput
        value={feedText}
        onChangeText={setFeedText}
        multiline
        autoCapitalize="none"
        style={styles.feedInput}
        textAlignVertical="top"
      />
      <View style={styles.analysisStatusBox}>
        <MaterialCommunityIcons name={error ? "alert-circle-outline" : "database-import-outline"} size={18} color={colors.subtext} />
        <Text style={styles.analysisStatusText}>{status}</Text>
      </View>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      <Pressable accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.intel }]} onPress={importFeed}>
        <MaterialCommunityIcons name="tray-arrow-down" size={20} color="#ffffff" />
        <Text style={styles.primaryButtonText}>导入到 APP</Text>
      </Pressable>
    </ScrollView>
  );
}

function CorrectionScreen({
  rules,
  onAddRule
}: {
  rules: CorrectionRule[];
  onAddRule: (rule: CorrectionRule) => void;
}) {
  const [kind, setKind] = useState<CorrectionKind>("term");
  const [original, setOriginal] = useState("");
  const [corrected, setCorrected] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("把 AI 输出中的错误沉淀为可复用规则。");

  const addRule = () => {
    if (!original.trim() || !corrected.trim()) {
      setStatus("请填写原始错误和修正结果。");
      return;
    }

    onAddRule({
      id: `correction-${kind}-${Date.now()}`,
      kind,
      original: original.trim(),
      corrected: corrected.trim(),
      note: note.trim() || "人工确认规则",
      createdAt: formatNow(),
      usageCount: 0
    });
    setOriginal("");
    setCorrected("");
    setNote("");
    setStatus("已加入纠错规则，后续可用于术语、Speaker、表达和情报可信度优化。");
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>Correction Loop</Text>
        <Text style={styles.titleSmall}>纠错与确认</Text>
      </View>

      <View style={styles.feedGuide}>
        <Text style={styles.cardTitle}>人工反馈会变成系统资产</Text>
        <Text style={styles.cardText}>
          每次修正术语、发言人、翻译、商务表达或情报可信度，都应该沉淀成规则，后续投喂给转写和分析提示词。
        </Text>
      </View>

      <View style={styles.correctionKindGrid}>
        {(Object.keys(correctionKindLabels) as CorrectionKind[]).map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            style={[styles.correctionKindButton, kind === item && styles.correctionKindButtonActive]}
            onPress={() => setKind(item)}
          >
            <Text style={[styles.correctionKindText, kind === item && styles.correctionKindTextActive]}>
              {correctionKindLabels[item]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.inputLabel}>原始错误 / AI 输出</Text>
      <TextInput
        value={original}
        onChangeText={setOriginal}
        placeholder="例：Speaker 1 / しょうきゃく / 有问题"
        placeholderTextColor="#89939d"
        multiline
        style={styles.correctionInput}
        textAlignVertical="top"
      />
      <Text style={styles.inputLabel}>修正结果 / 标准表达</Text>
      <TextInput
        value={corrected}
        onChangeText={setCorrected}
        placeholder="例：日方工程师A / 蒸着 / 安定性の課題がある"
        placeholderTextColor="#89939d"
        multiline
        style={styles.correctionInput}
        textAlignVertical="top"
      />
      <Text style={styles.inputLabel}>备注</Text>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="为什么这样修正，适用于哪些客户/会议/场景"
        placeholderTextColor="#89939d"
        multiline
        style={styles.correctionInput}
        textAlignVertical="top"
      />

      <View style={styles.analysisStatusBox}>
        <MaterialCommunityIcons name="playlist-check" size={18} color={colors.subtext} />
        <Text style={styles.analysisStatusText}>{status}</Text>
      </View>
      <Pressable accessibilityRole="button" style={[styles.primaryButton, { backgroundColor: colors.accent }]} onPress={addRule}>
        <MaterialCommunityIcons name="plus-circle-outline" size={20} color="#ffffff" />
        <Text style={styles.primaryButtonText}>加入纠错规则</Text>
      </Pressable>

      <SectionHeader title="已沉淀规则" />
      {rules.map((rule) => (
        <View key={rule.id} style={styles.correctionCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{correctionKindLabels[rule.kind]}</Text>
            <Text style={styles.modePill}>{rule.usageCount} 次</Text>
          </View>
          <Text style={styles.cardMeta}>{rule.createdAt}</Text>
          <InfoBlock label="原始" text={rule.original} />
          <InfoBlock label="修正" text={rule.corrected} emphasis />
          <Text style={styles.cardText}>{rule.note}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function SettingsScreen({
  openAIConfig,
  onConfigChange,
  assetCounts,
  assetTransferStatus,
  onExportAssets,
  onImportAssets
}: {
  openAIConfig: OpenAIConfig;
  onConfigChange: (config: OpenAIConfig) => void;
  assetCounts: {
    sessions: number;
    intel: number;
    terms: number;
    corrections: number;
  };
  assetTransferStatus: string;
  onExportAssets: () => void;
  onImportAssets: () => void;
}) {
  const updateConfig = (patch: Partial<OpenAIConfig>) => {
    onConfigChange({ ...openAIConfig, ...patch });
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.headerCompact}>
        <Text style={styles.kicker}>Settings</Text>
        <Text style={styles.titleSmall}>系统设置</Text>
      </View>
      <SettingRow
        icon="content-save-check-outline"
        title="本机资产"
        value={`已自动保存：${assetCounts.sessions} 个任务、${assetCounts.intel} 条情报、${assetCounts.terms} 个术语、${assetCounts.corrections} 条纠错规则。API Key 不会持久保存。`}
      />
      <View style={styles.assetPanel}>
        <View style={styles.assetActions}>
          <Pressable accessibilityRole="button" style={styles.assetButton} onPress={onExportAssets}>
            <MaterialCommunityIcons name="download-outline" size={18} color="#ffffff" />
            <Text style={styles.assetButtonText}>导出资产包</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={[styles.assetButton, styles.assetButtonSecondary]} onPress={onImportAssets}>
            <MaterialCommunityIcons name="upload-outline" size={18} color={colors.text} />
            <Text style={[styles.assetButtonText, styles.assetButtonTextSecondary]}>导入资产包</Text>
          </Pressable>
        </View>
        <Text style={styles.assetStatus}>{assetTransferStatus}</Text>
      </View>
      <View style={styles.settingsPanel}>
        <Text style={styles.cardTitle}>AI Provider</Text>
        <Text style={styles.cardText}>
          文本分析可选 OpenAI 或 DeepSeek；录音转写仍使用 ASR/Whisper 通道。生产环境推荐把 Key 放在 Vercel 环境变量。
        </Text>
        <Text style={styles.inputLabel}>LLM 提供商</Text>
        <View style={styles.providerRow}>
          {(["openai", "deepseek"] as const).map((provider) => {
            const active = openAIConfig.llmProvider === provider;
            return (
              <Pressable
                key={provider}
                accessibilityRole="button"
                style={[styles.providerButton, active && styles.providerButtonActive]}
                onPress={() => updateConfig({ llmProvider: provider })}
              >
                <Text style={[styles.providerButtonText, active && styles.providerButtonTextActive]}>
                  {provider === "openai" ? "OpenAI" : "DeepSeek"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.inputLabel}>ASR 转写服务</Text>
        <View style={styles.providerRow}>
          {(["openai", "groq"] as const).map((provider) => {
            const active = openAIConfig.asrProvider === provider;
            return (
              <Pressable
                key={provider}
                accessibilityRole="button"
                style={[styles.providerButton, active && styles.providerButtonActive]}
                onPress={() => updateConfig({ asrProvider: provider })}
              >
                <Text style={[styles.providerButtonText, active && styles.providerButtonTextActive]}>
                  {provider === "openai" ? "OpenAI Whisper" : "Groq Whisper"}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.inputLabel}>代理地址</Text>
        <TextInput
          value={openAIConfig.proxyUrl}
          onChangeText={(proxyUrl) => updateConfig({ proxyUrl })}
          placeholder="/api 或 http://127.0.0.1:8787"
          placeholderTextColor="#89939d"
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
        <Text style={styles.inputLabel}>OpenAI API Key（可选，前端临时测试）</Text>
        <TextInput
          value={openAIConfig.apiKey}
          onChangeText={(apiKey) => updateConfig({ apiKey })}
          placeholder="sk-..."
          placeholderTextColor="#89939d"
          secureTextEntry
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
        <Text style={styles.inputLabel}>DeepSeek API Key（可选，前端临时测试）</Text>
        <TextInput
          value={openAIConfig.deepSeekApiKey}
          onChangeText={(deepSeekApiKey) => updateConfig({ deepSeekApiKey })}
          placeholder="sk-..."
          placeholderTextColor="#89939d"
          secureTextEntry
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
        <Text style={styles.inputLabel}>Groq API Key（可选，前端临时测试）</Text>
        <TextInput
          value={openAIConfig.groqApiKey}
          onChangeText={(groqApiKey) => updateConfig({ groqApiKey })}
          placeholder="gsk_..."
          placeholderTextColor="#89939d"
          secureTextEntry
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
        <Text style={styles.inputLabel}>OpenAI 分析模型</Text>
        <TextInput
          value={openAIConfig.model}
          onChangeText={(model) => updateConfig({ model })}
          placeholder="gpt-5.5"
          placeholderTextColor="#89939d"
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
        <Text style={styles.inputLabel}>DeepSeek 分析模型</Text>
        <TextInput
          value={openAIConfig.deepSeekModel}
          onChangeText={(deepSeekModel) => updateConfig({ deepSeekModel })}
          placeholder="deepseek-v4-flash"
          placeholderTextColor="#89939d"
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
        <Text style={styles.inputLabel}>转写模型</Text>
        <TextInput
          value={openAIConfig.transcriptionModel}
          onChangeText={(transcriptionModel) => updateConfig({ transcriptionModel })}
          placeholder="gpt-4o-transcribe"
          placeholderTextColor="#89939d"
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
        <Text style={styles.inputLabel}>Groq 转写模型</Text>
        <TextInput
          value={openAIConfig.groqTranscriptionModel}
          onChangeText={(groqTranscriptionModel) => updateConfig({ groqTranscriptionModel })}
          placeholder="whisper-large-v3-turbo"
          placeholderTextColor="#89939d"
          autoCapitalize="none"
          style={styles.singleLineInput}
        />
      </View>
      <SettingRow
        icon="cpu-64-bit"
        title="AI 模式"
        value={`${openAIConfig.llmProvider === "deepseek" ? "DeepSeek" : "OpenAI"} 分析 + ${
          openAIConfig.asrProvider === "groq" ? "Groq Whisper" : "OpenAI/Whisper"
        } 转写${
          openAIConfig.proxyUrl ? "（代理后端）" : openAIConfig.apiKey || openAIConfig.deepSeekApiKey ? "（前端临时 Key）" : "（本地模拟）"
        }`}
      />
      <SettingRow icon="cloud-lock-outline" title="隐私策略" value="生产环境把 OPENAI_API_KEY 放在 Vercel 环境变量；本地开发放在 .env，由代理调用 OpenAI。" />
      <SettingRow icon="database-outline" title="RAG 资产" value="预留 FAISS / Weaviate 知识库接口" />
    </ScrollView>
  );
}

function ResultSheet({ session, onClose }: { session: Session; onClose: () => void }) {
  const insights = session.insights ?? createSessionInsights(session);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const suggestedQuestions = insights.followUpQuestions;

  const askQuestion = (text = question) => {
    const nextQuestion = text.trim();
    setQuestion(nextQuestion);
    setAnswer(answerSessionQuestion(session, nextQuestion));
  };

  const exportMarkdown = async () => {
    const markdown = exportSessionMarkdown({ ...session, insights });
    await copyOrDownloadMarkdown(markdown, `${session.title || "voice-intel-session"}.md`);
    setExportStatus("已生成 Markdown，可粘贴到会议纪要、Notion 或知识库。");
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.kicker}>Analysis Result</Text>
            <Text style={styles.sheetTitle}>{session.title}</Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.iconButton} onPress={onClose}>
            <MaterialCommunityIcons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <View style={styles.insightBanner}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>对标洞察：{insights.benchmark}</Text>
              <Pressable accessibilityRole="button" style={styles.smallActionButton} onPress={exportMarkdown}>
                <MaterialCommunityIcons name="file-export-outline" size={16} color="#ffffff" />
                <Text style={styles.smallActionText}>Markdown</Text>
              </Pressable>
            </View>
            <Text style={styles.cardText}>{insights.summary}</Text>
            {exportStatus ? <Text style={styles.successText}>{exportStatus}</Text> : null}
          </View>
          {session.meeting ? <MeetingResult session={session} /> : null}
          {session.language ? <LanguageResult session={session} /> : null}
          {session.intel ? session.intel.map((item) => <IntelCardV2 item={item} key={item.id} />) : null}
          <InsightQa
            question={question}
            answer={answer}
            suggestedQuestions={suggestedQuestions}
            onChangeQuestion={setQuestion}
            onAsk={askQuestion}
          />
          <LearningReport insights={insights.learningReport} />
        </ScrollView>
      </View>
    </View>
  );
}

function MeetingResult({ session }: { session: Session }) {
  const meeting = session.meeting;
  if (!meeting) return null;

  return (
    <View>
      <SectionHeader title="关键结论" />
      {meeting.keyFindings.map((finding) => (
        <Bullet key={finding} text={finding} />
      ))}
      <SectionHeader title="Speaker 标注与双语规范化" />
      {meeting.segments.map((segment) => (
        <View key={segment.id} style={styles.segmentCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.speaker}>{segment.speaker}</Text>
            <Text style={styles.timestampText}>{formatTimeRange(segment)}</Text>
          </View>
          <Text style={styles.cardMeta}>
            {segment.speakerId ? `${segment.speakerId} · ` : ""}
            ASR 置信度 {formatConfidence(segment.confidence)}
          </Text>
          <Text style={styles.original}>{segment.originalText}</Text>
          <Text style={styles.normalized}>{segment.normalizedText}</Text>
          <Text style={styles.cardText}>口语中文：{segment.oralChinese}</Text>
          <Text style={styles.cardText}>工程中文：{segment.engineeringChinese}</Text>
        </View>
      ))}
      <SectionHeader title="Action Items" />
      {meeting.actionItems.map((item) => (
        <View key={item.id} style={styles.actionItem}>
          <Text style={styles.actionOwner}>{item.owner}</Text>
          <Text style={styles.cardText}>{item.task}</Text>
          <Text style={styles.cardMeta}>
            {item.dueHint} · {item.status}
          </Text>
        </View>
      ))}
    </View>
  );
}

function LanguageResult({ session }: { session: Session }) {
  const feedback = session.language;
  if (!feedback) return null;

  return (
    <View>
      <InfoBlock label="原始日语" text={feedback.originalJapanese} />
      <InfoBlock label="商务日语修正版" text={feedback.businessJapanese} emphasis />
      <InfoBlock label="口语中文" text={feedback.oralChinese} />
      <InfoBlock label="工程中文" text={feedback.engineeringChinese} />
      <SectionHeader title="发音建议" />
      {feedback.pronunciationTips.map((tip) => (
        <View key={tip.phrase} style={styles.tipCard}>
          <Text style={styles.cardTitle}>{tip.phrase}</Text>
          <Text style={styles.cardMeta}>{tip.reading}</Text>
          <Text style={styles.cardText}>{tip.suggestion}</Text>
        </View>
      ))}
      <SectionHeader title="表达升级" />
      {feedback.expressionUpgrades.map((text) => (
        <Bullet key={text} text={text} />
      ))}
    </View>
  );
}

function InsightQa({
  question,
  answer,
  suggestedQuestions,
  onChangeQuestion,
  onAsk
}: {
  question: string;
  answer: string;
  suggestedQuestions: string[];
  onChangeQuestion: (text: string) => void;
  onAsk: (text?: string) => void;
}) {
  return (
    <View style={styles.qaPanel}>
      <SectionHeader title="会后追问" />
      <Text style={styles.cardText}>像 Notta 一样把转写变成可追问的工作台，但问题聚焦工业日语、客户动向和行动判断。</Text>
      <View style={styles.questionChips}>
        {suggestedQuestions.map((item) => (
          <Pressable key={item} accessibilityRole="button" style={styles.questionChip} onPress={() => onAsk(item)}>
            <Text style={styles.questionChipText}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={question}
        onChangeText={onChangeQuestion}
        placeholder="追问：客户真正担心什么？下一步怎么跟进？"
        placeholderTextColor="#89939d"
        multiline
        style={styles.qaInput}
      />
      <Pressable accessibilityRole="button" style={styles.askButton} onPress={() => onAsk()}>
        <MaterialCommunityIcons name="comment-question-outline" size={18} color="#ffffff" />
        <Text style={styles.primaryButtonText}>生成追问回答</Text>
      </Pressable>
      {answer ? <Text style={styles.answerText}>{answer}</Text> : null}
    </View>
  );
}

function LearningReport({ insights }: { insights: LearningInsight[] }) {
  if (!insights.length) {
    return null;
  }

  return (
    <View>
      <SectionHeader title="自动学习报告" />
      {insights.map((item) => (
        <View key={item.id} style={styles.learningItem}>
          <Text style={styles.learningCategory}>{item.category}</Text>
          <View style={styles.learningBody}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardText}>{item.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function SceneButton({ mode, onPress }: { mode: SceneMode; onPress: () => void }) {
  const meta = modeMeta[mode];
  return (
    <Pressable accessibilityRole="button" style={styles.sceneButton} onPress={onPress}>
      <View style={[styles.sceneIcon, { backgroundColor: meta.color }]}>
        <MaterialCommunityIcons name={meta.icon} size={24} color="#ffffff" />
      </View>
      <Text style={styles.sceneTitle}>{meta.label}</Text>
      <Text style={styles.sceneText}>{meta.short}</Text>
    </Pressable>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

function IntelCardV2({ item }: { item: IntelItem }) {
  const confidenceColor =
    item.confidence === "高" ? colors.success : item.confidence === "中" ? colors.warning : colors.accent;
  const score = scoreIntelItem(item);

  return (
    <View style={styles.intelCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{item.type}</Text>
        <Text style={[styles.confidenceTag, { color: confidenceColor, borderColor: confidenceColor }]}>
          可信度 {item.confidence}
        </Text>
      </View>
      <Text style={styles.cardMeta}>{item.sourceScene}</Text>
      <View style={styles.scoreRow}>
        <View style={styles.scoreBadge}>
          <Text style={styles.scoreValue}>{score}</Text>
          <Text style={styles.scoreLabel}>可信度评分</Text>
        </View>
        <View style={styles.scoreBody}>
          <Text style={styles.cardMeta}>验证状态：{item.verificationStatus ?? "待验证"}</Text>
          {(item.evidenceSignals ?? ["来源场景", "涉及公司", "建议行动"]).slice(0, 3).map((signal) => (
            <Text key={signal} style={styles.signalText}>
              · {signal}
            </Text>
          ))}
        </View>
      </View>
      <Text style={styles.cardText}>{item.content}</Text>
      <Text style={styles.companyText}>涉及公司：{item.companies.join(" / ")}</Text>
      <Text style={styles.recommendation}>{item.suggestedAction}</Text>
    </View>
  );
}

function IntelCard({ item }: { item: IntelItem }) {
  const confidenceColor =
    item.confidence === "高" ? colors.success : item.confidence === "中" ? colors.warning : colors.accent;

  return (
    <View style={styles.intelCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.cardTitle}>{item.type}</Text>
        <Text style={[styles.confidenceTag, { color: confidenceColor, borderColor: confidenceColor }]}>
          可信度 {item.confidence}
        </Text>
      </View>
      <Text style={styles.cardMeta}>{item.sourceScene}</Text>
      <Text style={styles.cardText}>{item.content}</Text>
      <Text style={styles.companyText}>涉及公司：{item.companies.join(" / ")}</Text>
      <Text style={styles.recommendation}>{item.suggestedAction}</Text>
    </View>
  );
}

function InfoBlock({ label, text, emphasis }: { label: string; text: string; emphasis?: boolean }) {
  return (
    <View style={[styles.infoBlock, emphasis && styles.infoBlockEmphasis]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function SettingRow({
  icon,
  title,
  value
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  value: string;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingIcon}>
        <MaterialCommunityIcons name={icon} size={22} color={colors.meeting} />
      </View>
      <View style={styles.settingText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardText}>{value}</Text>
      </View>
    </View>
  );
}

function BottomTabs({ activeTab, onChange }: { activeTab: TabKey; onChange: (tab: TabKey) => void }) {
  return (
    <View style={styles.tabs}>
      {tabItems.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable key={tab.key} accessibilityRole="tab" style={styles.tabItem} onPress={() => onChange(tab.key)}>
            <MaterialCommunityIcons name={tab.icon} size={22} color={active ? colors.accent : colors.subtext} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function mergeById<T extends { id: string }>(incoming: T[], existing: T[]) {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return Array.from(map.values());
}

function ensureSessionDetails(session: Session): Session {
  if (session.meeting || session.language || session.intel) {
    return {
      ...session,
      insights: session.insights ?? createSessionInsights(session)
    };
  }

  const analyzed = createAnalyzedSession(session.mode, session.inputText);
  return {
    ...analyzed,
    id: session.id,
    title: session.title || analyzed.title,
    createdAt: session.createdAt,
    insights: createSessionInsights(analyzed)
  };
}

function searchTerms(terms: KnowledgeTerm[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return terms;
  }

  return terms.filter((term) => {
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

function applyCorrectionRules(inputText: string, correctionRules: CorrectionRule[]) {
  return correctionRules.reduce((text, rule) => {
    const original = rule.original.trim();
    const corrected = rule.corrected.trim();
    if (!original || !corrected) {
      return text;
    }
    if (rule.kind === "term" || rule.kind === "expression" || rule.kind === "translation") {
      return text.split(original).join(corrected);
    }
    return text;
  }, inputText);
}

async function copyOrDownloadMarkdown(markdown: string, filename: string) {
  const navigatorLike = (globalThis as { navigator?: Navigator }).navigator;
  if (navigatorLike?.clipboard?.writeText) {
    await navigatorLike.clipboard.writeText(markdown);
    return;
  }

  await downloadTextFile(markdown, filename, "text/markdown;charset=utf-8");
}

async function downloadTextFile(text: string, filename: string, mimeType: string) {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.replace(/[\\/:*?"<>|]/g, "-");
    link.click();
    URL.revokeObjectURL(url);
  }
}

async function selectTextFile(accept: string): Promise<string | null> {
  if (Platform.OS !== "web") {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/json", "text/plain", "*/*"],
      copyToCacheDirectory: true,
      multiple: false
    });

    if (result.canceled) {
      return null;
    }

    const asset = result.assets[0];
    if (!asset) {
      return null;
    }

    const response = await fetch(asset.uri);
    return response.text();
  }

  if (typeof document === "undefined") {
    throw new Error("当前平台不支持文件选择。");
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(resolve).catch(() => resolve(null));
    };
    input.click();
  });
}

async function selectAudioFile(): Promise<{ name: string; blob: Blob } | null> {
  if (Platform.OS !== "web") {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["audio/*", "video/*"],
      copyToCacheDirectory: true,
      multiple: false
    });

    if (result.canceled) {
      return null;
    }

    const asset = result.assets[0];
    if (!asset) {
      return null;
    }

    const response = await fetch(asset.uri);
    return {
      name: asset.name,
      blob: await response.blob()
    };
  }

  if (typeof document === "undefined") {
    throw new Error("当前平台不支持文件选择。");
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*,video/*,.m4a,.mp3,.wav,.webm,.mp4,.mov";
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, blob: file } : null);
    };
    input.click();
  });
}

function formatNow() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
}

function formatDateForFilename(date: Date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(
    date.getDate()
  ).padStart(2, "0")}-${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: colors.background
  },
  shell: {
    flex: 1
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: 110
  },
  header: {
    marginBottom: spacing.xl
  },
  headerCompact: {
    marginBottom: spacing.lg
  },
  kicker: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    lineHeight: 38,
    marginTop: spacing.sm
  },
  titleSmall: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 30,
    marginTop: spacing.sm
  },
  subtitle: {
    color: colors.subtext,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm
  },
  modeGrid: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg
  },
  sceneButton: {
    flex: 1,
    minHeight: 116,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    justifyContent: "space-between"
  },
  sceneIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center"
  },
  sceneTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 20
  },
  sceneText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "700"
  },
  metricsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xl
  },
  metric: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md
  },
  metricValue: {
    fontSize: 21,
    fontWeight: "900"
  },
  metricLabel: {
    color: colors.subtext,
    fontSize: 12,
    marginTop: spacing.xs
  },
  sectionHeader: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.md,
    marginBottom: spacing.sm
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800"
  },
  sectionAction: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "700"
  },
  sessionCard: {
    minHeight: 96,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    marginBottom: spacing.sm,
    overflow: "hidden"
  },
  modeRail: {
    width: 6
  },
  sessionBody: {
    flex: 1,
    padding: spacing.md
  },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm
  },
  cardTitle: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21
  },
  modePill: {
    color: colors.subtext,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden"
  },
  cardMeta: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs
  },
  cardText: {
    color: colors.subtext,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    padding: spacing.xs,
    gap: spacing.xs,
    marginBottom: spacing.lg
  },
  segmentItem: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs
  },
  segmentText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "800"
  },
  segmentTextActive: {
    color: "#ffffff"
  },
  capturePanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.lg
  },
  captureIcon: {
    width: 64,
    height: 64,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md
  },
  panelTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900"
  },
  panelText: {
    color: colors.subtext,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: spacing.sm
  },
  recordButton: {
    minHeight: 44,
    backgroundColor: colors.accent,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg
  },
  recordButtonActive: {
    backgroundColor: colors.text
  },
  recordButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "800"
  },
  captureStatus: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.subtext
  },
  statusDotActive: {
    backgroundColor: colors.success
  },
  captureStatusText: {
    flex: 1,
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  liveTranscript: {
    alignSelf: "stretch",
    color: colors.text,
    backgroundColor: "#edf4ec",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.sm,
    marginTop: spacing.sm,
    overflow: "hidden"
  },
  errorText: {
    alignSelf: "stretch",
    color: colors.accent,
    backgroundColor: "#fff0f0",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.sm,
    marginTop: spacing.sm,
    overflow: "hidden"
  },
  input: {
    minHeight: 128,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  primaryButtonDisabled: {
    opacity: 0.68
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900"
  },
  secondaryButton: {
    minHeight: 46,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900"
  },
  analysisStatusBox: {
    minHeight: 42,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md
  },
  analysisStatusText: {
    flex: 1,
    color: colors.subtext,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18
  },
  providerStatusBox: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md
  },
  providerStatusText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17
  },
  providerSwitchButton: {
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md
  },
  providerSwitchText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900"
  },
  ruleHint: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginBottom: spacing.md
  },
  filterRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md
  },
  filterChip: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  filterChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text
  },
  filterText: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: "800"
  },
  filterTextActive: {
    color: "#ffffff"
  },
  intelCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  confidenceTag: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden"
  },
  scoreRow: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    padding: spacing.sm,
    marginTop: spacing.sm
  },
  scoreBadge: {
    width: 72,
    minHeight: 62,
    borderRadius: 8,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xs
  },
  scoreValue: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "900"
  },
  scoreLabel: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center"
  },
  scoreBody: {
    flex: 1
  },
  signalText: {
    color: colors.subtext,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs
  },
  companyText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
    fontWeight: "700"
  },
  recommendation: {
    color: colors.text,
    backgroundColor: "#f3efe8",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.sm,
    marginTop: spacing.sm,
    overflow: "hidden"
  },
  searchBox: {
    minHeight: 46,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15
  },
  feedGuide: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  feedInput: {
    minHeight: 280,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  correctionKindGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md
  },
  correctionKindButton: {
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: "center",
    paddingHorizontal: spacing.md
  },
  correctionKindButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text
  },
  correctionKindText: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: "800"
  },
  correctionKindTextActive: {
    color: "#ffffff"
  },
  correctionInput: {
    minHeight: 76,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  correctionCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  termCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  termJapanese: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 20,
    fontWeight: "900"
  },
  termChinese: {
    color: colors.meeting,
    fontSize: 15,
    fontWeight: "800",
    marginTop: spacing.xs
  },
  domainTag: {
    color: colors.intel,
    backgroundColor: "#edf4ec",
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden"
  },
  settingRow: {
    minHeight: 76,
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.md
  },
  settingIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center"
  },
  settingText: {
    flex: 1
  },
  settingsPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  assetPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  assetActions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  assetButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm
  },
  assetButtonSecondary: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border
  },
  assetButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900"
  },
  assetButtonTextSecondary: {
    color: colors.text
  },
  assetStatus: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: spacing.sm
  },
  providerRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  providerButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center"
  },
  providerButtonActive: {
    backgroundColor: colors.text,
    borderColor: colors.text
  },
  providerButtonText: {
    color: colors.subtext,
    fontSize: 13,
    fontWeight: "900"
  },
  providerButtonTextActive: {
    color: "#ffffff"
  },
  readonlyPill: {
    minHeight: 40,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    overflow: "hidden"
  },
  inputLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginTop: spacing.md,
    marginBottom: spacing.xs
  },
  singleLineInput: {
    minHeight: 44,
    backgroundColor: colors.background,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(23, 32, 38, 0.38)",
    justifyContent: "flex-end"
  },
  sheet: {
    maxHeight: "86%",
    backgroundColor: colors.background,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingTop: spacing.lg
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 28,
    marginTop: spacing.xs
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border
  },
  sheetContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl
  },
  insightBanner: {
    backgroundColor: "#eef5f1",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cfe1d7",
    padding: spacing.md,
    marginBottom: spacing.md
  },
  smallActionButton: {
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: colors.text,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm
  },
  smallActionText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "900"
  },
  successText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: spacing.sm
  },
  segmentCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  speaker: {
    flex: 1,
    color: colors.meeting,
    fontSize: 13,
    fontWeight: "900"
  },
  timestampText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "900"
  },
  original: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm
  },
  normalized: {
    color: colors.text,
    backgroundColor: "#eaf2f5",
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 21,
    padding: spacing.sm,
    marginTop: spacing.sm,
    overflow: "hidden"
  },
  actionItem: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  actionOwner: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "900"
  },
  infoBlock: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  infoBlockEmphasis: {
    borderColor: colors.language,
    backgroundColor: "#fff8ef"
  },
  infoLabel: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: "900"
  },
  infoText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xs
  },
  tipCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  qaPanel: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md
  },
  questionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md
  },
  questionChip: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs
  },
  questionChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800"
  },
  qaInput: {
    minHeight: 78,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
    lineHeight: 20,
    padding: spacing.md,
    marginTop: spacing.md,
    textAlignVertical: "top"
  },
  askButton: {
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md
  },
  answerText: {
    color: colors.text,
    backgroundColor: "#f3efe8",
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 21,
    padding: spacing.md,
    marginTop: spacing.md,
    overflow: "hidden"
  },
  learningItem: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  learningCategory: {
    color: "#ffffff",
    backgroundColor: colors.meeting,
    borderRadius: 8,
    overflow: "hidden",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignSelf: "flex-start"
  },
  learningBody: {
    flex: 1
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  bulletDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: 7
  },
  bulletText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 21
  },
  tabs: {
    height: 74,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.sm
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    gap: spacing.xs
  },
  tabLabel: {
    color: colors.subtext,
    fontSize: 11,
    fontWeight: "800"
  },
  tabLabelActive: {
    color: colors.accent
  }
});
