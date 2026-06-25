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
  // Track whether the most recent input was text. When it is, we
  // surface Jake's reply as a caption — voice playback would normally
  // carry the response, but in text mode there's nothing audible.
  const [lastInputWasText, setLastInputWasText] = useState(false);
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
  const transcriptBufferRef = useRef<string>("");
  // iOS Safari's Web Speech API often never fires isFinal results in
  // continuous mode — the whole utterance arrives as one or more
  // interim chunks instead. We keep a separate interim buffer so we
  // can fall back to it if the finalized one is empty when Chris taps
  // to send.
  const interimBufferRef = useRef<string>("");

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

  const sendTurn = useCallback(async (userText: string, opts: { silent?: boolean } = {}) => {
    const trimmed = userText.trim();
    if (!trimmed) return;
    setInput("");
    const silent = !!opts.silent;
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

        // iOS: use AudioContext + AudioBufferSourceNode. The
        // HTMLAudioElement path is unreliable on iOS Safari (the
        // gesture context is lost during the network round-trip, so
        // play() resolves silently). With AudioContext, once we've
        // called resume() inside a user gesture, subsequent buffer
        // playback works without a fresh gesture.
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
              // Use the callback signature for older iOS support.
              try {
                ctx.decodeAudioData(arrayBuffer.slice(0), resolve, reject);
              } catch (e) {
                reject(e);
              }
            });
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            await new Promise<void>((resolve) => {
              source.onended = () => resolve();
              try { source.start(0); } catch (e) {
                console.warn("[Jake] iOS source.start failed:", e);
                resolve();
              }
            });
          } catch (err) {
            console.error("[Jake] iOS AudioContext playback failed:", err);
          }
        } else {
          // Desktop path — Web Audio gain boost via HTMLAudioElement.
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
              if (ctx.state === "suspended") {
                await ctx.resume().catch(() => { /* */ });
              }
              usingWebAudio = true;
            }
          } catch (err) {
            console.warn("[Jake] Web Audio boost unavailable, plain playback:", err);
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
        console.error("[Jake] stream error:", err);
        const detail = err?.message || String(err);
        setMessages(prev => {
          const copy = [...prev];
          if (copy.length > 0 && copy[copy.length - 1].role === "assistant" && !copy[copy.length - 1].content) {
            copy[copy.length - 1] = { role: "assistant", content: `I couldn't reach the server just now. (${detail}) Try again in a sec.` };
          }
          return copy;
        });
      }
      setStatus("idle");
    }
  }, [messages]);

  const startListening = useCallback(() => {
    // iOS Safari requires audio playback to be initiated DURING a user
    // gesture. We use AudioContext for iOS playback (more reliable than
    // HTMLAudioElement across network round-trips), and AudioContext
    // needs resume() called inside the gesture to switch from
    // "suspended" to "running". Once running, it stays running across
    // network calls.
    if (isIOS) {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (Ctx) audioCtxRef.current = new Ctx() as AudioContext;
        }
        if (audioCtxRef.current?.state === "suspended") {
          audioCtxRef.current.resume().catch(() => { /* */ });
        }
        // Bonus: play a 1-sample silent BufferSource to fully unlock
        // on older iOS that doesn't honor resume() alone.
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
    if (!SR) {
      // No mic — keep typing.
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    transcriptBufferRef.current = "";
    interimBufferRef.current = "";
    rec.onstart = () => setStatus("listening");
    rec.onerror = () => setStatus("idle");
    // Don't auto-send on end — wait for Chris to tap the mic again.
    rec.onend = () => { /* finishListening sends the buffer manually */ };
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
    try { rec.start(); } catch { /* already started */ }
  }, []);

  const finishListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (rec) {
      try { rec.stop(); } catch { /* */ }
      recognitionRef.current = null;
    }
    // Give iOS a short tick to flush any pending onresult before we
    // read the buffer. Without this the buffer is often empty even
    // though the user clearly spoke.
    setTimeout(() => {
      const finalText = transcriptBufferRef.current.trim();
      const interim = interimBufferRef.current.trim();
      const buffered = finalText || interim; // fall back to interim
      transcriptBufferRef.current = "";
      interimBufferRef.current = "";
      setStatus("idle");
      if (buffered) {
        setLastInputWasText(false);
        sendTurn(buffered);
      }
    }, 250);
  }, [sendTurn]);

  // Last assistant turn for caption + actions row in fullscreen.
  const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && (m.content || m.actions?.length));
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  // Only show SUCCESSFUL action chips. Failed actions (the email-send
  // confirmation gate refusing a premature send, etc.) are internal
  // LLM feedback — Chris doesn't need a red "Refused: ..." pill.
  const recentActions = (lastAssistant?.actions ?? []).filter((a: any) => a?.ok === true);
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
            overflowY: "auto",
          }}
          data-testid="jake-widget-fullscreen"
        >
          <button
            onClick={() => { stop(); setOpen(false); }}
            aria-label="Close Jake"
            style={{
              position: "fixed", zIndex: 10001, top: 20, right: 24,
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

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, padding: "64px 24px 32px", maxWidth: 640, width: "100%", margin: "auto" }}>
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

            {/* Text-mode caption — only appears when Chris typed his
                last message. Voice mode stays face-only because the
                spoken reply already carries the response. */}
            {/* Show the reply text whenever the user typed (silent path)
                OR whenever the response is an error notice — otherwise
                voice users get a silent failure with no on-screen clue. */}
            {(lastInputWasText || /couldn't reach the server/i.test(lastAssistant?.content ?? "")) && lastAssistant?.content && status !== "thinking" && (
              <div
                style={{
                  color: "#e2e8f0",
                  fontSize: 15,
                  lineHeight: 1.5,
                  maxWidth: 520,
                  margin: "0 auto",
                  textAlign: "center",
                  whiteSpace: "pre-wrap",
                  padding: "0 8px",
                }}
                data-testid="jake-text-reply"
              >
                {lastAssistant.content}
              </div>
            )}

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
              onClick={status === "listening" ? finishListening : startListening}
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
              {status === "listening" ? "tap again when you're done" : "tap the mic and talk"}
            </div>

            {/* Text fallback for when voice isn't available — type and Enter. */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = input.trim();
                if (!text || status === "thinking" || status === "speaking") return;
                setInput("");
                // iOS gesture unlock — same path as the mic tap.
                if (isIOS) {
                  try {
                    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
                      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
                      if (Ctx) audioCtxRef.current = new Ctx() as AudioContext;
                    }
                    if (audioCtxRef.current?.state === "suspended") {
                      audioCtxRef.current.resume().catch(() => { /* */ });
                    }
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
                placeholder="Or type a message to Jake…"
                disabled={status === "thinking"}
                data-testid="jake-text-input"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(120,145,200,0.35)",
                  background: "rgba(15,23,42,0.5)",
                  color: "#e2e8f0",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={!input.trim() || status === "thinking" || status === "speaking"}
                aria-label="Send message"
                data-testid="jake-send-text"
                style={{
                  padding: "0 18px",
                  borderRadius: 999,
                  border: "none",
                  background: input.trim() && status === "idle" ? "#3b82f6" : "rgba(59,130,246,0.35)",
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
