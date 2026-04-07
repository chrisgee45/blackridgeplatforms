import { useState, useEffect, useRef, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

type WidgetStatus = "online" | "speaking" | "thinking" | "listening";

const RIDGE_STYLES = `
@keyframes ridge-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.7; }
}
@keyframes ridge-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ridge-slide-up {
  from { opacity: 0; transform: translateY(20px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes ridge-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-8px); }
}
@keyframes ridge-wave {
  0%, 100% { height: 4px; }
  50% { height: 100%; }
}
@keyframes ridge-glow-pulse {
  0%, 100% { box-shadow: 0 0 6px rgba(59,130,246,0.3); }
  50% { box-shadow: 0 0 16px rgba(59,130,246,0.7); }
}
`;

function injectStyles() {
  if (document.getElementById("ridge-styles")) return;
  const style = document.createElement("style");
  style.id = "ridge-styles";
  style.textContent = RIDGE_STYLES;
  document.head.appendChild(style);
}

function WaveformBar({ color, active }: { color: string; active: boolean }) {
  return (
    <div className="flex items-center justify-center gap-[3px] h-5 px-4">
      {Array.from({ length: 24 }).map((_, i) => (
        <div
          key={i}
          style={{
            width: "2px",
            height: active ? undefined : "4px",
            backgroundColor: color,
            borderRadius: "1px",
            animation: active ? `ridge-wave 0.6s ease-in-out ${i * 0.04}s infinite` : "none",
            transition: "height 0.2s ease",
            minHeight: "2px",
            maxHeight: "20px",
          }}
        />
      ))}
    </div>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            backgroundColor: "#C9A840",
            animation: `ridge-dot-bounce 1.2s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;
const FRAME_HEADER_SIZE = 5;

export default function RidgeWidget({ autoGreet = false }: { autoGreet?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [status, setStatus] = useState<WidgetStatus>("online");
  const [hasNotification, setHasNotification] = useState(true);
  const [reportSentFor, setReportSentFor] = useState<Set<number>>(new Set());
  const [sendingReport, setSendingReport] = useState<Set<number>>(new Set());
  const [muted, setMuted] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const mutedRef = useRef(false);
  const conversationRef = useRef<Message[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef(new Audio());
  const recognitionRef = useRef<any>(null);
  const greetedRef = useRef(false);
  const statusRef = useRef<WidgetStatus>("online");
  const speechEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpenRef = useRef(false);
  const transcriptBufferRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningWhileSpeakingRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { injectStyles(); }, []);
  useEffect(() => { conversationRef.current = messages; }, [messages]);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, status]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      audioRef.current.pause();
      audioRef.current.src = "";
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }
      if (speechEndTimeoutRef.current) clearTimeout(speechEndTimeoutRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const resp = await fetch("/api/ridge/conversations", { credentials: "include" });
      if (resp.ok) setConversations(await resp.json());
    } catch {}
  }, []);

  const createConversation = useCallback(async (): Promise<string | null> => {
    try {
      const resp = await fetch("/api/ridge/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (resp.ok) {
        const data = await resp.json();
        setConversationId(data.id);
        conversationIdRef.current = data.id;
        return data.id;
      }
    } catch {}
    return null;
  }, []);

  const loadConversationMessages = useCallback(async (convoId: string) => {
    setLoadingHistory(true);
    try {
      const resp = await fetch(`/api/ridge/conversations/${convoId}/messages`, { credentials: "include" });
      if (resp.ok) {
        const data = await resp.json();
        const msgs: Message[] = data.map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: new Date(m.createdAt),
        }));
        setMessages(msgs);
        setConversationId(convoId);
        conversationIdRef.current = convoId;
        setReportSentFor(new Set());
        setSendingReport(new Set());
      }
    } catch {}
    setLoadingHistory(false);
    setShowHistory(false);
  }, []);

  const deleteConversation = useCallback(async (convoId: string) => {
    try {
      await fetch(`/api/ridge/conversations/${convoId}`, {
        method: "DELETE",
        credentials: "include",
      });
      setConversations((prev) => prev.filter((c) => c.id !== convoId));
      if (conversationIdRef.current === convoId) {
        setConversationId(null);
        conversationIdRef.current = null;
        setMessages([]);
      }
    } catch {}
  }, []);

  const stopRidge = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    audioRef.current.pause();
    audioRef.current.src = "";
    audioRef.current.onended = null;
    audioRef.current.onerror = null;
    window.speechSynthesis?.cancel();
    if (speechEndTimeoutRef.current) {
      clearTimeout(speechEndTimeoutRef.current);
      speechEndTimeoutRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    listeningWhileSpeakingRef.current = false;
    transcriptBufferRef.current = "";
    setStatus("online");
    statusRef.current = "online";
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    transcriptBufferRef.current = "";

    recognition.onstart = () => {
      if (!listeningWhileSpeakingRef.current) {
        setStatus("listening");
        statusRef.current = "listening";
      }
    };

    recognition.onresult = (e: any) => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      if (listeningWhileSpeakingRef.current) {
        listeningWhileSpeakingRef.current = false;
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.onended = null;
        window.speechSynthesis?.cancel();
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        setStatus("listening");
        statusRef.current = "listening";
      }

      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
        else interimTranscript += e.results[i][0].transcript;
      }

      if (finalTranscript.trim()) {
        transcriptBufferRef.current += " " + finalTranscript.trim();
      }

      if (interimTranscript) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      if (finalTranscript.trim()) {
        silenceTimerRef.current = setTimeout(() => {
          const fullText = transcriptBufferRef.current.trim();
          if (fullText) {
            try { recognitionRef.current?.stop(); } catch {}
            recognitionRef.current = null;
            transcriptBufferRef.current = "";
            setStatus("online");
            statusRef.current = "online";
            streamRidgeRef.current(fullText);
          }
        }, 700);
      }
    };

    recognition.onspeechend = () => {
      if (!silenceTimerRef.current) {
        silenceTimerRef.current = setTimeout(() => {
          const fullText = transcriptBufferRef.current.trim();
          if (fullText) {
            try { recognitionRef.current?.stop(); } catch {}
            recognitionRef.current = null;
            transcriptBufferRef.current = "";
            setStatus("online");
            statusRef.current = "online";
            streamRidgeRef.current(fullText);
          } else {
            try { recognitionRef.current?.stop(); } catch {}
            recognitionRef.current = null;
            setStatus("online");
            statusRef.current = "online";
          }
        }, 800);
      }
    };

    recognition.onend = () => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      const fullText = transcriptBufferRef.current.trim();
      if (fullText && statusRef.current === "listening") {
        transcriptBufferRef.current = "";
        setStatus("online");
        statusRef.current = "online";
        streamRidgeRef.current(fullText);
      } else if (statusRef.current === "listening") {
        setStatus("online");
        statusRef.current = "online";
      }
    };

    recognition.onnomatch = () => { if (!listeningWhileSpeakingRef.current) stopRidge(); };
    recognition.onerror = (e: any) => {
      if (e.error === "no-speech" && listeningWhileSpeakingRef.current) return;
      if (!listeningWhileSpeakingRef.current) stopRidge();
    };

    recognition.start();
  }, [stopRidge]);

  const startPassiveListening = useCallback(() => {
    if (mutedRef.current) return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
    listeningWhileSpeakingRef.current = true;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    transcriptBufferRef.current = "";

    recognition.onresult = (e: any) => {
      let hasContent = false;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i][0].transcript.trim().length > 0) hasContent = true;
      }
      if (hasContent && listeningWhileSpeakingRef.current) {
        listeningWhileSpeakingRef.current = false;
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current.onended = null;
        window.speechSynthesis?.cancel();
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        try { recognitionRef.current?.abort(); } catch {}
        recognitionRef.current = null;
        setStatus("listening");
        statusRef.current = "listening";
        setTimeout(() => startListening(), 50);
      }
    };

    recognition.onend = () => {
      if (listeningWhileSpeakingRef.current) listeningWhileSpeakingRef.current = false;
      recognitionRef.current = null;
    };
    recognition.onerror = () => { recognitionRef.current = null; };
    try { recognition.start(); } catch {}
  }, [startListening]);

  const interruptAndListen = useCallback(() => {
    listeningWhileSpeakingRef.current = false;
    stopRidge();
    setTimeout(() => startListening(), 50);
  }, [stopRidge, startListening]);

  const sendReport = useCallback(async (content: string, msgIndex: number) => {
    if (sendingReport.has(msgIndex) || reportSentFor.has(msgIndex)) return;
    setSendingReport((prev) => new Set(prev).add(msgIndex));
    const firstSentence = content.split(/[.!?]/)[0]?.trim() || "RIDGE CFO Report";
    const subject = `RIDGE Report: ${firstSentence.slice(0, 80)}`;
    try {
      const resp = await fetch("/api/ridge/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content, subject }),
      });
      if (resp.ok) setReportSentFor((prev) => new Set(prev).add(msgIndex));
    } catch {}
    setSendingReport((prev) => {
      const next = new Set(prev);
      next.delete(msgIndex);
      return next;
    });
  }, [sendingReport, reportSentFor]);

  const streamRidge = useCallback(async (userText: string) => {
    const userMsg: Message = { role: "user", content: userText, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setStatus("thinking");
    statusRef.current = "thinking";

    let activeConvoId = conversationIdRef.current;
    if (!activeConvoId) {
      activeConvoId = await createConversation();
    }

    const history = [...conversationRef.current, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const resp = await fetch("/api/ridge/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: history.slice(-20),
          conversationId: activeConvoId,
        }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error("Stream failed");

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No stream");

      let fullText = "";
      let reportSent = false;
      let audioPlaying = false;
      let pendingAudioQueue: Blob[] = [];
      let isProcessingQueue = false;
      let currentObjUrl: string | null = null;

      async function playNextAudio() {
        if (isProcessingQueue || pendingAudioQueue.length === 0) return;
        if (statusRef.current !== "speaking" && statusRef.current !== "thinking") return;
        isProcessingQueue = true;

        while (pendingAudioQueue.length > 0) {
          if (statusRef.current !== "speaking" && statusRef.current !== "thinking") break;
          const blob = pendingAudioQueue.shift()!;
          const url = URL.createObjectURL(blob);
          currentObjUrl = url;
          const audio = audioRef.current;
          audio.src = url;

          if (!audioPlaying) {
            audioPlaying = true;
            setStatus("speaking");
            statusRef.current = "speaking";
            // Don't start passive listening here — mic picks up Ridge's own
            // voice and kills audio playback. Listening starts after all
            // audio finishes in the cleanup below.
          }

          await new Promise<void>((resolve) => {
            audio.onended = () => { URL.revokeObjectURL(url); currentObjUrl = null; resolve(); };
            audio.onerror = () => { URL.revokeObjectURL(url); currentObjUrl = null; resolve(); };
            audio.play().catch(() => { URL.revokeObjectURL(url); currentObjUrl = null; resolve(); });
          });

          if (statusRef.current !== "speaking") {
            if (currentObjUrl) { URL.revokeObjectURL(currentObjUrl); currentObjUrl = null; }
            break;
          }
        }

        isProcessingQueue = false;
      }

      let buffer = new Uint8Array(0);
      let audioAccumulator: Uint8Array[] = [];
      let lastAudioFlush = Date.now();

      function appendBuffer(chunk: Uint8Array) {
        const newBuf = new Uint8Array(buffer.length + chunk.length);
        newBuf.set(buffer);
        newBuf.set(chunk, buffer.length);
        buffer = newBuf;
      }

      function processBuffer() {
        while (buffer.length >= FRAME_HEADER_SIZE) {
          const frameType = buffer[0];
          const payloadLen = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];

          if (payloadLen < 0 || payloadLen > 10_000_000) {
            buffer = new Uint8Array(0);
            return;
          }

          if (buffer.length < FRAME_HEADER_SIZE + payloadLen) return;

          const payload = buffer.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + payloadLen);
          buffer = buffer.slice(FRAME_HEADER_SIZE + payloadLen);

          if (frameType === FRAME_TEXT) {
            const text = new TextDecoder().decode(payload);
            fullText += (fullText ? " " : "") + text;
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                return [...prev.slice(0, -1), { ...last, content: fullText }];
              }
              return [...prev, { role: "assistant" as const, content: fullText, timestamp: new Date() }];
            });
          } else if (frameType === FRAME_AUDIO) {
            audioAccumulator.push(payload);
            const totalSize = audioAccumulator.reduce((s, c) => s + c.length, 0);
            const timeSinceFlush = Date.now() - lastAudioFlush;
            if (totalSize > 8000 || timeSinceFlush > 500) {
              const blob = new Blob(audioAccumulator, { type: "audio/mpeg" });
              audioAccumulator = [];
              lastAudioFlush = Date.now();
              if (!mutedRef.current) {
                pendingAudioQueue.push(blob);
                playNextAudio();
              }
            }
          } else if (frameType === FRAME_DONE) {
            try {
              const meta = JSON.parse(new TextDecoder().decode(payload));
              if (meta.fullReply) {
                fullText = meta.fullReply;
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last?.role === "assistant") {
                    return [...prev.slice(0, -1), { ...last, content: fullText }];
                  }
                  return [...prev, { role: "assistant" as const, content: fullText, timestamp: new Date() }];
                });
              }
              reportSent = meta.reportSent || false;
            } catch {}
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        appendBuffer(value);
        processBuffer();
      }

      processBuffer();
      if (audioAccumulator.length > 0) {
        const blob = new Blob(audioAccumulator, { type: "audio/mpeg" });
        audioAccumulator = [];
        if (!mutedRef.current) {
          pendingAudioQueue.push(blob);
          playNextAudio();
        }
      }

      const waitForAudio = () => new Promise<void>((resolve) => {
        const check = () => {
          if (pendingAudioQueue.length === 0 && !isProcessingQueue) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      if (!mutedRef.current && pendingAudioQueue.length > 0) {
        await waitForAudio();
      }

      if (currentObjUrl) { URL.revokeObjectURL(currentObjUrl); currentObjUrl = null; }

      if (!fullText) fullText = "No response.";

      if (reportSent) {
        const currentMessages = conversationRef.current;
        const newIndex = currentMessages.length - 1;
        setReportSentFor((prev) => new Set(prev).add(newIndex));
      }

      if (statusRef.current === "speaking" || statusRef.current === "thinking") {
        if (mutedRef.current) {
          setStatus("online");
          statusRef.current = "online";
        } else {
          setStatus("online");
          statusRef.current = "online";
          setTimeout(() => startListening(), 30);
        }
      }
    } catch (e: any) {
      if (e.name === "AbortError") return;
      const errorMsg: Message = {
        role: "assistant",
        content: "Connection interrupted. I'll be back online shortly.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStatus("online");
      statusRef.current = "online";
    }
  }, [createConversation, startListening, startPassiveListening]);

  const streamRidgeRef = useRef(streamRidge);
  useEffect(() => { streamRidgeRef.current = streamRidge; }, [streamRidge]);

  const speak = useCallback(async (text: string) => {
    setStatus("speaking");
    statusRef.current = "speaking";
    try {
      const resp = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ text }),
      });
      if (!resp.ok) throw new Error("TTS failed: " + resp.status);
      const blob = await resp.blob();
      console.log("[Ridge] speak() got blob:", blob.size, "bytes, type:", blob.type);
      const url = URL.createObjectURL(blob);
      const audio = audioRef.current;
      audio.src = url;
      // Don't start passive listening until audio finishes — the mic picks up
      // Ridge's own speaker output and kills playback via src="" in the
      // recognition callback.
      audio.onended = () => {
        console.log("[Ridge] audio.onended fired");
        URL.revokeObjectURL(url);
        if (statusRef.current === "speaking") {
          if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch {}
            recognitionRef.current = null;
          }
          listeningWhileSpeakingRef.current = false;
          setStatus("online");
          statusRef.current = "online";
          if (!mutedRef.current) setTimeout(() => startListening(), 30);
        }
      };
      audio.onerror = (e) => {
        console.error("[Ridge] audio.onerror fired:", e, "audio.error:", audio.error);
        URL.revokeObjectURL(url);
        if (statusRef.current === "speaking") {
          setStatus("online");
          statusRef.current = "online";
        }
      };
      console.log("[Ridge] calling audio.play()...");
      await audio.play();
      console.log("[Ridge] audio.play() succeeded");
    } catch (err) {
      console.error("[Ridge] speak() caught error:", err);
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.pitch = 0.8;
        utterance.rate = 0.95;
        utterance.onend = () => {
          if (statusRef.current === "speaking") {
            setStatus("online");
            statusRef.current = "online";
            if (!mutedRef.current) setTimeout(() => startListening(), 30);
          }
        };
        utterance.onerror = () => { setStatus("online"); statusRef.current = "online"; };
        speechSynthesis.speak(utterance);
      } catch {
        setStatus("online");
        statusRef.current = "online";
      }
    }
  }, [startListening, startPassiveListening]);

  const startNewConversation = useCallback(() => {
    stopRidge();
    setConversationId(null);
    conversationIdRef.current = null;
    setMessages([]);
    setReportSentFor(new Set());
    setSendingReport(new Set());
    setShowHistory(false);
    greetedRef.current = false;
  }, [stopRidge]);

  const ridgeGreet = useCallback(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;
    setHasNotification(true);
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";
    const greeting = `${timeOfDay}, Chris — RIDGE online and monitoring. Financials are syncing. Ask me anything or I will flag you when something needs your attention.`;
    const greetMsg: Message = { role: "assistant", content: greeting, timestamp: new Date() };
    setMessages([greetMsg]);
    // Don't auto-speak — Chrome blocks audio.play() without user interaction.
    // Show notification dot; Ridge will speak when user clicks the widget.
  }, []);

  const ridgeAlert = useCallback((text: string) => {
    setIsOpen(true);
    setHasNotification(false);
    const alertMsg: Message = { role: "assistant", content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, alertMsg]);
    speak(text);
  }, [speak]);

  useEffect(() => {
    (window as any).ridgeGreet = ridgeGreet;
    (window as any).ridgeAlert = ridgeAlert;
    return () => {
      delete (window as any).ridgeGreet;
      delete (window as any).ridgeAlert;
    };
  }, [ridgeGreet, ridgeAlert]);

  useEffect(() => {
    if (autoGreet && !greetedRef.current) {
      const timer = setTimeout(ridgeGreet, 1200);
      return () => clearTimeout(timer);
    }
  }, [autoGreet, ridgeGreet]);

  useEffect(() => {
    const handleSpace = (e: KeyboardEvent) => {
      if (!isOpenRef.current) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.code === "Space") {
        e.preventDefault();
        interruptAndListen();
      }
    };
    window.addEventListener("keydown", handleSpace);
    return () => window.removeEventListener("keydown", handleSpace);
  }, [interruptAndListen]);

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || status === "thinking") return;
    stopRidge();
    setInputText("");
    streamRidge(text);
  };

  const toggleMic = () => {
    if (statusRef.current === "listening") {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      const fullText = transcriptBufferRef.current.trim();
      if (fullText) {
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch {}
          recognitionRef.current = null;
        }
        transcriptBufferRef.current = "";
        setStatus("online");
        statusRef.current = "online";
        streamRidge(fullText);
        return;
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
        recognitionRef.current = null;
      }
      setStatus("online");
      statusRef.current = "online";
      return;
    }
    interruptAndListen();
  };

  const handlePanelClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("textarea")) return;
    if (statusRef.current === "speaking") interruptAndListen();
  };

  // Track whether we've spoken the greeting yet (deferred until user clicks)
  const spokenGreetRef = useRef(false);

  const toggleOpen = () => {
    if (isOpen) {
      stopRidge();
      setShowHistory(false);
    }
    setIsOpen((prev) => !prev);
    if (!isOpen) {
      setHasNotification(false);
      // Speak the greeting on first open (user click = Chrome allows audio)
      if (!spokenGreetRef.current && messages.length > 0 && messages[0]?.role === "assistant") {
        spokenGreetRef.current = true;
        speak(messages[0].content);
      }
    }
  };

  const handleEmailReport = (content: string, index: number) => sendReport(content, index);

  const toggleHistory = () => {
    if (!showHistory) loadConversations();
    setShowHistory((prev) => !prev);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const statusColor = status === "online" ? "#22c55e" : status === "speaking" || status === "thinking" ? "#C9A840" : "#3b82f6";
  const statusLabel = status === "listening" ? "Listening..." : status === "speaking" ? "Speaking" : status === "thinking" ? "Thinking..." : "Online";

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999 }} data-testid="ridge-widget">
      {isOpen && (
        <div
          onClick={handlePanelClick}
          style={{
            width: 372,
            height: 534,
            backgroundColor: "#111111",
            borderRadius: 16,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            marginBottom: 12,
            boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
            animation: "ridge-slide-up 0.3s ease-out",
            position: "relative",
          }}
          data-testid="ridge-panel"
        >
          {/* Header */}
          <div
            style={{
              backgroundColor: "#0A0A0A",
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid #222",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32, height: 32, borderRadius: "50%",
                  border: "2px solid #C9A840", backgroundColor: "#0A0A0A",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "Georgia, serif", color: "#C9A840", fontSize: 16, fontWeight: "bold",
                }}
              >
                R
              </div>
              <div>
                <div style={{ fontFamily: "Georgia, serif", color: "#C9A840", fontSize: 15, fontWeight: "bold", lineHeight: 1.2 }}>RIDGE</div>
                <div style={{ color: "#666", fontSize: 10, letterSpacing: "0.08em" }}>{statusLabel}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: statusColor, boxShadow: `0 0 6px ${statusColor}`, transition: "all 0.3s" }} />
              <button onClick={toggleHistory} style={{ background: "none", border: "none", color: showHistory ? "#C9A840" : "#666", fontSize: 16, cursor: "pointer", padding: 4, lineHeight: 1, transition: "color 0.2s" }} title="Conversation history" data-testid="button-ridge-history">☰</button>
              <button onClick={startNewConversation} style={{ background: "none", border: "none", color: "#666", fontSize: 16, cursor: "pointer", padding: 4, lineHeight: 1 }} title="New conversation" data-testid="button-ridge-new-convo">＋</button>
              <button onClick={toggleOpen} style={{ background: "none", border: "none", color: "#666", fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1 }} data-testid="button-ridge-close">✕</button>
            </div>
          </div>

          {/* Conversation History Panel */}
          {showHistory && (
            <div style={{ position: "absolute", top: 56, left: 0, right: 0, bottom: 0, backgroundColor: "#111111", zIndex: 10, display: "flex", flexDirection: "column", animation: "ridge-fade-in 0.2s ease-out" }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid #222", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#C9A840", fontFamily: "Georgia, serif", fontSize: 14, fontWeight: "bold" }}>Conversations</span>
                <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", color: "#666", fontSize: 14, cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                {conversations.length === 0 ? (
                  <div style={{ color: "#555", fontSize: 13, textAlign: "center", padding: 20 }}>No past conversations yet</div>
                ) : (
                  conversations.map((convo) => (
                    <div
                      key={convo.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
                        borderRadius: 8, cursor: "pointer",
                        backgroundColor: conversationId === convo.id ? "#1A2A40" : "transparent",
                        transition: "background-color 0.2s", marginBottom: 2,
                      }}
                      onMouseEnter={(e) => { if (conversationId !== convo.id) e.currentTarget.style.backgroundColor = "#1C1C1C"; }}
                      onMouseLeave={(e) => { if (conversationId !== convo.id) e.currentTarget.style.backgroundColor = "transparent"; }}
                      data-testid={`button-convo-${convo.id}`}
                    >
                      <div onClick={() => loadConversationMessages(convo.id)} style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#e0e0e0", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{convo.title || "Untitled"}</div>
                        <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>{formatDate(convo.updatedAt)}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteConversation(convo.id); }}
                        style={{ background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer", padding: "2px 4px", flexShrink: 0, transition: "color 0.2s" }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = "#555"; }}
                        title="Delete conversation"
                        data-testid={`button-delete-convo-${convo.id}`}
                      >🗑</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Waveform + Status Bar */}
          {(status === "speaking" || status === "listening") && (
            <div style={{ backgroundColor: "#0A0A0A", borderBottom: "1px solid #222" }}>
              <WaveformBar color={status === "speaking" ? "#C9A840" : "#3b82f6"} active={true} />
              <div style={{ textAlign: "center", fontSize: 10, color: "#555", paddingBottom: 4, letterSpacing: "0.05em" }}>
                {status === "speaking" ? (muted ? "mic muted — tap to interrupt" : "tap anywhere or just start talking to interrupt") : "speak naturally — I'm listening"}
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflowY: "auto", padding: 16,
              display: "flex", flexDirection: "column", gap: 12,
            }}
          >
            {loadingHistory && (
              <div style={{ color: "#555", fontSize: 13, textAlign: "center", padding: 20 }}>Loading conversation...</div>
            )}

            {/* Voice-first: show waveform area when speaking */}
            {status === "speaking" && !showTranscript && messages.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flex: 1, gap: 12, animation: "ridge-fade-in 0.3s ease-out" }}>
                <div style={{
                  width: 64, height: 64, borderRadius: "50%",
                  border: "3px solid #C9A840", backgroundColor: "#0A0A0A",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "Georgia, serif", color: "#C9A840", fontSize: 28, fontWeight: "bold",
                  animation: "ridge-pulse 2s ease-in-out infinite",
                }}>R</div>
                <div style={{ color: "#C9A840", fontSize: 13, fontFamily: "Georgia, serif", letterSpacing: "0.05em" }}>RIDGE is speaking...</div>
              </div>
            )}

            {/* Transcript toggle */}
            {messages.length > 0 && (
              <button
                onClick={() => setShowTranscript(!showTranscript)}
                style={{
                  background: "none", border: "1px solid #333", borderRadius: 6,
                  color: showTranscript ? "#C9A840" : "#555", fontSize: 10, padding: "3px 10px",
                  cursor: "pointer", alignSelf: "center", transition: "all 0.2s",
                  letterSpacing: "0.05em",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#C9A840"; e.currentTarget.style.color = "#C9A840"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = showTranscript ? "#C9A840" : "#555"; }}
                data-testid="button-toggle-transcript"
              >
                {showTranscript ? "HIDE TRANSCRIPT" : "SHOW TRANSCRIPT"}
              </button>
            )}

            {/* Messages (shown when transcript is visible or thinking) */}
            {(showTranscript || status === "thinking" || messages.length === 0) && messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  alignItems: "flex-start", gap: 8,
                  animation: "ridge-fade-in 0.3s ease-out",
                }}
              >
                {msg.role === "assistant" && (
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%",
                    backgroundColor: "#C9A840", display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "Georgia, serif", color: "#0A0A0A", fontSize: 11, fontWeight: "bold",
                    flexShrink: 0, marginTop: 2,
                  }}>R</div>
                )}
                <div
                  style={{
                    backgroundColor: msg.role === "user" ? "#1A2A40" : "#1C1C1C",
                    color: "#e0e0e0", padding: "10px 14px", borderRadius: 12,
                    fontSize: 13, lineHeight: 1.5, maxWidth: "80%", wordBreak: "break-word",
                  }}
                  data-testid={`text-ridge-message-${i}`}
                >
                  {msg.content}
                  {msg.role === "assistant" && i > 0 && (
                    <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      {reportSentFor.has(i) ? (
                        <div style={{ fontSize: 10, color: "#22c55e", display: "flex", alignItems: "center", gap: 4, animation: "ridge-fade-in 0.3s ease-out" }} data-testid={`text-report-sent-${i}`}>
                          <span style={{ fontSize: 12 }}>✓</span> Report emailed
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleEmailReport(msg.content, i); }}
                          disabled={sendingReport.has(i)}
                          style={{
                            background: "none", border: "1px solid #333", borderRadius: 6,
                            color: sendingReport.has(i) ? "#555" : "#888", fontSize: 10,
                            padding: "3px 8px", cursor: sendingReport.has(i) ? "default" : "pointer",
                            display: "flex", alignItems: "center", gap: 4, transition: "all 0.2s",
                          }}
                          onMouseEnter={(e) => { if (!sendingReport.has(i)) { e.currentTarget.style.borderColor = "#C9A840"; e.currentTarget.style.color = "#C9A840"; } }}
                          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#333"; e.currentTarget.style.color = "#888"; }}
                          data-testid={`button-email-report-${i}`}
                        >
                          {sendingReport.has(i) ? "Sending..." : "📧 Email this"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {status === "thinking" && (
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%",
                  backgroundColor: "#C9A840", display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "Georgia, serif", color: "#0A0A0A", fontSize: 11, fontWeight: "bold",
                  flexShrink: 0, marginTop: 2,
                }}>R</div>
                <div style={{ backgroundColor: "#1C1C1C", borderRadius: 12, padding: "6px 8px" }}>
                  <ThinkingDots />
                </div>
              </div>
            )}
          </div>

          {/* Bottom Bar */}
          <div style={{ padding: "10px 12px", borderTop: "1px solid #222", backgroundColor: "#0A0A0A", display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => {
                const next = !muted;
                setMuted(next);
                mutedRef.current = next;
                if (next && recognitionRef.current && statusRef.current !== "listening") {
                  try { recognitionRef.current.abort(); } catch {}
                  recognitionRef.current = null;
                  listeningWhileSpeakingRef.current = false;
                }
              }}
              style={{
                width: 28, height: 28, borderRadius: "50%", border: "none",
                backgroundColor: muted ? "#dc2626" : "#1C1C1C",
                color: muted ? "#fff" : "#555",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 12, transition: "all 0.2s", flexShrink: 0,
              }}
              title={muted ? "Unmute mic — RIDGE won't auto-listen" : "Mute mic — stop auto-listening"}
              data-testid="button-ridge-mute"
            >
              {muted ? "🔇" : "🔊"}
            </button>
            <button
              onClick={toggleMic}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                border: status === "listening" ? "2px solid #3b82f6" : "none",
                backgroundColor: status === "listening" ? "#1e3a5f" : status === "speaking" ? "#C9A840" : "#1C1C1C",
                color: status === "listening" ? "#60a5fa" : status === "speaking" ? "#0A0A0A" : "#888",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", fontSize: 16, transition: "all 0.2s", flexShrink: 0,
                boxShadow: status === "listening" ? "0 0 12px rgba(59,130,246,0.5)" : "none",
                animation: status === "listening" ? "ridge-pulse 1.5s ease-in-out infinite" : "none",
              }}
              data-testid="button-ridge-mic"
            >🎙</button>
            <input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSend(); }}
              placeholder={status === "listening" ? "Listening..." : "Ask RIDGE..."}
              style={{
                flex: 1, backgroundColor: "#1C1C1C",
                border: `1px solid ${status === "listening" ? "#3b82f6" : "#333"}`,
                borderRadius: 8, padding: "8px 12px", color: "#e0e0e0",
                fontSize: 13, outline: "none", transition: "border-color 0.2s",
              }}
              data-testid="input-ridge-message"
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || status === "thinking"}
              style={{
                width: 36, height: 36, borderRadius: "50%", border: "none",
                backgroundColor: inputText.trim() ? "#C9A840" : "#1C1C1C",
                color: inputText.trim() ? "#0A0A0A" : "#555",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: inputText.trim() ? "pointer" : "default",
                fontSize: 15, fontWeight: "bold", transition: "all 0.2s", flexShrink: 0,
              }}
              data-testid="button-ridge-send"
            >➤</button>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={toggleOpen}
        style={{
          width: 58, height: 58, borderRadius: "50%",
          border: "2px solid #C9A840", backgroundColor: "#0A0A0A",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", fontFamily: "Georgia, serif",
          color: "#C9A840", fontSize: 24, fontWeight: "bold",
          position: "relative", boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          marginLeft: "auto", transition: "transform 0.2s, box-shadow 0.2s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 4px 24px rgba(201,168,64,0.3)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.5)"; }}
        data-testid="button-ridge-toggle"
      >
        R
        {hasNotification && (
          <div style={{
            position: "absolute", top: -2, right: -2,
            width: 14, height: 14, borderRadius: "50%",
            backgroundColor: "#ef4444", border: "2px solid #0A0A0A",
            animation: "ridge-pulse 1.5s ease-in-out infinite",
          }} />
        )}
      </button>
    </div>
  );
}
