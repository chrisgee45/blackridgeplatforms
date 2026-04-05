export interface Finding {
  agent: string;
  test_name: string;
  status: "PASSED" | "FAILED" | "WARNING" | "SKIPPED";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  description: string;
  evidence?: string | null;
  remediation?: string | null;
  endpoint?: string | null;
  response_code?: number | null;
  response_time_ms?: number | null;
}

const TIMEOUT = 10000;
const UA = "BlackRidge-QA-Agent/1.0";

async function safeFetch(url: string, opts: RequestInit & { timeout?: number } = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeout || TIMEOUT);
  try {
    const resp = await fetch(url, { ...opts, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");
}

function defaultHeaders(authToken?: string | null): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": UA };
  if (authToken) h["Authorization"] = `Bearer ${authToken}`;
  return h;
}

export class SecurityAgent {
  private findings: Finding[] = [];
  constructor(
    private targetUrl: string,
    private authToken?: string | null,
    private knownEndpoints: string[] = []
  ) {
    this.targetUrl = targetUrl.replace(/\/+$/, "");
  }

  private add(f: Omit<Finding, "agent">) {
    this.findings.push({ agent: "Security", ...f });
  }

  async run(): Promise<Finding[]> {
    const tests = [
      () => this.testSecurityHeaders(),
      () => this.testHttpsEnforcement(),
      () => this.testSqlInjection(),
      () => this.testXss(),
      () => this.testAuthBypass(),
      () => this.testSensitiveDataExposure(),
      () => this.testDangerousHttpMethods(),
      () => this.testRateLimiting(),
      () => this.testCorsMisconfiguration(),
    ];
    for (const test of tests) {
      try { await test(); } catch (e: any) {
        this.add({ test_name: test.name, status: "SKIPPED", severity: "INFO", title: `Test skipped`, description: `Exception: ${e.message}` });
      }
    }
    return this.findings;
  }

  private async testSecurityHeaders() {
    const start = Date.now();
    let resp: Response;
    try {
      resp = await safeFetch(this.targetUrl, { headers: defaultHeaders(this.authToken) });
    } catch (e: any) {
      this.add({ test_name: "security_headers", status: "SKIPPED", severity: "INFO", title: "Could not check security headers", description: `Connection failed: ${e.message}`, endpoint: this.targetUrl });
      return;
    }
    const elapsed = Date.now() - start;
    const required: Record<string, string> = {
      "x-frame-options": "Prevents clickjacking attacks",
      "x-content-type-options": "Prevents MIME-type sniffing",
      "strict-transport-security": "Enforces HTTPS connections",
      "content-security-policy": "Controls resource loading to prevent XSS",
      "x-xss-protection": "Legacy XSS protection header",
    };
    const missing: string[] = [];
    const present: string[] = [];
    for (const header of Object.keys(required)) {
      if (resp.headers.get(header)) present.push(header);
      else missing.push(header);
    }
    if (missing.length > 0) {
      this.add({ test_name: "security_headers", status: "FAILED", severity: "HIGH", title: `Missing ${missing.length} security header(s)`, description: `The following security headers are missing: ${missing.join(", ")}`, evidence: `Present: ${present.join(", ")}\nMissing: ${missing.join(", ")}`, remediation: `Add the following headers to all responses: ${missing.join(", ")}`, endpoint: this.targetUrl, response_code: resp.status, response_time_ms: elapsed });
    } else {
      this.add({ test_name: "security_headers", status: "PASSED", severity: "INFO", title: "All security headers present", description: "All required security headers are properly configured.", endpoint: this.targetUrl, response_code: resp.status, response_time_ms: elapsed });
    }
  }

  private async testHttpsEnforcement() {
    const url = new URL(this.targetUrl);
    if (url.protocol === "http:") {
      this.add({ test_name: "https_enforcement", status: "FAILED", severity: "HIGH", title: "Target URL uses HTTP instead of HTTPS", description: "The target URL does not use HTTPS encryption.", remediation: "Configure the server to use HTTPS with a valid SSL certificate.", endpoint: this.targetUrl });
      return;
    }
    const httpUrl = this.targetUrl.replace("https://", "http://");
    try {
      const resp = await safeFetch(httpUrl, { headers: defaultHeaders(this.authToken), redirect: "manual" });
      if ([301, 302, 307, 308].includes(resp.status)) {
        const location = resp.headers.get("location") || "";
        if (location.startsWith("https://")) {
          this.add({ test_name: "https_enforcement", status: "PASSED", severity: "INFO", title: "HTTP properly redirects to HTTPS", description: `HTTP requests are redirected to HTTPS (status ${resp.status}).`, endpoint: httpUrl, response_code: resp.status });
        } else {
          this.add({ test_name: "https_enforcement", status: "FAILED", severity: "HIGH", title: "HTTP does not redirect to HTTPS", description: `HTTP redirects to ${location} instead of HTTPS.`, remediation: "Configure redirect to HTTPS.", endpoint: httpUrl, response_code: resp.status });
        }
      } else {
        this.add({ test_name: "https_enforcement", status: "WARNING", severity: "MEDIUM", title: "HTTP endpoint responds without redirect", description: `The HTTP endpoint returned status ${resp.status} without redirecting to HTTPS.`, remediation: "Add an HTTP to HTTPS redirect.", endpoint: httpUrl, response_code: resp.status });
      }
    } catch {
      this.add({ test_name: "https_enforcement", status: "PASSED", severity: "INFO", title: "HTTP port not accessible", description: "The HTTP version of the site is not reachable, which is acceptable if HTTPS is enforced.", endpoint: httpUrl });
    }
  }

  private async testSqlInjection() {
    const payloads = ["' OR '1'='1", "; DROP TABLE users;--", "1 OR 1=1"];
    const sqlErrors = /syntax error|mysql|ORA-|pg_|sqlite3|SQL|unclosed quotation/i;
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints : ["/api/users", "/api/search"];
    let tested = false;
    for (const ep of endpoints) {
      const baseUrl = joinUrl(this.targetUrl, ep);
      for (const payload of payloads) {
        try {
          const url = `${baseUrl}?q=${encodeURIComponent(payload)}&id=${encodeURIComponent(payload)}`;
          const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
          tested = true;
          const text = await resp.text();
          if (sqlErrors.test(text)) {
            this.add({ test_name: "sql_injection", status: "FAILED", severity: "CRITICAL", title: `Possible SQL injection at ${ep}`, description: `SQL error keywords detected in response when injecting: ${payload}`, evidence: text.substring(0, 500), remediation: "Use parameterized queries. Never concatenate user input into SQL.", endpoint: baseUrl, response_code: resp.status });
            return;
          }
        } catch { continue; }
      }
    }
    if (tested) {
      this.add({ test_name: "sql_injection", status: "PASSED", severity: "INFO", title: "No SQL injection vulnerabilities detected", description: "Tested known endpoints with common SQL injection payloads. No SQL error patterns found.", endpoint: this.targetUrl });
    } else {
      this.add({ test_name: "sql_injection", status: "SKIPPED", severity: "INFO", title: "SQL injection test skipped", description: "Could not reach any endpoints to test.", endpoint: this.targetUrl });
    }
  }

  private async testXss() {
    const payloads = ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>'];
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints : ["/api/search", "/"];
    let tested = false;
    for (const ep of endpoints) {
      const baseUrl = joinUrl(this.targetUrl, ep);
      for (const payload of payloads) {
        try {
          const url = `${baseUrl}?q=${encodeURIComponent(payload)}&search=${encodeURIComponent(payload)}`;
          const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
          tested = true;
          const text = await resp.text();
          if (text.includes(payload)) {
            this.add({ test_name: "xss", status: "FAILED", severity: "HIGH", title: `Reflected XSS vulnerability at ${ep}`, description: "Injected payload was reflected unescaped in the response body.", evidence: `Payload: ${payload}\nFound in response body (first 500 chars): ${text.substring(0, 500)}`, remediation: "Sanitize and encode all user input before reflecting in responses.", endpoint: baseUrl, response_code: resp.status });
            return;
          }
        } catch { continue; }
      }
    }
    if (tested) {
      this.add({ test_name: "xss", status: "PASSED", severity: "INFO", title: "No XSS vulnerabilities detected", description: "Tested endpoints with XSS payloads. No reflected payloads found.", endpoint: this.targetUrl });
    } else {
      this.add({ test_name: "xss", status: "SKIPPED", severity: "INFO", title: "XSS test skipped", description: "No reachable endpoints.", endpoint: this.targetUrl });
    }
  }

  private async testAuthBypass() {
    const paths = ["/api/users", "/api/admin", "/api/dashboard", "/api/profile"];
    const bypassed: Array<{ path: string; status: number }> = [];
    for (const path of paths) {
      const url = joinUrl(this.targetUrl, path);
      try {
        const resp = await safeFetch(url, { headers: { "User-Agent": UA } });
        if (resp.status === 200) bypassed.push({ path, status: resp.status });
      } catch { continue; }
    }
    if (bypassed.length > 0) {
      this.add({ test_name: "auth_bypass", status: "FAILED", severity: "HIGH", title: `Authentication bypass on ${bypassed.length} endpoint(s)`, description: `Endpoints returned 200 without authentication: ${bypassed.map(b => b.path).join(", ")}`, evidence: JSON.stringify(bypassed), remediation: "Implement authentication middleware on all protected endpoints.", endpoint: this.targetUrl });
    } else {
      this.add({ test_name: "auth_bypass", status: "PASSED", severity: "INFO", title: "No authentication bypass detected", description: "All tested protected endpoints properly reject unauthenticated requests.", endpoint: this.targetUrl });
    }
  }

  private async testSensitiveDataExposure() {
    const patterns = [/(?:sk[-_]|AKIA[A-Z0-9]{16})/i, /"password"\s*:\s*"[^"]+"|"secret"\s*:\s*"[^"]+"/i, /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----/];
    const patternNames = ["API Key", "Password field", "Private Key"];
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints.slice(0, 5) : ["/"];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        const text = await resp.text();
        for (let i = 0; i < patterns.length; i++) {
          if (patterns[i].test(text)) {
            this.add({ test_name: "sensitive_data_exposure", status: "FAILED", severity: "CRITICAL", title: `Sensitive data exposed: ${patternNames[i]} at ${ep}`, description: `Response body contains potentially sensitive data matching pattern for: ${patternNames[i]}`, evidence: `Pattern matched in response from ${url}`, remediation: "Remove sensitive data from API responses. Use environment variables for secrets.", endpoint: url, response_code: resp.status });
            return;
          }
        }
      } catch { continue; }
    }
    this.add({ test_name: "sensitive_data_exposure", status: "PASSED", severity: "INFO", title: "No sensitive data exposure detected", description: "Scanned responses for API keys, passwords, and private keys. None found.", endpoint: this.targetUrl });
  }

  private async testDangerousHttpMethods() {
    try {
      const resp = await safeFetch(this.targetUrl, { method: "OPTIONS", headers: defaultHeaders(this.authToken) });
      const allow = resp.headers.get("allow") || "";
      const dangerous = ["TRACE", "TRACK"].filter(m => allow.toUpperCase().includes(m));
      if (dangerous.length > 0) {
        this.add({ test_name: "dangerous_methods", status: "FAILED", severity: "MEDIUM", title: `Dangerous HTTP methods enabled: ${dangerous.join(", ")}`, description: `The server allows ${dangerous.join(", ")} methods which can be exploited for XST attacks.`, evidence: `Allow header: ${allow}`, remediation: "Disable TRACE and TRACK methods on the server.", endpoint: this.targetUrl, response_code: resp.status });
      } else {
        this.add({ test_name: "dangerous_methods", status: "PASSED", severity: "INFO", title: "No dangerous HTTP methods enabled", description: "TRACE and TRACK methods are not listed in the Allow header.", endpoint: this.targetUrl, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "dangerous_methods", status: "SKIPPED", severity: "INFO", title: "Could not check HTTP methods", description: `OPTIONS request failed: ${e.message}`, endpoint: this.targetUrl });
    }
  }

  private async testRateLimiting() {
    const loginPaths = ["/api/auth/login", "/api/login"];
    for (const path of loginPaths) {
      const url = joinUrl(this.targetUrl, path);
      try {
        const responses: number[] = [];
        for (let i = 0; i < 15; i++) {
          const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ email: "test@test.com", password: "test" }) });
          responses.push(resp.status);
        }
        if (!responses.includes(429)) {
          this.add({ test_name: "rate_limiting", status: "FAILED", severity: "HIGH", title: `No rate limiting on ${path}`, description: `Sent 15 rapid requests to ${path}. None returned 429 Too Many Requests.`, evidence: `Status codes received: ${JSON.stringify(responses)}`, remediation: "Implement rate limiting on authentication endpoints (e.g., 5 attempts per minute).", endpoint: url });
        } else {
          this.add({ test_name: "rate_limiting", status: "PASSED", severity: "INFO", title: `Rate limiting active on ${path}`, description: "Rate limiting is in effect. Received 429 after rapid requests.", endpoint: url });
        }
        return;
      } catch { continue; }
    }
    this.add({ test_name: "rate_limiting", status: "SKIPPED", severity: "INFO", title: "No login endpoint found for rate limiting test", description: "Could not find /api/auth/login or /api/login.", endpoint: this.targetUrl });
  }

  private async testCorsMisconfiguration() {
    const evilOrigin = "https://evil.blackridge-qa-test.com";
    try {
      const resp = await safeFetch(this.targetUrl, { headers: { ...defaultHeaders(this.authToken), Origin: evilOrigin } });
      const acao = resp.headers.get("access-control-allow-origin") || "";
      const acac = (resp.headers.get("access-control-allow-credentials") || "").toLowerCase();
      if (acao === evilOrigin) {
        this.add({ test_name: "cors", status: "FAILED", severity: "CRITICAL", title: "CORS reflects arbitrary origins", description: `The server reflects back the evil origin '${evilOrigin}' in Access-Control-Allow-Origin.`, evidence: `Access-Control-Allow-Origin: ${acao}`, remediation: "Configure CORS to only allow trusted origins.", endpoint: this.targetUrl, response_code: resp.status });
      } else if (acao === "*" && acac === "true") {
        this.add({ test_name: "cors", status: "FAILED", severity: "CRITICAL", title: "CORS wildcard with credentials", description: "Access-Control-Allow-Origin is '*' while Allow-Credentials is 'true'. This is a dangerous combination.", remediation: "Do not use wildcard origin with credentials.", endpoint: this.targetUrl, response_code: resp.status });
      } else {
        this.add({ test_name: "cors", status: "PASSED", severity: "INFO", title: "CORS configuration is acceptable", description: `CORS does not reflect arbitrary origins. ACAO: '${acao}'`, endpoint: this.targetUrl, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "cors", status: "SKIPPED", severity: "INFO", title: "Could not check CORS", description: `Request failed: ${e.message}`, endpoint: this.targetUrl });
    }
  }
}

