import { useCallback, useEffect, useRef, useState } from "react";

/**
 * David — the public website concierge. Voice + text. Lives on the public
 * homepage and answers questions about BlackRidge (what we build, our
 * stack, how we operate, pricing) and captures appointment requests
 * through the unauthenticated /api/david/* endpoints. Completely separate
 * from the internal Travis/Jake/Ridge widgets.
 *
 * The streaming + audio-playback path mirrors the internal voice widgets
 * (framed audio/text/done protocol, iOS AudioContext handling) because
 * that path is well-tested across browsers.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; ok: boolean; message: string }[];
}

type Status = "idle" | "listening" | "thinking" | "speaking";

const STORAGE_KEY = "david-conversation-id";
const GREETING = "Hi, I'm David. Ask me anything about what BlackRidge builds, how we work, or what it costs — or I can set up a call with Chris for you.";

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;
const FRAME_HEADER_SIZE = 5;

// BlackRidge gold palette.
const GOLD = "#d97706";
const GOLD_DEEP = "#b45309";
const GOLD_LIGHT = "#fde68a";

const STYLES = `
@keyframes david-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.6); }
  50% { transform: scale(1.04); box-shadow: 0 0 0 20px rgba(217, 119, 6, 0); }
}
@keyframes david-ring {
  0% { transform: scale(0.98); opacity: 0.9; }
  100% { transform: scale(1.18); opacity: 0; }
}
@keyframes david-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes david-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}
`;

function injectStyles() {
  if (document.getElementById("david-widget-styles")) return;
  const el = document.createElement("style");
  el.id = "david-widget-styles";
  el.textContent = STYLES;
  document.head.appendChild(el);
}

function DavidAvatar({ size }: { size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="david-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#b45309" />
            <stop offset="100%" stopColor="#1c1917" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill="url(#david-grad)" />
        <text x="50" y="63" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={size * 0.42} fontWeight="600" fill="#fef3c7">D</text>
      </svg>
    );
  }
  return (
    <img
      src="/david-avatar.png"
      alt="David"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", background: "#1c1917" }}
    />
  );
}

export default function DavidWidget() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [lastInputWasText, setLastInputWasText] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const VOLUME_BOOST = 2.5;
  const isIOS = typeof navigator !== "undefined" && (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)
  );
  const abortRef = useRef<AbortController | null>(null);
  const audioBufRef = useRef<Uint8Array[]>([]);
  const recognitionRef = useRef<any>(null);
  const transcriptBufferRef = useRef<string>("");
  const interimBufferRef = useRef<string>("");
  const [vw, setVw] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1024);
  const [vh, setVh] = useState<number>(typeof window !== "undefined" ? window.innerHeight : 768);
  const [speechSupported, setSpeechSupported] = useState(true);

  useEffect(() => { injectStyles(); }, []);
  useEffect(() => { if (!audioRef.current) audioRef.current = new Audio(); }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSpeechSupported(!!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));
  }, []);
  useEffect(() => {
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/david/conversations/${conversationId}/messages`);
        if (!res.ok) return;
        const rows = await res.json() as { role: string; content: string; actions?: any }[];
        if (cancelled) return;
        setMessages(rows.map(r => ({
          role: r.role === "assistant" ? "assistant" : "user",
          content: r.content,
          actions: Array.isArray(r.actions) ? r.actions : undefined,
        })));
      } catch {
        try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
        setConversationId(null);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

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

  const sendTurn = useCallback(async (userText: string, opts: { silent?: boolean } = {}) => {
    const trimmed = userText.trim();
    if (!trimmed) return;
    const silent = !!opts.silent;
    const newMessages: Message[] = [...messages, { role: "user", content: trimmed }, { role: "assistant", content: "" }];
    setMessages(newMessages);
    setStatus("thinking");
    audioBufRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/david/voice-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: newMessages.filter(m => m.content && m.content.length > 0),
          conversationId,
          silent,
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
                  copy[copy.length - 1] = { role: "assistant", content: assistantText, actions: finalActions };
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

        if (isIOS) {
          setStatus("speaking");
          try {
            if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
              const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
              if (Ctx) audioCtxRef.current = new Ctx() as AudioContext;
            }
            const ctx = audioCtxRef.current!;
            if (ctx.state === "suspended") await ctx.resume().catch(() => { /* */ });
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await new Promise<AudioBuffer>((resolve, reject) => {
              try { ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject); } catch (e) { reject(e); }
            });
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            await new Promise<void>((resolve) => {
              source.onended = () => resolve();
              try { source.start(0); } catch (e) { console.warn("[David] iOS source.start failed:", e); resolve(); }
            });
          } catch (err) {
            console.error("[David] iOS AudioContext playback failed:", err);
          }
        } else {
          const url = URL.createObjectURL(blob);
          try { audioCtxRef.current?.close(); } catch { /* */ }
          audioCtxRef.current = null;
          sourceRef.current = null;
          gainRef.current = null;
          const audio = new Audio();
          audioRef.current = audio;
          audio.src = url;
          audio.volume = 1.0;
          let usingWebAudio = false;
          try {
            const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (Ctx) {
              const ctx = new Ctx() as AudioContext;
              audioCtxRef.current = ctx;
              const source = ctx.createMediaElementSource(audio);
              sourceRef.current = source;
              const gain = ctx.createGain();
              gain.gain.value = VOLUME_BOOST;
              gainRef.current = gain;
              source.connect(gain);
              gain.connect(ctx.destination);
              if (ctx.state === "suspended") await ctx.resume().catch(() => { /* */ });
              usingWebAudio = true;
            }
          } catch (err) {
            console.warn("[David] Web Audio boost unavailable, plain playback:", err);
          }
          setStatus("speaking");
          try {
            await audio.play();
          } catch (playErr) {
            console.warn("[David] audio.play() rejected, retrying plain:", playErr);
            if (usingWebAudio) {
              try { audioCtxRef.current?.close(); } catch { /* */ }
              audioCtxRef.current = null;
              sourceRef.current = null;
              gainRef.current = null;
              const fallback = new Audio(url);
              audioRef.current = fallback;
              fallback.volume = 1.0;
              await fallback.play().catch(() => { /* */ });
            }
          }
          await new Promise<void>(resolve => {
            if (!audioRef.current) return resolve();
            audioRef.current.onended = () => { URL.revokeObjectURL(url); resolve(); };
            audioRef.current.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          });
        }
      }
      setStatus("idle");
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("[David] stream error:", err);
        setMessages(prev => {
          const copy = [...prev];
          if (copy.length > 0 && copy[copy.length - 1].role === "assistant" && !copy[copy.length - 1].content) {
            copy[copy.length - 1] = { role: "assistant", content: `I couldn't reach the server just now. Mind trying that again in a sec?` };
          }
          return copy;
        });
      }
      setStatus("idle");
    }
  }, [messages, conversationId, isIOS]);

  const toggleMic = useCallback(() => {
    if (status === "listening") {
      const rec = recognitionRef.current;
      if (rec) {
        try { rec.stop(); } catch { /* */ }
        recognitionRef.current = null;
      }
      setTimeout(() => {
        const finalText = transcriptBufferRef.current.trim();
        const interim = interimBufferRef.current.trim();
        const buffered = finalText || interim;
        transcriptBufferRef.current = "";
        interimBufferRef.current = "";
        setStatus("idle");
        if (buffered) {
          setLastInputWasText(false);
          sendTurn(buffered);
        }
      }, 250);
      return;
    }

    if (isIOS) {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (Ctx) audioCtxRef.current = new Ctx() as AudioContext;
        }
        if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume().catch(() => { /* */ });
        if (audioCtxRef.current) {
          const buf = audioCtxRef.current.createBuffer(1, 1, 22050);
          const src = audioCtxRef.current.createBufferSource();
          src.buffer = buf;
          src.connect(audioCtxRef.current.destination);
          try { src.start(0); } catch { /* */ }
        }
      } catch { /* */ }
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    transcriptBufferRef.current = "";
    interimBufferRef.current = "";
    rec.onstart = () => setStatus("listening");
    rec.onerror = () => setStatus("idle");
    rec.onend = () => { /* finish sends the buffer manually */ };
    rec.onresult = (e: any) => {
      let liveInterim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const piece = r[0]?.transcript ?? "";
        if (!piece.trim()) continue;
        if (r.isFinal) {
          transcriptBufferRef.current += (transcriptBufferRef.current ? " " : "") + piece.trim();
        } else {
          liveInterim += (liveInterim ? " " : "") + piece.trim();
        }
      }
      if (liveInterim) interimBufferRef.current = liveInterim;
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch { /* */ }
  }, [sendTurn, status, isIOS]);

  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && (m.content || m.actions?.length));
  const recentActions = (lastAssistant?.actions ?? []).filter((a: any) => a?.ok === true);
  const showCaption = (lastInputWasText || /couldn't reach the server/i.test(lastAssistant?.content ?? "")) && lastAssistant?.content && status !== "thinking";
  const captionText = showCaption ? lastAssistant!.content : (messages.length === 0 ? GREETING : "");

  const bubbleSize = 60;
  const fullSize = Math.min(Math.round(Math.min(vw, vh) * 0.5), 360);

  return (
    <>
      {/* Closed-state floating bubble — bottom-right, with an inviting label */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Chat with David"
          aria-label="Chat with David"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px 8px 8px",
            borderRadius: 999,
            border: `1.5px solid rgba(217, 119, 6, 0.5)`,
            background: "rgba(20, 14, 8, 0.92)",
            backdropFilter: "blur(8px)",
            cursor: "pointer",
            boxShadow: "0 8px 28px rgba(0, 0, 0, 0.45)",
            zIndex: 9998,
          }}
          data-testid="david-widget-toggle"
        >
          <span style={{ width: bubbleSize - 12, height: bubbleSize - 12, borderRadius: "50%", overflow: "hidden", display: "block", flexShrink: 0 }}>
            <DavidAvatar size={bubbleSize - 12} />
          </span>
          <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
            <span style={{ color: GOLD_LIGHT, fontWeight: 700, fontSize: 14 }}>Ask David</span>
            <span style={{ color: "rgba(254,243,199,0.6)", fontSize: 11 }}>Questions? Book a call?</span>
          </span>
        </button>
      )}

      {/* Open-state: full takeover */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 5, 3, 0.93)",
            backdropFilter: "blur(14px)",
            zIndex: 10000,
            animation: "david-fade-up 0.18s ease-out",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          data-testid="david-widget-fullscreen"
        >
          <button
            onClick={() => { stop(); setOpen(false); }}
            aria-label="Close David"
            style={{
              position: "absolute",
              top: 20,
              right: 24,
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid rgba(217,119,6,0.4)",
              background: "rgba(28,18,12,0.6)",
              color: GOLD_LIGHT,
              fontSize: 22,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 22, padding: 24, maxWidth: 640, width: "100%" }}>
            {/* Avatar */}
            <div style={{ position: "relative", width: fullSize, height: fullSize }}>
              {status === "speaking" && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: -8,
                    borderRadius: "50%",
                    border: `2px solid rgba(217,119,6,0.6)`,
                    animation: "david-ring 1.4s ease-out infinite",
                  }}
                />
              )}
              <div
                style={{
                  width: fullSize,
                  height: fullSize,
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: `3px solid rgba(217,119,6,0.45)`,
                  boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
                  animation: status === "speaking" ? "david-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              >
                <DavidAvatar size={fullSize} />
              </div>
            </div>

            {/* Name + status */}
            <div style={{ textAlign: "center" }}>
              <div style={{ color: GOLD_LIGHT, fontSize: 22, fontWeight: 600, letterSpacing: "0.02em" }}>David</div>
              <div style={{ color: "#a8a29e", fontSize: 13, marginTop: 4 }}>
                {status === "idle" && "BlackRidge concierge · ask me anything"}
                {status === "listening" && <span style={{ color: "#fca5a5" }}>● Listening…</span>}
                {status === "thinking" && (
                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    Thinking
                    {[0, 1, 2].map(d => (
                      <span key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: "#a8a29e", animation: `david-dot-bounce 1.1s ease-in-out ${d * 0.15}s infinite`, display: "inline-block" }} />
                    ))}
                  </span>
                )}
                {status === "speaking" && <span style={{ color: GOLD_LIGHT }}>● Talking</span>}
              </div>
            </div>

            {/* Caption — greeting before first turn, replies for typed turns / errors */}
            {captionText && status !== "thinking" && (
              <div
                style={{ color: "#fef3c7", fontSize: 15, lineHeight: 1.5, maxWidth: 520, margin: "0 auto", textAlign: "center", whiteSpace: "pre-wrap", padding: "0 8px" }}
                data-testid="david-text-reply"
              >
                {captionText}
              </div>
            )}

            {/* Action confirmations (e.g. appointment captured) */}
            {recentActions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                {recentActions.map((a, ai) => (
                  <div
                    key={ai}
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "rgba(202,138,4,0.22)", color: GOLD_LIGHT, border: "1px solid rgba(202,138,4,0.42)" }}
                  >
                    ✓ {a.message}
                  </div>
                ))}
              </div>
            )}

            {/* Mic — primary interaction (only when supported) */}
            {speechSupported && (
              <>
                <button
                  onClick={toggleMic}
                  disabled={status === "thinking" || status === "speaking"}
                  style={{
                    width: 84,
                    height: 84,
                    borderRadius: "50%",
                    border: "none",
                    background: status === "listening" ? "#ef4444" : GOLD_DEEP,
                    color: "white",
                    cursor: (status === "thinking" || status === "speaking") ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 10px 30px rgba(217,119,6,0.45)",
                    opacity: (status === "thinking" || status === "speaking") ? 0.5 : 1,
                    transition: "background 0.2s, opacity 0.2s, transform 0.15s",
                  }}
                  title={status === "listening" ? "Stop listening" : "Push to talk"}
                  aria-label={status === "listening" ? "Stop listening" : "Push to talk"}
                  data-testid="david-mic"
                >
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
                  </svg>
                </button>
                <div style={{ color: "rgba(254,243,199,0.45)", fontSize: 11, marginTop: -8 }}>
                  {status === "listening" ? "tap again when you're done" : "tap the mic and talk, or type below"}
                </div>
              </>
            )}

            {/* Text input — always available */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = input.trim();
                if (!text || status === "thinking" || status === "speaking") return;
                setInput("");
                if (isIOS) {
                  try {
                    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
                      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
                      if (Ctx) audioCtxRef.current = new Ctx() as AudioContext;
                    }
                    if (audioCtxRef.current?.state === "suspended") audioCtxRef.current.resume().catch(() => { /* */ });
                    if (audioCtxRef.current) {
                      const buf = audioCtxRef.current.createBuffer(1, 1, 22050);
                      const src = audioCtxRef.current.createBufferSource();
                      src.buffer = buf;
                      src.connect(audioCtxRef.current.destination);
                      try { src.start(0); } catch { /* */ }
                    }
                  } catch { /* */ }
                }
                setLastInputWasText(true);
                sendTurn(text, { silent: true });
              }}
              style={{ width: "100%", maxWidth: 480, display: "flex", gap: 8, marginTop: 4 }}
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type your question to David…"
                disabled={status === "thinking"}
                data-testid="david-text-input"
                style={{
                  flex: 1,
                  padding: "11px 16px",
                  borderRadius: 999,
                  border: "1px solid rgba(217,119,6,0.45)",
                  background: "rgba(28,16,8,0.55)",
                  color: "#fef3c7",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={!input.trim() || status === "thinking" || status === "speaking"}
                aria-label="Send message"
                data-testid="david-send-text"
                style={{
                  padding: "0 20px",
                  borderRadius: 999,
                  border: "none",
                  background: input.trim() && status === "idle" ? GOLD : "rgba(217,119,6,0.35)",
                  color: "white",
                  cursor: input.trim() && status === "idle" ? "pointer" : "not-allowed",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
