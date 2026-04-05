/**
 * Returns the public base URL of the app (no trailing slash).
 *
 * Resolution order:
 *   1. APP_URL env var (set this in production)
 *   2. http://localhost:<PORT> in development
 *
 * Use this anywhere you need to build absolute links back into the app
 * (e.g. payment-link redirect URLs, outbound email links).
 */
export function getAppUrl(): string {
  const explicit = process.env.APP_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const port = process.env.PORT || "5000";
  return `http://localhost:${port}`;
}