export class InfrastructureAgent {
  private findings: Finding[] = [];
  constructor(private targetUrl: string, private authToken?: string | null, private knownEndpoints: string[] = []) {
    this.targetUrl = targetUrl.replace(/\/+$/, "");
  }
  private add(f: Omit<Finding, "agent">) { this.findings.push({ agent: "Infrastructure", ...f }); }

  async run(): Promise<Finding[]> {
    const tests = [
      () => this.testReachability(), () => this.testResponseTime(),
      () => this.testSslCertificate(), () => this.testCorsHeaders(),
      () => this.testErrorHandling(), () => this.testLargePayload(),
      () => this.testConcurrentLoad(), () => this.testHealthEndpoint(),
      () => this.testHttpToHttpsRedirect(),
    ];
    for (const test of tests) {
      try { await test(); } catch (e: any) {
        this.add({ test_name: test.name, status: "SKIPPED", severity: "INFO", title: `Test skipped`, description: `Exception: ${e.message}` });
      }
    }
    return this.findings;
  }

  private async testReachability() {
    const start = Date.now();
    try {
      const resp = await safeFetch(this.targetUrl, { headers: defaultHeaders(this.authToken) });
      const elapsed = Date.now() - start;
      this.add({ test_name: "reachability", status: "PASSED", severity: "INFO", title: "API is reachable", description: `Successfully connected to ${this.targetUrl}. Status: ${resp.status}`, endpoint: this.targetUrl, response_code: resp.status, response_time_ms: elapsed });
    } catch (e: any) {
      if (e.name === "AbortError") {
        this.add({ test_name: "reachability", status: "FAILED", severity: "CRITICAL", title: "API connection timed out", description: `Connection to ${this.targetUrl} timed out after 10 seconds.`, remediation: "Check server health and network connectivity.", endpoint: this.targetUrl });
      } else {
        this.add({ test_name: "reachability", status: "FAILED", severity: "CRITICAL", title: "API is unreachable", description: `Connection failed: ${e.message}`, remediation: "Verify the server is running and the URL is correct.", endpoint: this.targetUrl });
      }
    }
  }

