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
  // Web Audio graph so we can boost Jake above the 1.0 cap that plain
  // <audio> elements enforce. Built once on first play; source nodes can
  // only be created once per element, so we keep the same audio element.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  // Boost factor — 1.0 is system max, 2.5 is significantly louder without
  // obvious distortion on a 192 kbps mp3. Tweak here if you want it
  // louder or softer.
  const VOLUME_BOOST = 2.5;
  // iOS Safari refuses to start an AudioContext outside a strict
  // user-gesture window — it'll silently mute MediaElementSource playback
  // even though audio.play() resolves. Detect the platform and skip the
  // Web Audio graph entirely; iPhone speakers handle volume on the device.
  const isIOS = typeof navigator !== "undefined" && (
    /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)
  );
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
        // Fresh audio element + fresh Web Audio graph every play. Reusing
        // a backgrounded AudioContext is the #1 way Jake goes silent after
        // a tab switch — we just blow it all away each time.
        try { audioCtxRef.current?.close(); } catch { /* */ }
        audioCtxRef.current = null;
        sourceRef.current = null;
        gainRef.current = null;
        const audio = new Audio();
        audioRef.current = audio;
        audio.src = url;
        audio.volume = 1.0;
        // Tell iOS this is part of the user's voice conversation so it
        // routes through the loud speaker instead of the earpiece.
        audio.setAttribute("playsinline", "true");
        let usingWebAudio = false;
        // Skip Web Audio entirely on iOS — see isIOS comment above.
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
            console.warn("[Jake] Web Audio boost unavailable, plain playback:", err);
          }
        }
        setStatus("speaking");
        try {
          await audio.play();
        } catch (playErr) {
          console.warn("[Jake] audio.play() rejected, retrying plain:", playErr);
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

  // Last assistant turn for caption + actions row in fullscreen.
  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && (m.content || m.actions?.length));
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  const recentActions = lastAssistant?.actions ?? [];
  const fullSize = typeof window !== "undefined"
    ? Math.min(Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.62), 480)
    : 360;

  return (
    <>
      {/* Closed-state floating bubble — bottom-right next to Ridge.
          Previously bottom-left but the OPS sidebar covered it. */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Talk to Jake"
          aria-label="Talk to Jake"
          style={{
            position: "fixed",
            right: 104,
            bottom: 24,
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
          }}
          data-testid="jake-widget-toggle"
        >
          <JakeAvatar size={60} />
        </button>
      )}

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(8, 10, 18, 0.92)",
            backdropFilter: "blur(14px)",
            zIndex: 10000,
            animation: "jake-fade 0.18s ease-out",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          data-testid="jake-widget-fullscreen"
        >
          <button
            onClick={() => { stop(); setOpen(false); }}
            aria-label="Close Jake"
            style={{
              position: "absolute", top: 20, right: 24,
              width: 40, height: 40, borderRadius: "50%",
              border: "1px solid rgba(120,145,200,0.4)",
              background: "rgba(15,23,42,0.6)",
              color: "#e2e8f0",
              fontSize: 22, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: 24, maxWidth: 640, width: "100%" }}>
            {/* Avatar — large */}
            <div style={{ position: "relative", width: fullSize, height: fullSize }}>
              {status === "speaking" && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute", inset: -8, borderRadius: "50%",
                    border: "2px solid rgba(120,145,200,0.6)",
                    animation: "jake-pulse 1.6s ease-in-out infinite",
                  }}
                />
              )}
              <div
                style={{
                  width: fullSize, height: fullSize, borderRadius: "50%", overflow: "hidden",
                  border: "3px solid rgba(120,145,200,0.45)",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
                  animation: status === "speaking" ? "jake-pulse 1.6s ease-in-out infinite" : undefined,
                }}
              >
                <JakeAvatar size={fullSize} />
              </div>
            </div>

            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#e2e8f0", fontSize: 22, fontWeight: 600, letterSpacing: "0.02em" }}>Jake</div>
              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                {status === "idle" && "Client relations · ready"}
                {status === "listening" && <span style={{ color: "#fca5a5" }}>● Listening…</span>}
                {status === "thinking" && (
                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    Thinking
                    {[0, 1, 2].map(d => (
                      <span
                        key={d}
                        style={{
                          width: 5, height: 5, borderRadius: "50%",
                          background: "#94a3b8",
                          animation: `jake-dot-bounce 1.1s ease-in-out ${d * 0.15}s infinite`,
                          display: "inline-block",
                        }}
                      />
                    ))}
                  </span>
                )}
                {status === "speaking" && <span style={{ color: "#bfdbfe" }}>● Talking</span>}
              </div>
            </div>

            {/* No transcript here — Chris asked for a clean face takeover,
                not a chat box. Only action confirmations show below. */}

            {recentActions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
                {recentActions.map((a, ai) => (
                  <div
                    key={ai}
                    style={{
                      fontSize: 12, padding: "4px 10px", borderRadius: 999,
                      background: a.ok ? "rgba(34,197,94,0.20)" : "rgba(239,68,68,0.20)",
                      color: a.ok ? "#86efac" : "#fca5a5",
                      border: `1px solid ${a.ok ? "rgba(34,197,94,0.40)" : "rgba(239,68,68,0.38)"}`,
                    }}
                  >
                    {a.ok ? "✓" : "✗"} {a.message}
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={status === "listening" ? stop : startListening}
              disabled={status === "thinking" || status === "speaking"}
              style={{
                width: 88, height: 88, borderRadius: "50%", border: "none",
                background: status === "listening" ? "#ef4444" : "#3b82f6",
                color: "white",
                cursor: (status === "thinking" || status === "speaking") ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 10px 30px rgba(59,130,246,0.45)",
                opacity: (status === "thinking" || status === "speaking") ? 0.5 : 1,
                transition: "background 0.2s, opacity 0.2s",
              }}
              title={status === "listening" ? "Stop listening" : "Push to talk"}
              data-testid="jake-mic"
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
              </svg>
            </button>
            <div style={{ color: "rgba(226,232,240,0.45)", fontSize: 11, marginTop: -8 }}>
              tap the mic and talk
            </div>
          </div>
        </div>
      )}
    </>
  );
}
