import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: { type: string; ok: boolean; message: string }[];
}

type Status = "idle" | "listening" | "thinking" | "speaking";

const STORAGE_KEY = "travis-voice-conversation-id";

const FRAME_AUDIO = 0x01;
const FRAME_TEXT = 0x02;
const FRAME_DONE = 0x03;
const FRAME_HEADER_SIZE = 5;

const STYLES = `
@keyframes travis-pulse {
  0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(180, 100, 50, 0.6); }
  50% { transform: scale(1.04); box-shadow: 0 0 0 20px rgba(180, 100, 50, 0); }
}
@keyframes travis-ring {
  0% { transform: scale(0.98); opacity: 0.9; }
  100% { transform: scale(1.18); opacity: 0; }
}
@keyframes travis-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes travis-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-6px); }
}
`;

function injectStyles() {
  if (document.getElementById("travis-widget-styles")) return;
  const el = document.createElement("style");
  el.id = "travis-widget-styles";
  el.textContent = STYLES;
  document.head.appendChild(el);
}

function TravisAvatar({ size }: { size: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <svg width={size} height={size} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="travis-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c2d12" />
            <stop offset="100%" stopColor="#1c1917" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="50" fill="url(#travis-grad)" />
        <text x="50" y="63" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize={size * 0.42} fontWeight="600" fill="#fef3c7">T</text>
      </svg>
    );
  }
  return (
    <img
      src="/travis-avatar.png"
      alt="Travis"
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block", background: "#1c1917" }}
    />
  );
}