  private async testResponseTime() {
    const start = Date.now();
    try {
      const resp = await safeFetch(this.targetUrl, { headers: defaultHeaders(this.authToken), timeout: 15000 });
      const elapsed = Date.now() - start;
      if (elapsed > 5000) {
        this.add({ test_name: "response_time", status: "FAILED", severity: "HIGH", title: `Very slow response: ${elapsed}ms`, description: `Response time of ${elapsed}ms exceeds 5000ms threshold.`, remediation: "Optimize server performance, add caching, or check for blocking operations.", endpoint: this.targetUrl, response_code: resp.status, response_time_ms: elapsed });
      } else if (elapsed > 2000) {
        this.add({ test_name: "response_time", status: "WARNING", severity: "MEDIUM", title: `Slow response: ${elapsed}ms`, description: `Response time of ${elapsed}ms exceeds 2000ms warning threshold.`, remediation: "Consider performance optimization.", endpoint: this.targetUrl, response_code: resp.status, response_time_ms: elapsed });
      } else {
        this.add({ test_name: "response_time", status: "PASSED", severity: "INFO", title: `Good response time: ${elapsed}ms`, description: `Response time of ${elapsed}ms is within acceptable limits.`, endpoint: this.targetUrl, response_code: resp.status, response_time_ms: elapsed });
      }
    } catch (e: any) {
      this.add({ test_name: "response_time", status: "SKIPPED", severity: "INFO", title: "Response time test skipped", description: e.message, endpoint: this.targetUrl });
    }
  }

