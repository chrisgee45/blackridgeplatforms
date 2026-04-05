export interface RuleScoringResult {
  ruleScore: number;
  matchedRules: string[];
}

export function scoreWebsite(url: string, html: string, visibleText: string): RuleScoringResult {
  const matchedRules: string[] = [];
  let ruleScore = 0;

  const htmlLower = html.toLowerCase();
  const textLower = visibleText.toLowerCase();

  if (!/<meta[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(html)) {
    ruleScore += 15;
    matchedRules.push("No viewport meta tag — likely not mobile-responsive");
  }

  if (!url.startsWith("https://") && !url.startsWith("https%")) {
    ruleScore += 10;
    matchedRules.push("No HTTPS — site is not secure");
  }

  const estimatedBytes = Buffer.byteLength(html, "utf-8");
  const estimatedMB = estimatedBytes / (1024 * 1024);
  if (estimatedMB > 3) {
    ruleScore += 10;
    matchedRules.push(`Page weight ~${estimatedMB.toFixed(1)}MB — exceeds 3MB threshold`);
  }

  const wpTraces = [
    "wp-content", "wp-includes", "wp-json", "wordpress",
    "wp-embed", "wp-block", "flavor=\"developer\"",
  ];
  if (wpTraces.some(t => htmlLower.includes(t))) {
    ruleScore += 10;
    matchedRules.push("WordPress theme traces detected — likely template-based site");
  }

  const ctaKeywords = ["call now", "get a quote", "contact us", "schedule", "get started", "free estimate", "book now", "request a quote"];
  const hasCta = ctaKeywords.some(kw => textLower.includes(kw) || htmlLower.includes(kw));
  if (!hasCta) {
    ruleScore += 10;
    matchedRules.push("No clear CTA keywords found — weak calls to action");
  }

  const phonePattern = /(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/;
  const topPortion = visibleText.slice(0, Math.min(visibleText.length, 800));
  if (!phonePattern.test(topPortion)) {
    ruleScore += 10;
    matchedRules.push("Phone number not visible in top portion of page");
  }

  const formIndicators = [
    /<form[\s>]/i,
    /<input[^>]*type\s*=\s*["']email["']/i,
    /<textarea[\s>]/i,
    /contact-form/i,
    /wpcf7/i,
    /formspree/i,
    /netlify.*form/i,
  ];
  const hasForm = formIndicators.some(re => re.test(html));
  if (!hasForm) {
    ruleScore += 10;
    matchedRules.push("No contact form detected on homepage");
  }

  const sliderPatterns = [
    /class\s*=\s*["'][^"']*(?:slider|carousel|swiper|slick|owl)[^"']*["']/i,
    /data-(?:slick|swiper|ride\s*=\s*["']carousel["'])/i,
    /<div[^>]*(?:slider|carousel|slideshow)[^>]*>/i,
  ];
  if (sliderPatterns.some(re => re.test(html))) {
    ruleScore += 10;
    matchedRules.push("Hero slider/carousel pattern detected — outdated design practice");
  }

  const externalScripts = (html.match(/<script[^>]*src\s*=\s*["']https?:\/\//gi) || []).length;
  if (externalScripts > 5) {
    ruleScore += 10;
    matchedRules.push(`${externalScripts} external scripts found — bloated and slow`);
  }

  const inlineStyleCount = (html.match(/style\s*=\s*["']/gi) || []).length;
  if (inlineStyleCount > 30) {
    ruleScore += 5;
    matchedRules.push(`${inlineStyleCount} inline styles detected — poor code quality`);
  }

  ruleScore = Math.min(ruleScore, 100);

  return { ruleScore, matchedRules };
}
