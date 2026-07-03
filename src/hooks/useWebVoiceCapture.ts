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

const WEB_AUDIO_BITS_PER_SECOND = 24000;
const WEB_AUDIO_TIMESLICE_MS = 5000;

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
  const recorderMimeTypeRef = useRef("audio/webm");

  const SpeechRecognition = useMemo(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const webWindow = window as WebWindow;
    return webWindow.SpeechRecognition ?? webWindow.webkitSpeechRecognition;
  }, []);

  const isSecureWebContext =
    Platform.OS !== "web" ||
    (typeof window !== "undefined" &&
      (window.isSecureContext || ["localhost", "127.0.0.1"].includes(window.location.hostname)));

  const isSupported =
    Platform.OS !== "web" ||
    (isSecureWebContext && typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));

  const stopWebRecording = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;

    const mediaRecorder = mediaRecorderRef.current;
    if (!mediaRecorder) {
      stopTracks(streamRef.current);
      streamRef.current = null;
      return Promise.resolve(null);
    }

    return new Promise<Blob | null>((resolve) => {
      const finish = () => {
        const blob =
          chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: mediaRecorder.mimeType || recorderMimeTypeRef.current })
            : null;
        if (blob) {
          setAudioBlob(blob);
        }
        mediaRecorderRef.current = null;
        stopTracks(streamRef.current);
        streamRef.current = null;
        resolve(blob);
      };

      mediaRecorder.onstop = finish;
      if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
        mediaRecorder.requestData();
        mediaRecorder.stop();
      } else {
        finish();
      }
    });
  }, []);

  const stop = useCallback(async () => {
    try {
      if (Platform.OS === "web") {
        await stopWebRecording();
      } else if (isRecording) {
        await nativeRecorder.stop();
        if (nativeRecorder.uri) {
          const response = await fetch(nativeRecorder.uri);
          setAudioBlob(await response.blob());
        }
      }
      setStatus("录音已停止，音频已准备好，可转写或生成结构化分析。");
    } catch (stopError) {
      const message = stopError instanceof Error ? stopError.message : "停止录音失败。";
      setError(message);
    } finally {
      setIsRecording(false);
      setInterimTranscript("");
    }
  }, [isRecording, nativeRecorder, stopWebRecording]);

  const startWebRecording = useCallback(async () => {
    if (!isSecureWebContext) {
      throw new Error("浏览器麦克风要求 HTTPS。请使用 Vercel HTTPS 地址，或在原生 App/Expo Go 中录音。");
    }

    setStatus("正在请求麦克风权限...");
    setAudioBlob(null);
    setTranscript("");
    setInterimTranscript("");
    chunksRef.current = [];

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000
      }
    });
    streamRef.current = stream;

    const mimeType = getSupportedRecordingMimeType();
    recorderMimeTypeRef.current = mimeType || "audio/webm";
    const recorderOptions: MediaRecorderOptions = { audioBitsPerSecond: WEB_AUDIO_BITS_PER_SECOND };
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
    }
    const mediaRecorder = new MediaRecorder(stream, recorderOptions);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(WEB_AUDIO_TIMESLICE_MS);

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
          setTranscript((current) => `${current}\n${finalText}`.trim());
        }
        setInterimTranscript(interimText);
      };
      recognition.onerror = (event) => {
        setError(event.message || event.error || "浏览器实时识别失败；录音文件仍会保留，可停止后转写。");
      };
      recognition.onend = () => setInterimTranscript("");
      recognitionRef.current = recognition;
      recognition.start();
      setStatus("正在录音，并尝试浏览器实时识别；停止后会保留音频用于 OpenAI 转写。");
    } else {
      setStatus("正在录音；当前浏览器不支持实时语音识别，停止后可上传音频转写。");
    }
  }, [SpeechRecognition, isSecureWebContext, mode]);

  const startNativeRecording = useCallback(async () => {
    setStatus("正在请求麦克风权限...");
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error("未获得麦克风权限。请在系统设置里允许本 App 使用麦克风。");
    }

    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true
    });
    setAudioBlob(null);
    setTranscript("");
    setInterimTranscript("");
    await nativeRecorder.prepareToRecordAsync();
    nativeRecorder.record();
    setStatus("正在录音；停止后可转写和学习录音内容。");
  }, [nativeRecorder]);

  const start = useCallback(async () => {
    if (!isSupported) {
      setError("当前环境不支持录音。PWA 录音需要 HTTPS；也可以选择手机已有录音文件。");
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
        await stopWebRecording();
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
        void stopWebRecording();
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

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  return candidates.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function stopTracks(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