  private async testSslCertificate() {
    const url = new URL(this.targetUrl);
    if (url.protocol !== "https:") {
      this.add({ test_name: "ssl_certificate", status: "SKIPPED", severity: "INFO", title: "SSL test skipped (not HTTPS)", description: "Target URL uses HTTP. SSL certificate check requires HTTPS.", endpoint: this.targetUrl });
      return;
    }
    try {
      const https = await import("https");
      const tls = await import("tls");
      const result = await new Promise<{ valid: boolean; daysRemaining: number; notAfter: string; error?: string }>((resolve) => {
        const req = https.request({ hostname: url.hostname, port: url.port || 443, method: "HEAD", path: "/", rejectUnauthorized: true }, (res) => {
          const socket = res.socket as import("tls").TLSSocket;
          const cert = socket.getPeerCertificate();
          if (cert && cert.valid_to) {
            const notAfter = new Date(cert.valid_to).getTime();
            const daysRemaining = (notAfter - Date.now()) / 86400000;
            resolve({ valid: true, daysRemaining, notAfter: cert.valid_to });
          } else {
            resolve({ valid: true, daysRemaining: 999, notAfter: "unknown" });
          }
          res.destroy();
        });
        req.on("error", (e: any) => resolve({ valid: false, daysRemaining: 0, notAfter: "", error: e.message }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ valid: false, daysRemaining: 0, notAfter: "", error: "timeout" }); });
        req.end();
      });
      if (!result.valid) {
        this.add({ test_name: "ssl_certificate", status: "FAILED", severity: "CRITICAL", title: "SSL certificate validation failed", description: `SSL error: ${result.error}`, remediation: "Ensure a valid, trusted SSL certificate is installed.", endpoint: this.targetUrl });
      } else if (result.daysRemaining < 0) {
        this.add({ test_name: "ssl_certificate", status: "FAILED", severity: "CRITICAL", title: "SSL certificate has expired", description: `The certificate expired ${Math.abs(result.daysRemaining).toFixed(0)} days ago.`, remediation: "Renew the SSL certificate immediately.", endpoint: this.targetUrl });
      } else if (result.daysRemaining < 30) {
        this.add({ test_name: "ssl_certificate", status: "WARNING", severity: "MEDIUM", title: `SSL certificate expires in ${result.daysRemaining.toFixed(0)} days`, description: `Certificate expires on ${result.notAfter}.`, remediation: "Renew the SSL certificate before expiry.", endpoint: this.targetUrl });
      } else {
        this.add({ test_name: "ssl_certificate", status: "PASSED", severity: "INFO", title: `SSL certificate valid (${result.daysRemaining.toFixed(0)} days remaining)`, description: `Certificate is valid until ${result.notAfter}.`, endpoint: this.targetUrl });
      }
    } catch (e: any) {
      this.add({ test_name: "ssl_certificate", status: "SKIPPED", severity: "INFO", title: "SSL check failed", description: `Error: ${e.message}`, endpoint: this.targetUrl });
    }
  }

  private async testCorsHeaders() {
    try {
      const resp = await safeFetch(this.targetUrl, { headers: defaultHeaders(this.authToken) });
      const acao = resp.headers.get("access-control-allow-origin");
      if (acao) {
        this.add({ test_name: "cors_headers", status: "PASSED", severity: "INFO", title: "CORS headers present", description: `Access-Control-Allow-Origin: ${acao}`, endpoint: this.targetUrl, response_code: resp.status });
      } else {
        this.add({ test_name: "cors_headers", status: "WARNING", severity: "LOW", title: "No CORS headers detected", description: "No Access-Control-Allow-Origin header found.", remediation: "Add appropriate CORS headers if cross-origin access is needed.", endpoint: this.targetUrl, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "cors_headers", status: "SKIPPED", severity: "INFO", title: "CORS check skipped", description: e.message, endpoint: this.targetUrl });
    }
  }

  private async testErrorHandling() {
    const url = joinUrl(this.targetUrl, "api/this-does-not-exist-qa-test");
    try {
      const start = Date.now();
      const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
      const elapsed = Date.now() - start;
      const text = await resp.text();
      if (resp.status === 404) {
        const stackPatterns = ["Traceback", "at Object.", "node_modules", "Error:", "at Function.", "at Module."];
        const hasStack = stackPatterns.some(p => text.includes(p));
        if (hasStack) {
          this.add({ test_name: "error_handling", status: "FAILED", severity: "MEDIUM", title: "Error response contains stack trace", description: "404 response includes internal stack trace information.", evidence: text.substring(0, 500), remediation: "Customize error responses to hide internal details.", endpoint: url, response_code: 404, response_time_ms: elapsed });
        } else {
          this.add({ test_name: "error_handling", status: "PASSED", severity: "INFO", title: "Proper 404 error handling", description: "Non-existent endpoint returns 404 without exposing internals.", endpoint: url, response_code: 404, response_time_ms: elapsed });
        }
      } else if (resp.status === 500) {
        this.add({ test_name: "error_handling", status: "FAILED", severity: "HIGH", title: "Server error on unknown endpoint", description: "Non-existent endpoint returned 500 instead of 404.", remediation: "Add catch-all route that returns 404 for unknown endpoints.", endpoint: url, response_code: 500, response_time_ms: elapsed });
      } else if (resp.status === 200) {
        this.add({ test_name: "error_handling", status: "WARNING", severity: "MEDIUM", title: "Non-existent endpoint returns 200", description: "A non-existent endpoint returned 200 OK. This may indicate a wildcard route.", remediation: "Ensure unknown endpoints return 404.", endpoint: url, response_code: 200, response_time_ms: elapsed });
      } else {
        this.add({ test_name: "error_handling", status: "PASSED", severity: "INFO", title: `Error handling returns ${resp.status}`, description: `Non-existent endpoint returned status ${resp.status}.`, endpoint: url, response_code: resp.status, response_time_ms: elapsed });
      }
    } catch (e: any) {
      this.add({ test_name: "error_handling", status: "SKIPPED", severity: "INFO", title: "Error handling test skipped", description: e.message, endpoint: url });
    }
  }

  private async testLargePayload() {
    const largeBody = "x".repeat(10 * 1024 * 1024);
    const endpoints = this.knownEndpoints.length > 0 ? [this.knownEndpoints[0]] : ["/api/test-large-payload"];
    const url = joinUrl(this.targetUrl, endpoints[0]);
    try {
      const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/octet-stream" }, body: largeBody, timeout: 15000 });
      if ([413, 400].includes(resp.status)) {
        this.add({ test_name: "large_payload", status: "PASSED", severity: "INFO", title: "Server correctly rejects large payloads", description: `Server returned ${resp.status} for 10MB payload.`, endpoint: url, response_code: resp.status });
      } else if (resp.status === 500) {
        this.add({ test_name: "large_payload", status: "FAILED", severity: "MEDIUM", title: "Server crashes on large payload", description: "Server returned 500 Internal Server Error when sent a 10MB payload.", remediation: "Set a request body size limit (e.g., 1MB).", endpoint: url, response_code: 500 });
      } else {
        this.add({ test_name: "large_payload", status: "WARNING", severity: "LOW", title: `Large payload returned ${resp.status}`, description: `Server accepted a 10MB payload with status ${resp.status}.`, remediation: "Consider adding request body size limits.", endpoint: url, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "large_payload", status: "SKIPPED", severity: "INFO", title: "Large payload test skipped", description: e.message, endpoint: url });
    }
  }

  private async testConcurrentLoad() {
    const promises = Array.from({ length: 10 }, () =>
      safeFetch(this.targetUrl, { headers: { "User-Agent": UA } }).then(r => r.status).catch(() => 0)
    );
    const results = await Promise.all(promises);
    const serverErrors = results.filter(r => r >= 500);
    const failures = results.filter(r => r === 0);
    if (serverErrors.length > 0) {
      this.add({ test_name: "concurrent_load", status: "FAILED", severity: "HIGH", title: `Server errors under concurrent load (${serverErrors.length}/10 requests)`, description: `Status codes: ${JSON.stringify(results)}`, remediation: "Investigate server capacity and connection pooling.", endpoint: this.targetUrl });
    } else if (failures.length > 0) {
      this.add({ test_name: "concurrent_load", status: "WARNING", severity: "MEDIUM", title: `Some concurrent requests failed (${failures.length}/10)`, description: `Results: ${JSON.stringify(results)}`, endpoint: this.targetUrl });
    } else {
      this.add({ test_name: "concurrent_load", status: "PASSED", severity: "INFO", title: "Server handles concurrent load", description: `All 10 concurrent requests succeeded. Status codes: ${JSON.stringify(results)}`, endpoint: this.targetUrl });
    }
  }

  private async testHealthEndpoint() {
    const healthPaths = ["/health", "/api/health", "/ping", "/healthz"];
    for (const path of healthPaths) {
      const url = joinUrl(this.targetUrl, path);
      try {
        const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        if (resp.status === 200) {
          this.add({ test_name: "health_endpoint", status: "PASSED", severity: "INFO", title: `Health endpoint found at ${path}`, description: "Health endpoint returns 200 OK.", endpoint: url, response_code: 200 });
          return;
        }
      } catch { continue; }
    }
    this.add({ test_name: "health_endpoint", status: "WARNING", severity: "LOW", title: "No health check endpoint found", description: `Checked: ${healthPaths.join(", ")}. None returned 200.`, remediation: "Add a /health endpoint that returns 200 when the service is healthy.", endpoint: this.targetUrl });
  }

  private async testHttpToHttpsRedirect() {
    const url = new URL(this.targetUrl);
    if (url.protocol !== "https:") {
      this.add({ test_name: "http_redirect", status: "SKIPPED", severity: "INFO", title: "HTTP redirect test skipped", description: "Target is not HTTPS.", endpoint: this.targetUrl });
      return;
    }
    const httpUrl = this.targetUrl.replace("https://", "http://");
    try {
      const resp = await safeFetch(httpUrl, { headers: { "User-Agent": UA }, redirect: "manual" });
      if ([301, 302, 307, 308].includes(resp.status)) {
        const location = resp.headers.get("location") || "";
        if (location.includes("https://")) {
          this.add({ test_name: "http_redirect", status: "PASSED", severity: "INFO", title: "HTTP to HTTPS redirect configured", description: `HTTP redirects to HTTPS with status ${resp.status}.`, endpoint: httpUrl, response_code: resp.status });
        } else {
          this.add({ test_name: "http_redirect", status: "WARNING", severity: "MEDIUM", title: "HTTP redirect does not point to HTTPS", description: `Redirect location: ${location}`, endpoint: httpUrl, response_code: resp.status });
        }
      } else {
        this.add({ test_name: "http_redirect", status: "WARNING", severity: "MEDIUM", title: `No HTTP to HTTPS redirect (status ${resp.status})`, description: "HTTP requests are served without redirecting to HTTPS.", remediation: "Add a redirect from HTTP to HTTPS.", endpoint: httpUrl, response_code: resp.status });
      }
    } catch {
      this.add({ test_name: "http_redirect", status: "PASSED", severity: "INFO", title: "HTTP port not accessible", description: "HTTP version is not reachable, which is acceptable if HTTPS is enforced.", endpoint: httpUrl });
    }
  }
}

export class APIAgent {
  private findings: Finding[] = [];
  constructor(private targetUrl: string, private authToken?: string | null, private knownEndpoints: string[] = []) {
    this.targetUrl = targetUrl.replace(/\/+$/, "");
  }
  private add(f: Omit<Finding, "agent">) { this.findings.push({ agent: "API", ...f }); }

  async run(): Promise<Finding[]> {
    const tests = [
      () => this.testContentType(), () => this.testMethodEnforcement(),
      () => this.testEmptyBodyValidation(), () => this.testInvalidEmailValidation(),
      () => this.testNegativeNumberValidation(), () => this.testConsistentErrorFormat(),
      () => this.testPagination(), () => this.testIdempotentGet(),
      () => this.testApiVersioning(),
    ];
    for (const test of tests) {
      try { await test(); } catch (e: any) {
        this.add({ test_name: test.name, status: "SKIPPED", severity: "INFO", title: "Test skipped", description: `Exception: ${e.message}` });
      }
    }
    return this.findings;
  }

  private async testContentType() {
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints.slice(0, 3) : ["/"];
    const issues: Array<{ endpoint: string; content_type: string }> = [];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        const ct = resp.headers.get("content-type") || "";
        if (!ct.includes("application/json") && resp.status === 200) {
          issues.push({ endpoint: ep, content_type: ct });
        }
      } catch { continue; }
    }
    if (issues.length > 0) {
      this.add({ test_name: "content_type", status: "WARNING", severity: "LOW", title: `Missing JSON Content-Type on ${issues.length} endpoint(s)`, description: `Endpoints returning non-JSON Content-Type: ${issues.map(i => i.endpoint).join(", ")}`, evidence: JSON.stringify(issues), remediation: "Set Content-Type: application/json on all API responses.", endpoint: this.targetUrl });
    } else {
      this.add({ test_name: "content_type", status: "PASSED", severity: "INFO", title: "API responses include proper Content-Type", description: "All tested endpoints return Content-Type: application/json.", endpoint: this.targetUrl });
    }
  }

  private async testMethodEnforcement() {
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints.slice(0, 3) : ["/api/users"];
    let tested = false;
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const getResp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        if (getResp.status === 200) {
          const postResp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({}) });
          tested = true;
          if (postResp.status === 405) {
            this.add({ test_name: "method_enforcement", status: "PASSED", severity: "INFO", title: "HTTP method enforcement working", description: `POST to GET-only endpoint ${ep} correctly returns 405.`, endpoint: url, response_code: 405 });
            return;
          } else if ([200, 201].includes(postResp.status)) {
            this.add({ test_name: "method_enforcement", status: "WARNING", severity: "LOW", title: `No method enforcement on ${ep}`, description: `POST to ${ep} returned ${postResp.status} instead of 405.`, remediation: "Return 405 Method Not Allowed for unsupported HTTP methods.", endpoint: url, response_code: postResp.status });
            return;
          }
        }
      } catch { continue; }
    }
    this.add({ test_name: "method_enforcement", status: tested ? "PASSED" : "SKIPPED", severity: "INFO", title: tested ? "Method enforcement checked" : "Method enforcement test skipped", description: tested ? "Tested available endpoints." : "No suitable endpoints found.", endpoint: this.targetUrl });
  }

  private async testEmptyBodyValidation() {
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints.slice(0, 3) : ["/api/users", "/api/orders"];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({}) });
        if ([400, 422].includes(resp.status)) {
          this.add({ test_name: "empty_body_validation", status: "PASSED", severity: "INFO", title: `Empty body properly validated on ${ep}`, description: `Server returned ${resp.status} for empty POST body.`, endpoint: url, response_code: resp.status });
          return;
        } else if (resp.status === 500) {
          this.add({ test_name: "empty_body_validation", status: "FAILED", severity: "HIGH", title: `Server error on empty body POST to ${ep}`, description: "Server returned 500 instead of 400/422 for empty body.", remediation: "Add input validation to reject empty request bodies gracefully.", endpoint: url, response_code: 500 });
          return;
        }
      } catch { continue; }
    }
    this.add({ test_name: "empty_body_validation", status: "SKIPPED", severity: "INFO", title: "Empty body validation test skipped", description: "No POST endpoints responded.", endpoint: this.targetUrl });
  }

  private async testInvalidEmailValidation() {
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints.slice(0, 3) : ["/api/users", "/api/register"];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ email: "not-an-email", name: "Test" }) });
        if ([400, 422].includes(resp.status)) {
          this.add({ test_name: "invalid_email", status: "PASSED", severity: "INFO", title: `Invalid email properly rejected on ${ep}`, description: `Server returned ${resp.status} for invalid email.`, endpoint: url, response_code: resp.status });
          return;
        } else if ([200, 201].includes(resp.status)) {
          this.add({ test_name: "invalid_email", status: "FAILED", severity: "MEDIUM", title: `Invalid email accepted on ${ep}`, description: "Server accepted 'not-an-email' as a valid email address.", remediation: "Add email format validation.", endpoint: url, response_code: resp.status });
          return;
        }
      } catch { continue; }
    }
    this.add({ test_name: "invalid_email", status: "SKIPPED", severity: "INFO", title: "Email validation test skipped", description: "No suitable endpoints found.", endpoint: this.targetUrl });
  }

  private async testNegativeNumberValidation() {
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints.slice(0, 3) : ["/api/orders", "/api/products"];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ price: -999, amount: -999, quantity: -1 }) });
        if ([400, 422].includes(resp.status)) {
          this.add({ test_name: "negative_numbers", status: "PASSED", severity: "INFO", title: `Negative numbers properly rejected on ${ep}`, description: `Server returned ${resp.status} for negative values.`, endpoint: url, response_code: resp.status });
          return;
        } else if ([200, 201].includes(resp.status)) {
          this.add({ test_name: "negative_numbers", status: "WARNING", severity: "MEDIUM", title: `Negative numbers accepted on ${ep}`, description: "Server accepted negative values for price/amount fields.", remediation: "Add validation to reject negative numbers for monetary and quantity fields.", endpoint: url, response_code: resp.status });
          return;
        }
      } catch { continue; }
    }
    this.add({ test_name: "negative_numbers", status: "SKIPPED", severity: "INFO", title: "Negative number validation test skipped", description: "No suitable endpoints found.", endpoint: this.targetUrl });
  }

  private async testConsistentErrorFormat() {
    const endpoints = ["/api/this-does-not-exist-qa-test"];
    if (this.knownEndpoints.length > 0) endpoints.push(this.knownEndpoints[0]);
    const errorResponses: Array<{ endpoint: string; status: number; hasErrorField: boolean }> = [];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        if (resp.status >= 400) {
          try {
            const body = await resp.json() as Record<string, unknown>;
            const hasField = "error" in body || "message" in body || "detail" in body;
            errorResponses.push({ endpoint: ep, status: resp.status, hasErrorField: hasField });
          } catch {
            errorResponses.push({ endpoint: ep, status: resp.status, hasErrorField: false });
          }
        }
      } catch { continue; }
    }
    if (errorResponses.length === 0) {
      this.add({ test_name: "error_format", status: "SKIPPED", severity: "INFO", title: "Error format test skipped", description: "No error responses received.", endpoint: this.targetUrl });
    } else if (errorResponses.every(e => e.hasErrorField)) {
      this.add({ test_name: "error_format", status: "PASSED", severity: "INFO", title: "Consistent error response format", description: "All error responses include 'error' or 'message' field.", endpoint: this.targetUrl });
    } else {
      this.add({ test_name: "error_format", status: "WARNING", severity: "LOW", title: "Inconsistent error response format", description: "Some error responses lack a standard error/message field.", remediation: "Standardize all error responses to include an 'error' or 'message' field.", endpoint: this.targetUrl });
    }
  }

  private async testPagination() {
    const listEndpoints = this.knownEndpoints.filter(ep => /users|orders|items|list|products/i.test(ep));
    const endpoints = listEndpoints.length > 0 ? listEndpoints.slice(0, 2) : ["/api/users", "/api/orders"];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        if (resp.status === 200) {
          const body = await resp.json() as Record<string, unknown>;
          if (typeof body === "object" && body !== null && !Array.isArray(body)) {
            const paginationKeys = ["page", "total", "limit", "offset", "count", "next", "per_page", "totalPages"];
            const found = paginationKeys.filter(k => k in body);
            if (found.length > 0) {
              this.add({ test_name: "pagination", status: "PASSED", severity: "INFO", title: `Pagination detected on ${ep}`, description: `Found pagination fields: ${found.join(", ")}`, endpoint: url, response_code: 200 });
              return;
            }
          }
        }
      } catch { continue; }
    }
    this.add({ test_name: "pagination", status: "WARNING", severity: "LOW", title: "No pagination detected on list endpoints", description: "List endpoints do not appear to include pagination metadata.", remediation: "Add pagination (page, total, limit) to all list endpoints.", endpoint: this.targetUrl });
  }

  private async testIdempotentGet() {
    const endpoints = this.knownEndpoints.length > 0 ? [this.knownEndpoints[0]] : ["/"];
    const url = joinUrl(this.targetUrl, endpoints[0]);
    try {
      const responses: string[] = [];
      let lastStatus = 0;
      for (let i = 0; i < 3; i++) {
        const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        lastStatus = resp.status;
        responses.push(await resp.text());
      }
      if (new Set(responses).size === 1) {
        this.add({ test_name: "idempotent_get", status: "PASSED", severity: "INFO", title: "GET requests are idempotent", description: `Three identical GET requests to ${endpoints[0]} returned identical responses.`, endpoint: url, response_code: lastStatus });
      } else {
        this.add({ test_name: "idempotent_get", status: "WARNING", severity: "LOW", title: "GET responses are not consistent", description: "Three identical GET requests returned different responses.", remediation: "Ensure GET requests are idempotent and return consistent results.", endpoint: url, response_code: lastStatus });
      }
    } catch (e: any) {
      this.add({ test_name: "idempotent_get", status: "SKIPPED", severity: "INFO", title: "Idempotency test skipped", description: e.message, endpoint: url });
    }
  }

  private async testApiVersioning() {
    try {
      const resp = await safeFetch(this.targetUrl, { headers: defaultHeaders(this.authToken) });
      const urlHasVersion = ["/v1/", "/v2/", "/v3/", "/api/v"].some(v => this.targetUrl.toLowerCase().includes(v));
      const headerVersion = resp.headers.get("x-api-version") || resp.headers.get("api-version");
      if (urlHasVersion || headerVersion) {
        this.add({ test_name: "api_versioning", status: "PASSED", severity: "INFO", title: "API versioning detected", description: `URL versioning: ${urlHasVersion}, Header versioning: ${headerVersion}`, endpoint: this.targetUrl, response_code: resp.status });
      } else {
        this.add({ test_name: "api_versioning", status: "WARNING", severity: "LOW", title: "No API versioning detected", description: "No version prefix in URL or version headers found.", remediation: "Consider adding API versioning (e.g., /api/v1/) for backward compatibility.", endpoint: this.targetUrl, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "api_versioning", status: "SKIPPED", severity: "INFO", title: "Versioning test skipped", description: e.message, endpoint: this.targetUrl });
    }
  }
}

