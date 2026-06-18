/**
 * Light-tier QA audit agent. For a given staging/production URL, runs:
 *
 *   1. Google PageSpeed Insights (Lighthouse) — desktop + mobile,
 *      one call each. Returns performance / accessibility / SEO /
 *      best-practices scores from 0–100.
 *   2. Same-origin link crawl — fetches the homepage, extracts up to
 *      ~30 internal links, and HEAD-checks each. Anything not 2xx is
 *      flagged as broken.
 *   3. Security header check — looks for HTTPS, HSTS, CSP, X-Frame-
 *      Options, X-Content-Type-Options, Referrer-Policy.
 *   4. Brief Claude content review — pulls the homepage HTML, strips
 *      to visible text, asks Claude for a quick "what to fix first"
 *      take from the perspective of small-business website best
 *      practices.
 *
 * Auth: the Google PageSpeed API key is read from the BlackRidge Vault
 * (service="google_pagespeed", secret key="api_key"). If not present
 * the audit still runs but Lighthouse scores come back empty and a
 * note is left in the report.
 *
 * Runs asynchronously: the route handler returns immediately with a
 * reportId. The runner updates the row as it makes progress.
 */
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";
import { qaAuditReports, blackridgeServiceAccounts } from "@shared/schema";
import { eq } from "drizzle-orm";
import { decryptSecrets } from "./secret-vault";

const FETCH_TIMEOUT_MS = 12000;
const PSI_TIMEOUT_MS = 90000;
const MAX_LINKS_TO_CHECK = 30;
const MAX_HTML_BYTES = 250_000;

interface LighthouseScores {
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  notes?: string;
}

interface BrokenLink {
  url: string;
  status: number | string;
}

interface SecurityHeaders {
  https: boolean;
  hsts: boolean;
  csp: boolean;
  xFrameOptions: boolean;
  xContentTypeOptions: boolean;
  referrerPolicy: boolean;
  raw: Record<string, string>;
}