export default function TravisWidget() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const VOLUME_BOOST = 2.5;
  // iOS Safari refuses to start an AudioContext outside a strict
  // user-gesture window and will silently mute MediaElementSource
  // playback. Skip the Web Audio graph on iOS and use plain audio.
  const isIOS = typeof navigator !== "undefined" && (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)
  );
  const abortRef = useRef<AbortController | null>(null);
  const audioBufRef = useRef<Uint8Array[]>([]);
  const recognitionRef = useRef<any>(null);
  const transcriptBufferRef = useRef<string>("");
  const [vw, setVw] = useState<number>(typeof window !== "undefined" ? window.innerWidth : 1024);
  const [vh, setVh] = useState<number>(typeof window !== "undefined" ? window.innerHeight : 768);

  useEffect(() => { injectStyles(); }, []);
  useEffect(() => { if (!audioRef.current) audioRef.current = new Audio(); }, []);
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
        const res = await fetch(`/api/travis/voice/conversations/${conversationId}/messages`, {
          credentials: "include",
        });
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

  const sendTurn = useCallback(async (userText: string) => {
    const trimmed = userText.trim();
    if (!trimmed) return;
    const newMessages: Message[] = [...messages, { role: "user", content: trimmed }, { role: "assistant", content: "" }];
    setMessages(newMessages);
    setStatus("thinking");
    audioBufRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch("/api/travis/voice-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
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
        const url = URL.createObjectURL(blob);
        // Fresh audio element + fresh Web Audio graph every play. Reusing
        // a backgrounded AudioContext is the #1 way Travis goes silent
        // after a tab switch — blow it all away each time.
        try { audioCtxRef.current?.close(); } catch { /* */ }
        audioCtxRef.current = null;
        sourceRef.current = null;
        gainRef.current = null;
        const audio = new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.volume = 1.0;
        audio.setAttribute("playsinline", "true");
        let usingWebAudio = false;
        if (!isIOS) {
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
              if (ctx.state === "suspended") {
                await ctx.resume().catch(() => { /* */ });
              }
              usingWebAudio = true;
            }
          } catch (err) {
            console.warn("[Travis] Web Audio boost unavailable, plain playback:", err);
          }
        }
        setStatus("speaking");
        try {
          await audio.play();
        } catch (playErr) {
          console.warn("[Travis] audio.play() rejected, retrying plain:", playErr);
          if (usingWebAudio) {
            try { audioCtxRef.current?.close(); } catch { /* */ }
            audioCtxRef.current = null;
            sourceRef.current = null;
            gainRef.current = null;
            const fallback = new Audio(url);
            audioRef.current = fallback;
            fallback.volume = 1.0;
            fallback.setAttribute("playsinline", "true");
            await fallback.play().catch(() => { /* */ });
          }
        }
        await new Promise<void>(resolve => {
          if (!audioRef.current) return resolve();
          audioRef.current.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audioRef.current.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        });
      }
      setStatus("idle");
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("[Travis] stream error:", err);
      }
      setStatus("idle");
    }
  }, [messages, conversationId]);

  const toggleMic = useCallback(() => {
    // If we're already listening, finish the dictation: stop the
    // recognizer, send whatever we've buffered, let Travis respond.
    if (status === "listening") {
      const rec = recognitionRef.current;
      if (rec) {
        try { rec.stop(); } catch { /* */ }
        recognitionRef.current = null;
      }
      const buffered = transcriptBufferRef.current.trim();
      transcriptBufferRef.current = "";
      setStatus("idle");
      if (buffered) sendTurn(buffered);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    transcriptBufferRef.current = "";
    rec.onstart = () => setStatus("listening");
    rec.onerror = () => setStatus("idle");
    // Don't auto-send on end — the next mic tap sends the buffer.
    rec.onend = () => { /* */ };
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          const piece = r[0]?.transcript ?? "";
          if (piece.trim()) transcriptBufferRef.current += (transcriptBufferRef.current ? " " : "") + piece.trim();
        }
      }
    };
    recognitionRef.current = rec;
    try { rec.start(); } catch { /* */ }
  }, [sendTurn, status]);

  // Last assistant turn = caption shown beside the big face.
  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && (m.content || m.actions?.length));
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  const recentActions = lastAssistant?.actions ?? [];

  const bubbleSize = 58;
  const fullSize = Math.min(Math.round(Math.min(vw, vh) * 0.62), 480);

  return (
    <>
      {/* Closed-state floating bubble — top-right quadrant */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Talk to Travis"
          aria-label="Talk to Travis"
          style={{
            position: "fixed",
            right: 24,
            top: 24,
            width: bubbleSize,
            height: bubbleSize,
            borderRadius: "50%",
            padding: 0,
            border: "2px solid rgba(180, 100, 50, 0.55)",
            background: "transparent",
            cursor: "pointer",
            overflow: "hidden",
            boxShadow: "0 6px 22px rgba(0, 0, 0, 0.45)",
            zIndex: 9998,
          }}
          data-testid="travis-widget-toggle"
        >
          <TravisAvatar size={bubbleSize - 4} />
        </button>
      )}

      {/* Open-state: full takeover */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 5, 3, 0.92)",
            backdropFilter: "blur(14px)",
            zIndex: 10000,
            animation: "travis-fade-up 0.18s ease-out",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          data-testid="travis-widget-fullscreen"
        >
          <button
            onClick={() => { stop(); setOpen(false); }}
            aria-label="Close Travis"
            style={{
              position: "absolute",
              top: 20,
              right: 24,
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid rgba(180,100,50,0.4)",
              background: "rgba(28,18,12,0.6)",
              color: "#fef3c7",
              fontSize: 22,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: 24, maxWidth: 640, width: "100%" }}>
            {/* Avatar — large, with optional speaking pulse ring */}
            <div style={{ position: "relative", width: fullSize, height: fullSize }}>
              {status === "speaking" && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    inset: -8,
                    borderRadius: "50%",
                    border: "2px solid rgba(180,100,50,0.6)",
                    animation: "travis-ring 1.4s ease-out infinite",
                  }}
                />
              )}
              <div
                style={{
                  width: fullSize,
                  height: fullSize,
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "3px solid rgba(180,100,50,0.45)",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
                  animation: status === "speaking" ? "travis-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              >
                <TravisAvatar size={fullSize} />
              </div>
            </div>

            {/* Name + status */}
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#fef3c7", fontSize: 22, fontWeight: 600, letterSpacing: "0.02em" }}>Travis</div>
              <div style={{ color: "#a8a29e", fontSize: 13, marginTop: 4 }}>
                {status === "idle" && "Outreach desk · ready"}
                {status === "listening" && (
                  <span style={{ color: "#fca5a5" }}>● Listening…</span>
                )}
                {status === "thinking" && (
                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    Thinking
                    {[0, 1, 2].map(d => (
                      <span
                        key={d}
                        style={{
                          width: 5, height: 5, borderRadius: "50%",
                          background: "#a8a29e",
                          animation: `travis-dot-bounce 1.1s ease-in-out ${d * 0.15}s infinite`,
                          display: "inline-block",
                        }}
                      />
                    ))}
                  </span>
                )}
                {status === "speaking" && <span style={{ color: "#fde68a" }}>● Talking</span>}
              </div>
            </div>

            {/* No transcript here — Chris asked for a clean face takeover,
                not a chat box. Only action confirmations show below. */}

            {/* Action chips for the latest assistant turn */}
            {recentActions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                {recentActions.map((a, ai) => (
                  <div
                    key={ai}
                    style={{
                      fontSize: 12,
                      padding: "4px 10px",
                      borderRadius: 999,
                      background: a.ok ? "rgba(202,138,4,0.22)" : "rgba(239,68,68,0.20)",
                      color: a.ok ? "#fde68a" : "#fca5a5",
                      border: `1px solid ${a.ok ? "rgba(202,138,4,0.42)" : "rgba(239,68,68,0.38)"}`,
                    }}
                  >
                    {a.ok ? "✓" : "✗"} {a.message}
                  </div>
                ))}
              </div>
            )}

            {/* Mic — primary interaction */}
            <button
              onClick={toggleMic}
              disabled={status === "thinking" || status === "speaking"}
              style={{
                width: 88,
                height: 88,
                borderRadius: "50%",
                border: "none",
                background: status === "listening" ? "#ef4444" : "#b45309",
                color: "white",
                cursor: (status === "thinking" || status === "speaking") ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 10px 30px rgba(180,100,50,0.45)",
                opacity: (status === "thinking" || status === "speaking") ? 0.5 : 1,
                transition: "background 0.2s, opacity 0.2s, transform 0.15s",
              }}
              onMouseDown={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.96)"; }}
              onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
              title={status === "listening" ? "Stop listening" : "Push to talk"}
              aria-label={status === "listening" ? "Stop listening" : "Push to talk"}
              data-testid="travis-mic"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
              </svg>
            </button>
            <div style={{ color: "rgba(254,243,199,0.45)", fontSize: 11, marginTop: -8 }}>
              {status === "listening" ? "tap again when you're done" : "tap the mic and talk"}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
