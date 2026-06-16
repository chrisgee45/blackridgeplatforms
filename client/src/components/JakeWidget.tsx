import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; ok: boolean; message: string }[];
}

type Status = "idle" | "listening" | "thinking" | "speaking";

const STORAGE_KEY = "jake-voice-conversation-id";

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;
const FRAME_HEADER_SIZE = 5;

const JAKE_STYLES = `
@keyframes jake-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.08); opacity: 0.82; }
}
@keyframes jake-fade {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes jake-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}
`;

function injectStyles() {
  if (document.getElementById("jake-widget-styles")) return;
  const el = document.createElement("style");
  el.id = "jake-widget-styles";
  el.textContent = JAKE_STYLES;
  document.head.appendChild(el);
}

/**
 * Jake's avatar. Tries /jake-avatar.png first (drop a real photo there to
 * upgrade from the placeholder), falls back to the committed SVG
 * portrait, then to a stylized initial bubble if both fail.
 */
function JakeAvatar({ size = 56 }: { size?: number }) {
  const [src, setSrc] = useState("/jake-avatar.png");
  const [allFailed, setAllFailed] = useState(false);

  if (allFailed) {
    return (
      <svg width={size} height={size} viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="jake-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1e3a8a" />
            <stop offset="100%" stopColor="#0f172a" />
          </linearGradient>
        </defs>
        <circle cx="28" cy="28" r="28" fill="url(#jake-grad)" />
        <text x="28" y="36" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="22" fontWeight="600" fill="#e0e7ff">J</text>
      </svg>
    );
  }
  return (
    <img
      src={src}
      alt="Jake"
      width={size}
      height={size}
      onError={() => {
        if (src === "/jake-avatar.png") setSrc("/jake-avatar.svg");
        else setAllFailed(true);
      }}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", background: "#0f172a" }}
    />
  );
}