async function getGooglePageSpeedKey(): Promise<string | null> {
  try {
    const rows = await db
      .select()
      .from(blackridgeServiceAccounts)
      .where(eq(blackridgeServiceAccounts.service, "google_pagespeed"));
    for (const row of rows) {
      if (!row.secretsEncrypted) continue;
      const secrets = decryptSecrets(row.secretsEncrypted);
      const key = secrets["api_key"] ?? secrets["apiKey"] ?? secrets["key"];
      if (typeof key === "string" && key.trim()) return key.trim();
    }
  } catch (err: any) {
    console.warn("[qa-agent] could not read PageSpeed key from vault:", err?.message);
  }
  return null;
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeout = FETCH_TIMEOUT_MS): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function runLighthouse(url: string, strategy: "desktop" | "mobile", apiKey: string | null): Promise<LighthouseScores> {
  if (!apiKey) {
    return {
      performance: null,
      accessibility: null,
      bestPractices: null,
      seo: null,
      notes: "Google PageSpeed API key not configured in vault (service=google_pagespeed, secret=api_key).",
    };
  }
  const params = new URLSearchParams({
    url,
    strategy,
    key: apiKey,
    category: "performance",
  });
  for (const c of ["accessibility", "best-practices", "seo"]) params.append("category", c);
  const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`;
  const res = await fetchWithTimeout(psiUrl, {}, PSI_TIMEOUT_MS);
  if (!res || !res.ok) {
    const status = res?.status ?? "no response";
    return {
      performance: null,
      accessibility: null,
      bestPractices: null,
      seo: null,
      notes: `PageSpeed call failed (${status}).`,
    };
  }
  const json = await res.json() as any;
  const categories = json?.lighthouseResult?.categories ?? {};
  const pick = (key: string): number | null => {
    const v = categories[key]?.score;
    return typeof v === "number" ? Math.round(v * 100) : null;
  };
  return {
    performance: pick("performance"),
    accessibility: pick("accessibility"),
    bestPractices: pick("best-practices"),
    seo: pick("seo"),
  };
}

function extractInternalLinks(html: string, origin: string): string[] {
  const seen = new Set<string>();
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    try {
      const abs = new URL(raw, origin).toString();
      const absUrl = new URL(abs);
      if (absUrl.origin !== origin) continue;
      seen.add(abs.split("#")[0]);
    } catch {
      // ignore
    }
  }
  return Array.from(seen).slice(0, MAX_LINKS_TO_CHECK);
}

async function checkLinks(origin: string, html: string): Promise<BrokenLink[]> {
  const links = extractInternalLinks(html, origin);
  const broken: BrokenLink[] = [];
  for (const link of links) {
    const res = await fetchWithTimeout(link, { method: "HEAD" });
    if (!res) {
      broken.push({ url: link, status: "no response" });
      continue;
    }
    // Some servers reject HEAD — fall back to GET.
    if (res.status === 405 || res.status === 403) {
      const getRes = await fetchWithTimeout(link, { method: "GET" });
      if (!getRes || !getRes.ok) {
        broken.push({ url: link, status: getRes?.status ?? "no response" });
      }
      continue;
    }
    if (!res.ok) broken.push({ url: link, status: res.status });
  }
  return broken;
}

function inspectSecurityHeaders(url: string, headers: Headers): SecurityHeaders {
  const raw: Record<string, string> = {};
  for (const [k, v] of headers.entries()) raw[k.toLowerCase()] = v;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
  return {
    https: url.startsWith("https://"),
    hsts: has("strict-transport-security"),
    csp: has("content-security-policy"),
    xFrameOptions: has("x-frame-options"),
    xContentTypeOptions: has("x-content-type-options"),
    referrerPolicy: has("referrer-policy"),
    raw,
  };
}

async function fetchHomepage(url: string): Promise<{ html: string; headers: Headers } | null> {
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; BlackRidgeQA/1.0)" },
  });
  if (!res || !res.ok) return null;
  const buf = await res.arrayBuffer();
  const sliced = buf.byteLength > MAX_HTML_BYTES ? buf.slice(0, MAX_HTML_BYTES) : buf;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(sliced);
  return { html, headers: res.headers };
}

function htmlToText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

async function aiReview(url: string, html: string, scores: { desktop: LighthouseScores; mobile: LighthouseScores }, security: SecurityHeaders, broken: BrokenLink[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "Anthropic key not configured — skipping AI review.";
  const visible = htmlToText(html).slice(0, 6000);
  const anthropic = new Anthropic({ apiKey });
  const prompt = `You are a website QA reviewer. The site below has been scanned automatically. Write a SHORT punch list of what to fix first (max 8 bullet points), focused on small-business website best practices: visible phone number above the fold, clear primary CTA, mobile-first layout, Google reviews / social proof, fast load, accessibility basics. Be specific and direct. If everything looks fine, say so in one line.

URL: ${url}
Lighthouse (desktop): perf=${scores.desktop.performance ?? "?"} a11y=${scores.desktop.accessibility ?? "?"} best=${scores.desktop.bestPractices ?? "?"} seo=${scores.desktop.seo ?? "?"}
Lighthouse (mobile):  perf=${scores.mobile.performance ?? "?"} a11y=${scores.mobile.accessibility ?? "?"} best=${scores.mobile.bestPractices ?? "?"} seo=${scores.mobile.seo ?? "?"}
HTTPS=${security.https} HSTS=${security.hsts} CSP=${security.csp} X-Frame-Options=${security.xFrameOptions}
Broken internal links: ${broken.length}

Visible homepage text (truncated):
${visible}

Output only the bullet list, no preamble.`;
  try {
    const resp = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    return resp.content.map(b => (b.type === "text" ? b.text : "")).join("").trim();
  } catch (err: any) {
    return `AI review failed: ${err?.message ?? "unknown"}`;
  }
}

export async function runQaAudit(reportId: string): Promise<void> {
  const [report] = await db.select().from(qaAuditReports).where(eq(qaAuditReports.id, reportId));
  if (!report) return;
  await db.update(qaAuditReports).set({ status: "running" }).where(eq(qaAuditReports.id, reportId));

  try {
    const apiKey = await getGooglePageSpeedKey();
    const origin = new URL(report.url).origin;

    const homepage = await fetchHomepage(report.url);
    const html = homepage?.html ?? "";
    const headers = homepage?.headers ?? new Headers();

    const security = inspectSecurityHeaders(report.url, headers);

    const [desktop, mobile, broken] = await Promise.all([
      runLighthouse(report.url, "desktop", apiKey),
      runLighthouse(report.url, "mobile", apiKey),
      html ? checkLinks(origin, html) : Promise.resolve([] as BrokenLink[]),
    ]);

    const review = html ? await aiReview(report.url, html, { desktop, mobile }, security, broken) : "Homepage fetch failed — couldn't run AI review.";

    await db.update(qaAuditReports).set({
      status: "completed",
      desktopScores: desktop,
      mobileScores: mobile,
      brokenLinks: broken,
      securityHeaders: security,
      aiReview: review,
      completedAt: new Date(),
    }).where(eq(qaAuditReports.id, reportId));
    console.log(`[qa-agent] report ${reportId} completed for ${report.url}`);
  } catch (err: any) {
    console.error("[qa-agent] audit failed:", err);
    await db.update(qaAuditReports).set({
      status: "failed",
      errorMessage: err?.message ?? "Unknown error",
      completedAt: new Date(),
    }).where(eq(qaAuditReports.id, reportId));
  }
}
