/**
 * Three-stage email discovery and verification used by the outreach
 * pipeline. Designed to never throw — every stage degrades to "no
 * email" so the analyze_lead background worker can keep going.
 *
 *   1. Scrape the lead's site (homepage + likely contact pages)
 *      and regex out any deliverable-looking address.
 *   2. If still nothing, query Hunter.io's domain-search API
 *      (skipped silently when HUNTER_API_KEY isn't set).
 *   3. Verify the chosen address with ZeroBounce
 *      (skipped silently when ZEROBOUNCE_API_KEY isn't set —
 *      in that case we treat the email as "unverified, ship it").
 *
 * The verifier is conservative: only "valid" results pass; "invalid"
 * fails; everything else (catch-all, unknown, do-not-mail) is
 * returned as `unverified` so the caller can decide what to do.
 */

const CONTACT_PATHS = ["/", "/contact", "/contact-us", "/about", "/about-us", "/team", "/staff"];
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES_PER_PAGE = 250_000;

const JUNK_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "wordpress",
  "example", "test", "user", "username", "email", "your-email",
  "name", "yourname", "yourcompany", "sentry", "wixpress",
]);

const JUNK_DOMAINS = new Set([
  "example.com", "sentry-next.wixpress.com", "wixpress.com",
  "sentry.io", "wordpress.com", "wp.com", "domain.com",
]);

export interface DiscoveryResult {
  email: string | null;
  source: "scrape" | "hunter" | "claude" | "none";
  verified: "valid" | "unverified" | "invalid";
  notes?: string;
}

function normalizeUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return url.origin;
  } catch {
    return null;
  }
}