export class DataFlowAgent {
  private findings: Finding[] = [];
  constructor(private targetUrl: string, private authToken?: string | null, private knownEndpoints: string[] = []) {
    this.targetUrl = targetUrl.replace(/\/+$/, "");
  }
  private add(f: Omit<Finding, "agent">) { this.findings.push({ agent: "Data Flow", ...f }); }

  private getCrudEndpoint(): string | null {
    const crudPatterns = ["users", "orders", "items", "products", "posts", "comments"];
    for (const ep of this.knownEndpoints) {
      if (crudPatterns.some(p => ep.toLowerCase().includes(p))) return ep;
    }
    return this.knownEndpoints[0] || null;
  }

  async run(): Promise<Finding[]> {
    const tests = [
      () => this.testCreateReadConsistency(), () => this.testDataTypeIntegrity(),
      () => this.testRequiredFieldValidation(), () => this.testUpdatePropagation(),
      () => this.testDeleteVerification(), () => this.testFinancialCalculation(),
      () => this.testDataSanitization(), () => this.testTimestampFormat(),
      () => this.testConcurrentWriteSafety(),
    ];
    for (const test of tests) {
      try { await test(); } catch (e: any) {
        this.add({ test_name: test.name, status: "SKIPPED", severity: "INFO", title: "Test skipped", description: `Exception: ${e.message}` });
      }
    }
    return this.findings;
  }

