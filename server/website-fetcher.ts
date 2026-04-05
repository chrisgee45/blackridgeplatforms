export interface FetchResult {
  normalizedUrl: string;
  homepageHtml: string | null;
  visibleText: string | null;
  pageSizeEstimate: number;
  fetchStatus: "ok" | "error" | "rejected";
  fetchError: string | null;
}

const REJECTED_DOMAINS = [
  "facebook.com", "instagram.com", "twitter.com", "x.com",
  "linkedin.com", "youtube.com", "tiktok.com", "pinterest.com",
  "yelp.com", "yellowpages.com", "bbb.org", "nextdoor.com",
  "tripadvisor.com", "google.com", "mapquest.com",
  "angi.com", "angieslist.com", "homeadvisor.com", "thumbtack.com",
  "houzz.com", "reddit.com", "wikipedia.org",
];

const PARKED_INDICATORS = [
  "this domain is for sale",
  "domain is parked",
  "buy this domain",
  "this webpage is parked",
  "domain expired",
  "coming soon",
  "under construction",
  "parked by",
  "godaddy",
  "sedoparking",
  "hugedomains",
  "afternic",
  "dan.com",
];

function normalizeUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isRejectedDomain(domain: string): string | null {
  for (const rd of REJECTED_DOMAINS) {
    if (domain === rd || domain.endsWith(`.${rd}`)) {
      return rd;
    }
  }
  return null;
}

function stripHtmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(/&nbsp;/gi, " ");
  text = text.replace(/&amp;/gi, "&");
  text = text.replace(/&lt;/gi, "<");
  text = text.replace(/&gt;/gi, ">");
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&#?\w+;/g, " ");
  text = text.replace(/\s+/g, " ");
  return text.trim();
}

function isParkedPage(html: string, visibleText: string): boolean {
  const combined = (html + " " + visibleText).toLowerCase();
  const hits = PARKED_INDICATORS.filter(p => combined.includes(p));
  if (hits.length >= 2) return true;
  if (visibleText.length < 200 && hits.length >= 1) return true;
  return false;
}

export async function fetchHomepage(rawUrl: string): Promise<FetchResult> {
  const normalizedUrl = normalizeUrl(rawUrl);
  if (!normalizedUrl) {
    return {
      normalizedUrl: rawUrl,
      homepageHtml: null,
      visibleText: null,
      pageSizeEstimate: 0,
      fetchStatus: "rejected",
      fetchError: "Invalid URL format",
    };
  }

  const domain = getDomain(normalizedUrl);
  const rejected = isRejectedDomain(domain);
  if (rejected) {
    return {
      normalizedUrl,
      homepageHtml: null,
      visibleText: null,
      pageSizeEstimate: 0,
      fetchStatus: "rejected",
      fetchError: `Rejected domain: ${rejected} — not an independent business website`,
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        normalizedUrl,
        homepageHtml: null,
        visibleText: null,
        pageSizeEstimate: 0,
        fetchStatus: "error",
        fetchError: `HTTP ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return {
        normalizedUrl,
        homepageHtml: null,
        visibleText: null,
        pageSizeEstimate: 0,
        fetchStatus: "rejected",
        fetchError: `Not an HTML page (content-type: ${contentType})`,
      };
    }

    const html = await response.text();
    const pageSizeEstimate = Buffer.byteLength(html, "utf-8");
    const visibleText = stripHtmlToText(html);

    if (isParkedPage(html, visibleText)) {
      return {
        normalizedUrl,
        homepageHtml: html,
        visibleText,
        pageSizeEstimate,
        fetchStatus: "rejected",
        fetchError: "Parked or inactive domain detected",
      };
    }

    if (visibleText.length < 50) {
      return {
        normalizedUrl,
        homepageHtml: html,
        visibleText,
        pageSizeEstimate,
        fetchStatus: "rejected",
        fetchError: "Page has almost no visible content — likely inactive",
      };
    }

    return {
      normalizedUrl,
      homepageHtml: html,
      visibleText,
      pageSizeEstimate,
      fetchStatus: "ok",
      fetchError: null,
    };
  } catch (err: any) {
    const message = err.name === "AbortError"
      ? "Request timed out after 15 seconds"
      : err.code === "ENOTFOUND"
        ? "Domain does not resolve — site may not exist"
        : err.message || "Unknown fetch error";

    return {
      normalizedUrl,
      homepageHtml: null,
      visibleText: null,
      pageSizeEstimate: 0,
      fetchStatus: "error",
      fetchError: message,
    };
  }
}