function hostnameOf(raw: string): string | null {
  const normalized = normalizeUrl(raw);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function looksJunky(email: string): boolean {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  if (!local || !domain) return true;
  if (JUNK_LOCAL_PARTS.has(local)) return true;
  if (JUNK_DOMAINS.has(domain)) return true;
  if (domain.endsWith(".png") || domain.endsWith(".jpg") || domain.endsWith(".svg")) return true;
  if (/sentry|wix\b/.test(domain)) return true;
  return false;
}

function scoreEmail(email: string, businessHostname: string | null): number {
  const lower = email.toLowerCase();
  const [local, domain] = lower.split("@");
  let score = 0;
  // Strongly prefer addresses on the business's own domain.
  if (businessHostname && (domain === businessHostname || domain.endsWith(`.${businessHostname}`))) score += 100;
  // Owner/decision-maker patterns rank higher than role addresses.
  if (/^(owner|founder|ceo|president)$/.test(local)) score += 40;
  if (/^(hello|contact|inquiries|sales|office|hi)$/.test(local)) score += 25;
  if (/^info$/.test(local)) score += 15;
  // Penalize generic / shared inboxes lightly.
  if (/^(support|help|admin|webmaster|postmaster|abuse)$/.test(local)) score -= 15;
  return score;
}

async function fetchTextWithTimeout(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; BlackRidgeBot/1.0; +https://blackridgeplatforms.com/bot)",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const sliced = buf.byteLength > MAX_BYTES_PER_PAGE ? buf.slice(0, MAX_BYTES_PER_PAGE) : buf;
    return new TextDecoder("utf-8", { fatal: false }).decode(sliced);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractEmails(html: string): string[] {
  if (!html) return [];
  // Mailto links are higher-signal than free-floating text matches.
  const mailtoMatches = Array.from(html.matchAll(/mailto:([^"'?\s>]+)/gi)).map(m => m[1]);
  const plainMatches = Array.from(html.matchAll(EMAIL_REGEX)).map(m => m[0]);
  const unique = new Set<string>();
  for (const e of [...mailtoMatches, ...plainMatches]) {
    const cleaned = e.replace(/[.,;]+$/, "").trim().toLowerCase();
    if (cleaned && !looksJunky(cleaned)) unique.add(cleaned);
  }
  return Array.from(unique);
}

export async function scrapeEmailsFromSite(websiteUrl: string): Promise<string[]> {
  const origin = normalizeUrl(websiteUrl);
  if (!origin) return [];
  const businessHost = hostnameOf(websiteUrl);
  const seen = new Set<string>();
  for (const path of CONTACT_PATHS) {
    const html = await fetchTextWithTimeout(`${origin}${path}`);
    if (!html) continue;
    for (const email of extractEmails(html)) seen.add(email);
    if (seen.size >= 5) break;
  }
  return Array.from(seen).sort((a, b) => scoreEmail(b, businessHost) - scoreEmail(a, businessHost));
}

async function hunterDomainLookup(domain: string): Promise<string | null> {
  const apiKey = process.env.HUNTER_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=10&api_key=${apiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const emails = (data?.data?.emails ?? []) as Array<{ value: string; confidence?: number; type?: string; first_name?: string; last_name?: string }>;
    if (emails.length === 0) return null;
    // Prefer "personal" addresses with high confidence over generic role inboxes.
    const sorted = [...emails].sort((a, b) => {
      const aScore = (a.confidence ?? 0) + (a.type === "personal" ? 20 : 0);
      const bScore = (b.confidence ?? 0) + (b.type === "personal" ? 20 : 0);
      return bScore - aScore;
    });
    return sorted[0].value || null;
  } catch (err) {
    console.warn("[hunter] domain lookup failed:", err);
    return null;
  }
}

async function zeroBounceCheck(email: string): Promise<"valid" | "invalid" | "unverified"> {
  const apiKey = process.env.ZEROBOUNCE_API_KEY;
  if (!apiKey) return "unverified";
  try {
    const url = `https://api.zerobounce.net/v2/validate?api_key=${apiKey}&email=${encodeURIComponent(email)}`;
    const resp = await fetch(url);
    if (!resp.ok) return "unverified";
    const data = await resp.json() as any;
    const status = String(data?.status ?? "").toLowerCase();
    if (status === "valid") return "valid";
    if (status === "invalid") return "invalid";
    return "unverified";
  } catch (err) {
    console.warn("[zerobounce] check failed:", err);
    return "unverified";
  }
}

/**
 * Run the full three-stage discovery for one lead. The `claudeEmail`
 * is whatever Claude already proposed (if anything) — it's checked
 * before we burn any third-party API calls.
 */
export async function discoverAndVerifyEmail(opts: {
  websiteUrl: string;
  businessName: string;
  claudeEmail?: string | null;
}): Promise<DiscoveryResult> {
  const host = hostnameOf(opts.websiteUrl);

  // Stage 0: if Claude already gave us one, verify and use it.
  if (opts.claudeEmail && !looksJunky(opts.claudeEmail)) {
    const verified = await zeroBounceCheck(opts.claudeEmail);
    if (verified !== "invalid") {
      return { email: opts.claudeEmail.toLowerCase(), source: "claude", verified };
    }
  }

  // Stage 1: scrape the site for a real address.
  const scraped = await scrapeEmailsFromSite(opts.websiteUrl);
  for (const candidate of scraped) {
    const verified = await zeroBounceCheck(candidate);
    if (verified !== "invalid") {
      return { email: candidate, source: "scrape", verified };
    }
  }

  // Stage 2: Hunter.io domain search.
  if (host) {
    const hunterEmail = await hunterDomainLookup(host);
    if (hunterEmail && !looksJunky(hunterEmail)) {
      const verified = await zeroBounceCheck(hunterEmail);
      if (verified !== "invalid") {
        return { email: hunterEmail.toLowerCase(), source: "hunter", verified };
      }
    }
  }

  return {
    email: null,
    source: "none",
    verified: "invalid",
    notes: process.env.HUNTER_API_KEY ? undefined : "HUNTER_API_KEY not configured — skipped Hunter.io stage",
  };
}