  private async testCreateReadConsistency() {
    const ep = this.getCrudEndpoint();
    if (!ep) { this.add({ test_name: "create_read", status: "SKIPPED", severity: "INFO", title: "Create-read test skipped", description: "No CRUD endpoints provided.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, ep);
    const testData = { name: "QA_TEST_ITEM_" + Date.now(), email: "qa-test@blackridge.test", description: "QA test record" };
    try {
      const createResp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify(testData) });
      if (![200, 201].includes(createResp.status)) {
        this.add({ test_name: "create_read", status: "SKIPPED", severity: "INFO", title: "Create-read test: could not create resource", description: `POST returned ${createResp.status}.`, endpoint: url, response_code: createResp.status });
        return;
      }
      const created = await createResp.json() as Record<string, any>;
      const resourceId = created.id || created._id;
      if (!resourceId) { this.add({ test_name: "create_read", status: "SKIPPED", severity: "INFO", title: "Create-read test: no ID in response", description: "Cannot verify without ID.", endpoint: url }); return; }
      const readUrl = `${url.replace(/\/+$/, "")}/${resourceId}`;
      const readResp = await safeFetch(readUrl, { headers: defaultHeaders(this.authToken) });
      if (readResp.status === 200) {
        const readData = await readResp.json() as Record<string, any>;
        const mismatches: string[] = [];
        for (const [key, val] of Object.entries(testData)) {
          if (key in readData && readData[key] !== val) mismatches.push(`${key}: sent=${val}, got=${readData[key]}`);
        }
        if (mismatches.length > 0) {
          this.add({ test_name: "create_read", status: "FAILED", severity: "HIGH", title: "Create-read data mismatch", description: `Fields differ: ${mismatches.join(", ")}`, endpoint: url, response_code: readResp.status });
        } else {
          this.add({ test_name: "create_read", status: "PASSED", severity: "INFO", title: "Create-read consistency verified", description: "POST and GET return matching data.", endpoint: url, response_code: readResp.status });
        }
        await safeFetch(readUrl, { method: "DELETE", headers: defaultHeaders(this.authToken) }).catch(() => {});
      } else {
        this.add({ test_name: "create_read", status: "WARNING", severity: "MEDIUM", title: `Could not read back created resource (status ${readResp.status})`, description: "GET after POST did not return the created resource.", endpoint: readUrl, response_code: readResp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "create_read", status: "SKIPPED", severity: "INFO", title: "Create-read test error", description: e.message, endpoint: url });
    }
  }

  private async testDataTypeIntegrity() {
    const ep = this.getCrudEndpoint();
    if (!ep) { this.add({ test_name: "data_types", status: "SKIPPED", severity: "INFO", title: "Data type test skipped", description: "No endpoints.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, ep);
    const payload = { name: "QA_TYPE_TEST", count: 42, price: 19.99, active: true, notes: null };
    try {
      const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if ([200, 201].includes(resp.status)) {
        const data = await resp.json() as Record<string, any>;
        const issues: string[] = [];
        if ("count" in data && typeof data.count !== "number") issues.push(`count: expected number, got ${typeof data.count}`);
        if ("price" in data && typeof data.price !== "number") issues.push(`price: expected number, got ${typeof data.price}`);
        if ("active" in data && typeof data.active !== "boolean") issues.push(`active: expected boolean, got ${typeof data.active}`);
        if (issues.length > 0) {
          this.add({ test_name: "data_types", status: "FAILED", severity: "MEDIUM", title: "Data type integrity issues", description: `Type mismatches: ${issues.join(", ")}`, endpoint: url, response_code: resp.status });
        } else {
          this.add({ test_name: "data_types", status: "PASSED", severity: "INFO", title: "Data types preserved correctly", description: "All data types match expected types.", endpoint: url, response_code: resp.status });
        }
        const rid = data.id || data._id;
        if (rid) await safeFetch(`${url.replace(/\/+$/, "")}/${rid}`, { method: "DELETE", headers: defaultHeaders(this.authToken) }).catch(() => {});
      } else {
        this.add({ test_name: "data_types", status: "SKIPPED", severity: "INFO", title: "Data type test: POST failed", description: `Status ${resp.status}`, endpoint: url, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "data_types", status: "SKIPPED", severity: "INFO", title: "Data type test error", description: e.message, endpoint: url });
    }
  }

  private async testRequiredFieldValidation() {
    const ep = this.getCrudEndpoint();
    if (!ep) { this.add({ test_name: "required_fields", status: "SKIPPED", severity: "INFO", title: "Required field test skipped", description: "No endpoints.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, ep);
    try {
      const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: null, email: null }) });
      if ([400, 422].includes(resp.status)) {
        this.add({ test_name: "required_fields", status: "PASSED", severity: "INFO", title: "Required field validation works", description: `Server returned ${resp.status} for null required fields.`, endpoint: url, response_code: resp.status });
      } else if (resp.status === 500) {
        this.add({ test_name: "required_fields", status: "FAILED", severity: "HIGH", title: "Server error on null required fields", description: "Server crashed with 500 instead of returning validation error.", remediation: "Add null checks for required fields.", endpoint: url, response_code: 500 });
      } else {
        this.add({ test_name: "required_fields", status: "WARNING", severity: "MEDIUM", title: `Unexpected response (${resp.status}) for null fields`, description: "Expected 400/422 for null required fields.", endpoint: url, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "required_fields", status: "SKIPPED", severity: "INFO", title: "Required field test error", description: e.message, endpoint: url });
    }
  }

  private async testUpdatePropagation() {
    const ep = this.getCrudEndpoint();
    if (!ep) { this.add({ test_name: "update_propagation", status: "SKIPPED", severity: "INFO", title: "Update test skipped", description: "No endpoints.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, ep);
    try {
      const createResp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA_UPDATE_TEST", email: "update@blackridge.test" }) });
      if (![200, 201].includes(createResp.status)) { this.add({ test_name: "update_propagation", status: "SKIPPED", severity: "INFO", title: "Update test: create failed", description: `Status ${createResp.status}`, endpoint: url }); return; }
      const data = await createResp.json() as Record<string, any>;
      const rid = data.id || data._id;
      if (!rid) { this.add({ test_name: "update_propagation", status: "SKIPPED", severity: "INFO", title: "Update test: no ID", description: "No ID in response.", endpoint: url }); return; }
      const itemUrl = `${url.replace(/\/+$/, "")}/${rid}`;
      await safeFetch(itemUrl, { method: "PATCH", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA_UPDATE_VERIFIED" }) }).catch(() => {});
      const getResp = await safeFetch(itemUrl, { headers: defaultHeaders(this.authToken) });
      if (getResp.status === 200) {
        const updated = await getResp.json() as Record<string, any>;
        if (updated.name === "QA_UPDATE_VERIFIED") {
          this.add({ test_name: "update_propagation", status: "PASSED", severity: "INFO", title: "Update propagation verified", description: "PATCH + GET shows updated data.", endpoint: itemUrl, response_code: 200 });
        } else {
          this.add({ test_name: "update_propagation", status: "WARNING", severity: "MEDIUM", title: "Update may not have propagated", description: `Expected 'QA_UPDATE_VERIFIED', got '${updated.name}'`, endpoint: itemUrl, response_code: 200 });
        }
      }
      await safeFetch(itemUrl, { method: "DELETE", headers: defaultHeaders(this.authToken) }).catch(() => {});
    } catch (e: any) {
      this.add({ test_name: "update_propagation", status: "SKIPPED", severity: "INFO", title: "Update test error", description: e.message, endpoint: url });
    }
  }

  private async testDeleteVerification() {
    const ep = this.getCrudEndpoint();
    if (!ep) { this.add({ test_name: "delete_verify", status: "SKIPPED", severity: "INFO", title: "Delete test skipped", description: "No endpoints.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, ep);
    try {
      const createResp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA_DELETE_TEST", email: "delete@blackridge.test" }) });
      if (![200, 201].includes(createResp.status)) { this.add({ test_name: "delete_verify", status: "SKIPPED", severity: "INFO", title: "Delete test: create failed", description: "", endpoint: url }); return; }
      const data = await createResp.json() as Record<string, any>;
      const rid = data.id || data._id;
      if (!rid) { this.add({ test_name: "delete_verify", status: "SKIPPED", severity: "INFO", title: "Delete test: no ID", description: "", endpoint: url }); return; }
      const itemUrl = `${url.replace(/\/+$/, "")}/${rid}`;
      const delResp = await safeFetch(itemUrl, { method: "DELETE", headers: defaultHeaders(this.authToken) });
      if (![200, 204, 404].includes(delResp.status)) { this.add({ test_name: "delete_verify", status: "SKIPPED", severity: "INFO", title: "Delete test: delete failed", description: `Status ${delResp.status}`, endpoint: itemUrl }); return; }
      const getResp = await safeFetch(itemUrl, { headers: defaultHeaders(this.authToken) });
      if (getResp.status === 404) {
        this.add({ test_name: "delete_verify", status: "PASSED", severity: "INFO", title: "Delete verification passed", description: "Deleted resource returns 404.", endpoint: itemUrl, response_code: 404 });
      } else if (getResp.status === 200) {
        this.add({ test_name: "delete_verify", status: "FAILED", severity: "MEDIUM", title: "Deleted resource still accessible", description: "GET after DELETE still returns 200.", remediation: "Ensure DELETE fully removes the resource.", endpoint: itemUrl, response_code: 200 });
      }
    } catch (e: any) {
      this.add({ test_name: "delete_verify", status: "SKIPPED", severity: "INFO", title: "Delete test error", description: e.message, endpoint: url });
    }
  }

  private async testFinancialCalculation() {
    const calcEndpoints = this.knownEndpoints.filter(ep => /order|calc|invoice|payment|checkout/i.test(ep));
    if (calcEndpoints.length === 0) { this.add({ test_name: "financial_calc", status: "SKIPPED", severity: "INFO", title: "Financial calculation test skipped", description: "No order/calculation endpoints provided.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, calcEndpoints[0]);
    try {
      const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ items: [{ price: 29.99, quantity: 3 }], tax_rate: 0.08 }) });
      if ([200, 201].includes(resp.status)) {
        const data = await resp.json() as Record<string, any>;
        if ("subtotal" in data) {
          const actual = Math.round(parseFloat(data.subtotal) * 100) / 100;
          if (Math.abs(actual - 89.97) < 0.01) {
            this.add({ test_name: "financial_calc", status: "PASSED", severity: "INFO", title: "Financial calculations are accurate", description: `Subtotal: expected 89.97, got ${actual}`, endpoint: url, response_code: resp.status });
          } else {
            this.add({ test_name: "financial_calc", status: "FAILED", severity: "HIGH", title: "Financial calculation error", description: `Expected subtotal 89.97, got ${actual}`, remediation: "Verify all financial calculations use proper decimal arithmetic.", endpoint: url, response_code: resp.status });
          }
        } else {
          this.add({ test_name: "financial_calc", status: "SKIPPED", severity: "INFO", title: "No subtotal in response", description: "Cannot verify calculations.", endpoint: url, response_code: resp.status });
        }
      } else {
        this.add({ test_name: "financial_calc", status: "SKIPPED", severity: "INFO", title: "Financial test: endpoint rejected request", description: `Status ${resp.status}`, endpoint: url, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "financial_calc", status: "SKIPPED", severity: "INFO", title: "Financial test error", description: e.message, endpoint: url });
    }
  }

  private async testDataSanitization() {
    const ep = this.getCrudEndpoint();
    if (!ep) { this.add({ test_name: "sanitization", status: "SKIPPED", severity: "INFO", title: "Sanitization test skipped", description: "No endpoints.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, ep);
    const xssPayload = "<script>alert(1)</script>";
    try {
      const resp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: xssPayload, description: xssPayload }) });
      if ([200, 201].includes(resp.status)) {
        const body = await resp.text();
        if (body.includes(xssPayload)) {
          this.add({ test_name: "sanitization", status: "FAILED", severity: "HIGH", title: "Data not sanitized — XSS payload stored", description: "Script tags submitted as field values are returned unsanitized.", evidence: `Payload '${xssPayload}' found in response.`, remediation: "Sanitize all user input before storage and output.", endpoint: url, response_code: resp.status });
        } else {
          this.add({ test_name: "sanitization", status: "PASSED", severity: "INFO", title: "Data sanitization working", description: "Script tags were sanitized or escaped in the response.", endpoint: url, response_code: resp.status });
        }
        try { const d = JSON.parse(body); const rid = d.id || d._id; if (rid) await safeFetch(`${url.replace(/\/+$/, "")}/${rid}`, { method: "DELETE", headers: defaultHeaders(this.authToken) }).catch(() => {}); } catch {}
      } else {
        this.add({ test_name: "sanitization", status: "SKIPPED", severity: "INFO", title: "Sanitization test: POST rejected", description: `Status ${resp.status}`, endpoint: url, response_code: resp.status });
      }
    } catch (e: any) {
      this.add({ test_name: "sanitization", status: "SKIPPED", severity: "INFO", title: "Sanitization test error", description: e.message, endpoint: url });
    }
  }

  private async testTimestampFormat() {
    const isoPattern = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    const endpoints = this.knownEndpoints.length > 0 ? this.knownEndpoints.slice(0, 2) : ["/"];
    for (const ep of endpoints) {
      const url = joinUrl(this.targetUrl, ep);
      try {
        const resp = await safeFetch(url, { headers: defaultHeaders(this.authToken) });
        if (resp.status === 200) {
          const text = await resp.text();
          const tsFields = ["created_at", "updated_at", "createdAt", "updatedAt", "timestamp", "date"];
          const foundTs = tsFields.some(f => text.includes(f));
          if (foundTs) {
            if (isoPattern.test(text)) {
              this.add({ test_name: "timestamp_format", status: "PASSED", severity: "INFO", title: "Timestamps use ISO 8601 format", description: "Detected ISO 8601 formatted timestamps in responses.", endpoint: url, response_code: 200 });
            } else {
              this.add({ test_name: "timestamp_format", status: "WARNING", severity: "LOW", title: "Timestamps may not use ISO 8601", description: "Timestamp fields found but not in ISO 8601 format.", remediation: "Use ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ) for all timestamps.", endpoint: url, response_code: 200 });
            }
            return;
          }
        }
      } catch { continue; }
    }
    this.add({ test_name: "timestamp_format", status: "SKIPPED", severity: "INFO", title: "No timestamps found to validate", description: "No timestamp fields detected in responses.", endpoint: this.targetUrl });
  }

  private async testConcurrentWriteSafety() {
    const ep = this.getCrudEndpoint();
    if (!ep) { this.add({ test_name: "concurrent_writes", status: "SKIPPED", severity: "INFO", title: "Concurrent write test skipped", description: "No endpoints.", endpoint: this.targetUrl }); return; }
    const url = joinUrl(this.targetUrl, ep);
    try {
      const createResp = await safeFetch(url, { method: "POST", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: "QA_CONCURRENT_TEST", email: "concurrent@blackridge.test" }) });
      if (![200, 201].includes(createResp.status)) { this.add({ test_name: "concurrent_writes", status: "SKIPPED", severity: "INFO", title: "Concurrent test: create failed", description: "", endpoint: url }); return; }
      const data = await createResp.json() as Record<string, any>;
      const rid = data.id || data._id;
      if (!rid) { this.add({ test_name: "concurrent_writes", status: "SKIPPED", severity: "INFO", title: "Concurrent test: no ID", description: "", endpoint: url }); return; }
      const itemUrl = `${url.replace(/\/+$/, "")}/${rid}`;
      const promises = Array.from({ length: 5 }, (_, i) =>
        safeFetch(itemUrl, { method: "PATCH", headers: { ...defaultHeaders(this.authToken), "Content-Type": "application/json" }, body: JSON.stringify({ name: `CONCURRENT_${i}` }) }).then(r => r.status).catch(() => 0)
      );
      const results = await Promise.all(promises);
      const errors = results.filter(r => r >= 500);
      if (errors.length > 0) {
        this.add({ test_name: "concurrent_writes", status: "FAILED", severity: "HIGH", title: `Server errors during concurrent writes (${errors.length}/5)`, description: `Status codes: ${JSON.stringify(results)}`, remediation: "Add proper locking or conflict resolution for concurrent writes.", endpoint: itemUrl });
      } else {
        this.add({ test_name: "concurrent_writes", status: "PASSED", severity: "INFO", title: "Concurrent writes handled safely", description: `All 5 concurrent PATCH requests completed without 500 errors. Status codes: ${JSON.stringify(results)}`, endpoint: itemUrl });
      }
      await safeFetch(itemUrl, { method: "DELETE", headers: defaultHeaders(this.authToken) }).catch(() => {});
    } catch (e: any) {
      this.add({ test_name: "concurrent_writes", status: "SKIPPED", severity: "INFO", title: "Concurrent test error", description: e.message, endpoint: url });
    }
  }
}
