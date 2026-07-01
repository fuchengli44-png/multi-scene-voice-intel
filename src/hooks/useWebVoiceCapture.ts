import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { SceneMode } from "../types";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
}

type WebWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

const modeLanguage: Record<SceneMode, string> = {
  meeting: "ja-JP",
  language: "ja-JP",
  intel: "zh-CN"
};

export function useWebVoiceCapture(mode: SceneMode) {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("录音待命");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const SpeechRecognition = useMemo(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const webWindow = window as WebWindow;
    return webWindow.SpeechRecognition ?? webWindow.webkitSpeechRecognition;
  }, []);

  const isSupported =
    Platform.OS !== "web" ||
    (typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));

  const stopWebRecording = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(async () => {
    try {
      if (Platform.OS === "web") {
        stopWebRecording();
      } else if (isRecording) {
        await nativeRecorder.stop();
        if (nativeRecorder.uri) {
          const response = await fetch(nativeRecorder.uri);
          setAudioBlob(await response.blob());
        }
      }
      setStatus("录音已停止，可转写或生成结构化分析");
    } catch (stopError) {
      const message = stopError instanceof Error ? stopError.message : "停止录音失败。";
      setError(message);
    } finally {
      setIsRecording(false);
      setInterimTranscript("");
    }
  }, [isRecording, nativeRecorder, stopWebRecording]);

  const startWebRecording = useCallback(async () => {
    setStatus("正在请求麦克风权限");
    setAudioBlob(null);
    chunksRef.current = [];
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    mediaRecorder.onstop = () => {
      if (chunksRef.current.length > 0) {
        setAudioBlob(new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" }));
      }
    };
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start();

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = modeLanguage[mode];
      recognition.onresult = (event) => {
        let finalText = "";
        let interimText = "";

        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result) continue;
          const text = result[0]?.transcript.trim();
          if (!text) continue;
          if (result.isFinal) {
            finalText += `${text}\n`;
          } else {
            interimText += text;
          }
        }

        if (finalText) {
          setTranscript((current) => `${current}${finalText}`.trim());
        }
        setInterimTranscript(interimText);
      };
      recognition.onerror = (event) => {
        setError(event.message || event.error || "浏览器实时语音识别失败，可停止后上传录音转写。");
      };
      recognition.onend = () => setInterimTranscript("");
      recognitionRef.current = recognition;
      recognition.start();
      setStatus("正在录音并尝试实时识别");
    } else {
      setStatus("正在录音；当前浏览器不支持实时语音识别，停止后可转写音频");
    }
  }, [SpeechRecognition, mode]);

  const startNativeRecording = useCallback(async () => {
    setStatus("正在请求麦克风权限");
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error("未获得麦克风权限。");
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true
    });
    await nativeRecorder.prepareToRecordAsync();
    nativeRecorder.record();
    setAudioBlob(null);
    setStatus("正在录音；停止后可转写和学习录音内容");
  }, [nativeRecorder]);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError("当前环境不支持录音，请使用选择录音文件。");
      return;
    }

    try {
      setError(null);
      if (Platform.OS === "web") {
        await startWebRecording();
      } else {
        await startNativeRecording();
      }
      setIsRecording(true);
    } catch (captureError) {
      const message = captureError instanceof Error ? captureError.message : "无法启动麦克风。";
      setError(message);
      setStatus("录音启动失败");
      if (Platform.OS === "web") {
        stopWebRecording();
      }
      setIsRecording(false);
    }
  }, [isSupported, startNativeRecording, startWebRecording, stopWebRecording]);

  const reset = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setAudioBlob(null);
    chunksRef.current = [];
    setError(null);
    setStatus("录音待命");
  }, []);

  useEffect(() => {
    return () => {
      if (Platform.OS === "web") {
        stopWebRecording();
      }
    };
  }, [stopWebRecording]);

  return {
    audioBlob,
    error,
    interimTranscript,
    isRecording,
    isSupported,
    reset,
    start,
    status,
    stop,
    transcript
  };
}