export default function JakeWidget() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioBufRef = useRef<Uint8Array[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => { injectStyles(); }, []);
  useEffect(() => { if (!audioRef.current) audioRef.current = new Audio(); }, []);

  // Hydrate existing conversation history once on mount if we have a saved
  // conversation id.
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jake/voice/conversations/${conversationId}/messages`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const rows = await res.json() as { role: string; content: string; actions?: any }[];
        if (cancelled) return;
        const hydrated: Message[] = rows.map(r => ({
          role: r.role === "assistant" ? "assistant" : "user",
          content: r.content,
          actions: Array.isArray(r.actions) ? r.actions : undefined,
        }));
        setMessages(hydrated);
      } catch {
        // If history fetch fails (conversation deleted, etc.), drop it.
        try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
        setConversationId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* */ }
    }
    setStatus("idle");
  }, []);

  const sendTurn = useCallback(async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed) return;
    setInput("");
    const newMessages: Message[] = [...messages, { role: "user", content: trimmed }, { role: "assistant", content: "" }];
    setMessages(newMessages);
    setStatus("thinking");
    audioBufRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/jake/voice-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          // Send the conversation up through the user's latest message.
          // Drop the empty assistant placeholder we just appended for UI.
          messages: newMessages.filter(m => m.content && m.content.length > 0),
          conversationId,
        }),
      });
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);

      const reader = resp.body.getReader();
      let buffer = new Uint8Array(0);
      let assistantText = "";

      const appendBuffer = (chunk: Uint8Array) => {
        const next = new Uint8Array(buffer.length + chunk.length);
        next.set(buffer);
        next.set(chunk, buffer.length);
        buffer = next;
      };
      const processFrames = () => {
        while (buffer.length >= FRAME_HEADER_SIZE) {
          const type = buffer[0];
          const len = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4];
          if (len < 0 || len > 10_000_000) { buffer = new Uint8Array(0); return; }
          if (buffer.length < FRAME_HEADER_SIZE + len) return;
          const payload = buffer.slice(FRAME_HEADER_SIZE, FRAME_HEADER_SIZE + len);
          buffer = buffer.slice(FRAME_HEADER_SIZE + len);
          if (type === FRAME_TEXT) {
            assistantText += new TextDecoder().decode(payload);
            setMessages(prev => {
              const copy = [...prev];
              if (copy.length > 0 && copy[copy.length - 1].role === "assistant") {
                copy[copy.length - 1] = { role: "assistant", content: assistantText };
              }
              return copy;
            });
          } else if (type === FRAME_AUDIO) {
            audioBufRef.current.push(payload);
          } else if (type === FRAME_DONE) {
            try {
              const meta = JSON.parse(new TextDecoder().decode(payload)) as {
                fullReply?: string;
                actions?: { type: string; ok: boolean; message: string }[];
                conversationId?: string;
              };
              if (meta.fullReply) assistantText = meta.fullReply;
              if (meta.conversationId && meta.conversationId !== conversationId) {
                setConversationId(meta.conversationId);
                try { window.localStorage.setItem(STORAGE_KEY, meta.conversationId); } catch { /* */ }
              }
              const finalActions = meta.actions;
              setMessages(prev => {
                const copy = [...prev];
                if (copy.length > 0 && copy[copy.length - 1].role === "assistant") {
                  copy[copy.length - 1] = {
                    role: "assistant",
                    content: assistantText,
                    actions: finalActions,
                  };
                }
                return copy;
              });
            } catch { /* */ }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        appendBuffer(value);
        processFrames();
      }
      processFrames();

      if (audioBufRef.current.length > 0) {
        const blob = new Blob(audioBufRef.current, { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        if (!audioRef.current) audioRef.current = new Audio();
        audioRef.current.src = url;
        setStatus("speaking");
        await audioRef.current.play().catch(() => { /* */ });
        await new Promise<void>(resolve => {
          if (!audioRef.current) return resolve();
          audioRef.current.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audioRef.current.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        });
      }
      setStatus("idle");
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("[Jake] stream error:", err);
        setMessages(prev => {
          const copy = [...prev];
          if (copy.length > 0 && copy[copy.length - 1].role === "assistant" && !copy[copy.length - 1].content) {
            copy[copy.length - 1] = { role: "assistant", content: "I couldn't reach the server just now. Try again in a sec." };
          }
          return copy;
        });
      }
      setStatus("idle");
    }
  }, [messages]);

  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      // No mic — keep typing.
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onstart = () => setStatus("listening");
    rec.onerror = () => setStatus("idle");
    rec.onend = () => { if (status === "listening") setStatus("idle"); };
    rec.onresult = (e: any) => {
      const text = e?.results?.[0]?.[0]?.transcript;
      setStatus("idle");
      if (text) sendTurn(text);
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  }, [sendTurn, status]);

  return (
    <>
      {/* Floating bubble — bottom-left so it doesn't collide with Ridge */}
      <button
        onClick={() => setOpen(o => !o)}
        title="Talk to Jake"
        aria-label="Talk to Jake"
        style={{
          position: "fixed",
          left: 20,
          bottom: 20,
          width: 64,
          height: 64,
          borderRadius: "50%",
          padding: 0,
          border: "2px solid rgba(120, 145, 200, 0.45)",
          background: "transparent",
          cursor: "pointer",
          overflow: "hidden",
          boxShadow: "0 6px 22px rgba(0, 0, 0, 0.45)",
          zIndex: 9998,
          animation: status === "speaking" ? "jake-pulse 1.2s ease-in-out infinite" : undefined,
        }}
        data-testid="jake-widget-toggle"
      >
        <JakeAvatar size={60} />
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            left: 20,
            bottom: 96,
            width: 340,
            maxHeight: "70vh",
            display: "flex",
            flexDirection: "column",
            background: "rgba(13, 17, 27, 0.95)",
            border: "1px solid rgba(120, 145, 200, 0.35)",
            borderRadius: 14,
            backdropFilter: "blur(8px)",
            boxShadow: "0 12px 36px rgba(0, 0, 0, 0.55)",
            zIndex: 9999,
            animation: "jake-fade 0.18s ease-out",
            overflow: "hidden",
          }}
          data-testid="jake-widget-panel"
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              borderBottom: "1px solid rgba(120, 145, 200, 0.18)",
            }}
          >
            <JakeAvatar size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 600 }}>Jake</div>
              <div style={{ color: "#94a3b8", fontSize: 11 }}>
                {status === "idle" && "Ready when you are"}
                {status === "listening" && "Listening…"}
                {status === "thinking" && "Thinking…"}
                {status === "speaking" && "Talking"}
              </div>
            </div>
            <button
              onClick={() => { stop(); setOpen(false); }}
              aria-label="Close Jake"
              style={{
                width: 26, height: 26, borderRadius: 6, border: "none",
                background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 18, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>

          {/* Transcript */}
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8,
            }}
          >
            {messages.length === 0 && (
              <div style={{ color: "#94a3b8", fontSize: 13, padding: "20px 4px", textAlign: "center" }}>
                Hey Chris — ask me about any client, project, or recent conversation.
                Try: "what's open on Hometown?" or "who hasn't replied to a check-in?"
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "7px 10px",
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: m.role === "user" ? "#0f172a" : "#e2e8f0",
                  background: m.role === "user" ? "#cbd5e1" : "rgba(30, 41, 59, 0.85)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content || (
                  <div style={{ display: "flex", gap: 4, padding: "2px 0" }}>
                    {[0, 1, 2].map(d => (
                      <span
                        key={d}
                        style={{
                          width: 6, height: 6, borderRadius: "50%",
                          background: "#94a3b8",
                          animation: `jake-dot-bounce 1.1s ease-in-out ${d * 0.15}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                )}
                {m.actions && m.actions.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                    {m.actions.map((a, ai) => (
                      <div
                        key={ai}
                        style={{
                          fontSize: 11,
                          padding: "3px 7px",
                          borderRadius: 6,
                          background: a.ok ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
                          color: a.ok ? "#86efac" : "#fca5a5",
                          border: `1px solid ${a.ok ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)"}`,
                        }}
                      >
                        {a.ok ? "✓" : "✗"} {a.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Input row */}
          <div
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: 10,
              borderTop: "1px solid rgba(120, 145, 200, 0.18)",
            }}
          >
            <button
              onClick={status === "listening" ? stop : startListening}
              disabled={status === "thinking" || status === "speaking"}
              style={{
                width: 36, height: 36, borderRadius: "50%", border: "none",
                background: status === "listening" ? "#ef4444" : "rgba(30, 41, 59, 0.85)",
                color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}
              title={status === "listening" ? "Stop listening" : "Push to talk"}
              aria-label={status === "listening" ? "Stop listening" : "Push to talk"}
              data-testid="jake-mic"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>
            </button>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTurn(input); } }}
              placeholder="Ask Jake…"
              disabled={status === "thinking" || status === "speaking"}
              style={{
                flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
                border: "1px solid rgba(120, 145, 200, 0.25)",
                background: "rgba(15, 23, 42, 0.85)",
                color: "#e2e8f0", fontSize: 13, outline: "none",
              }}
              data-testid="jake-input"
            />
            <button
              onClick={() => sendTurn(input)}
              disabled={!input.trim() || status === "thinking" || status === "speaking"}
              style={{
                padding: "8px 12px", borderRadius: 8, border: "none",
                background: input.trim() ? "#3b82f6" : "rgba(30, 41, 59, 0.6)",
                color: "white", cursor: input.trim() ? "pointer" : "default",
                fontSize: 13, fontWeight: 500,
              }}
              data-testid="jake-send"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
