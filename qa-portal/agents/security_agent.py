import requests
import time
import re
from urllib.parse import urlparse, urlencode, urljoin


class SecurityAgent:
    def __init__(self, target_url, auth_token=None, known_endpoints=None):
        self.target_url = target_url.rstrip("/")
        self.auth_token = auth_token
        self.known_endpoints = known_endpoints or []
        self.findings = []
        self.session = requests.Session()
        if auth_token:
            self.session.headers["Authorization"] = f"Bearer {auth_token}"
        self.session.headers["User-Agent"] = "BlackRidge-QA-Agent/1.0"

    def _add_finding(self, test_name, status, severity, title, description, evidence=None, remediation=None, endpoint=None, response_code=None, response_time_ms=None):
        self.findings.append({
            "agent": "Security",
            "test_name": test_name,
            "status": status,
            "severity": severity,
            "title": title,
            "description": description,
            "evidence": evidence,
            "remediation": remediation,
            "endpoint": endpoint,
            "response_code": response_code,
            "response_time_ms": response_time_ms,
        })

    def run(self):
        tests = [
            self.test_security_headers,
            self.test_https_enforcement,
            self.test_sql_injection,
            self.test_xss,
            self.test_auth_bypass,
            self.test_sensitive_data_exposure,
            self.test_dangerous_http_methods,
            self.test_rate_limiting,
            self.test_cors_misconfiguration,
        ]
        for test in tests:
            try:
                test()
            except Exception as e:
                self._add_finding(test.__name__, "SKIPPED", "INFO", f"Test skipped: {test.__name__}", f"Exception during test: {str(e)}")
        return self.findings

    def test_security_headers(self):
        start = time.time()
        try:
            resp = self.session.get(self.target_url, timeout=10, allow_redirects=True)
            elapsed = (time.time() - start) * 1000
        except Exception as e:
            self._add_finding("security_headers", "SKIPPED", "INFO", "Could not check security headers", f"Connection failed: {str(e)}", endpoint=self.target_url)
            return

        required_headers = {
            "X-Frame-Options": "Prevents clickjacking attacks",
            "X-Content-Type-Options": "Prevents MIME-type sniffing",
            "Strict-Transport-Security": "Enforces HTTPS connections",
            "Content-Security-Policy": "Controls resource loading to prevent XSS",
            "X-XSS-Protection": "Legacy XSS protection header",
        }
        missing = []
        present = []
        for header, desc in required_headers.items():
            if header.lower() in {k.lower(): v for k, v in resp.headers.items()}:
                present.append(header)
            else:
                missing.append(header)

        if missing:
            self._add_finding("security_headers", "FAILED", "HIGH",
                f"Missing {len(missing)} security header(s)",
                f"The following security headers are missing: {', '.join(missing)}",
                evidence=f"Headers checked: {list(required_headers.keys())}\nPresent: {present}\nMissing: {missing}",
                remediation=f"Add the following headers to all responses: {', '.join(missing)}",
                endpoint=self.target_url, response_code=resp.status_code, response_time_ms=elapsed)
        else:
            self._add_finding("security_headers", "PASSED", "INFO",
                "All security headers present",
                "All required security headers are properly configured.",
                endpoint=self.target_url, response_code=resp.status_code, response_time_ms=elapsed)

    def test_https_enforcement(self):
        parsed = urlparse(self.target_url)
        if parsed.scheme == "http":
            self._add_finding("https_enforcement", "FAILED", "HIGH",
                "Target URL uses HTTP instead of HTTPS",
                "The target URL does not use HTTPS encryption. All data is transmitted in plaintext.",
                remediation="Configure the server to use HTTPS with a valid SSL certificate.",
                endpoint=self.target_url)
            return

        http_url = self.target_url.replace("https://", "http://", 1)
        try:
            resp = self.session.get(http_url, timeout=10, allow_redirects=False)
            if resp.status_code in (301, 302, 307, 308):
                location = resp.headers.get("Location", "")
                if location.startswith("https://"):
                    self._add_finding("https_enforcement", "PASSED", "INFO",
                        "HTTP properly redirects to HTTPS",
                        f"HTTP requests are redirected to HTTPS (status {resp.status_code}).",
                        endpoint=http_url, response_code=resp.status_code)
                else:
                    self._add_finding("https_enforcement", "FAILED", "HIGH",
                        "HTTP does not redirect to HTTPS",
                        f"HTTP redirects to {location} instead of HTTPS.",
                        remediation="Configure redirect to HTTPS.",
                        endpoint=http_url, response_code=resp.status_code)
            else:
                self._add_finding("https_enforcement", "WARNING", "MEDIUM",
                    "HTTP endpoint responds without redirect",
                    f"The HTTP endpoint returned status {resp.status_code} without redirecting to HTTPS.",
                    remediation="Add an HTTP to HTTPS redirect.",
                    endpoint=http_url, response_code=resp.status_code)
        except Exception:
            self._add_finding("https_enforcement", "PASSED", "INFO",
                "HTTP port not accessible",
                "The HTTP version of the site is not reachable, which is acceptable if HTTPS is enforced.",
                endpoint=http_url)

    def test_sql_injection(self):
        payloads = ["' OR '1'='1", "; DROP TABLE users;--", "1 OR 1=1"]
        sql_error_patterns = re.compile(r"syntax error|mysql|ORA-|pg_|sqlite3|SQL|unclosed quotation", re.IGNORECASE)

        endpoints = self.known_endpoints or ["/api/users", "/api/search"]
        tested = False
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            for payload in payloads:
                try:
                    resp = self.session.get(url, params={"q": payload, "id": payload, "search": payload}, timeout=10)
                    tested = True
                    if sql_error_patterns.search(resp.text):
                        self._add_finding("sql_injection", "FAILED", "CRITICAL",
                            f"Possible SQL injection at {ep}",
                            f"SQL error keywords detected in response when injecting: {payload}",
                            evidence=resp.text[:500],
                            remediation="Use parameterized queries. Never concatenate user input into SQL.",
                            endpoint=url, response_code=resp.status_code)
                        return
                except Exception:
                    continue

        if tested:
            self._add_finding("sql_injection", "PASSED", "INFO",
                "No SQL injection vulnerabilities detected",
                "Tested known endpoints with common SQL injection payloads. No SQL error patterns found in responses.",
                endpoint=self.target_url)
        else:
            self._add_finding("sql_injection", "SKIPPED", "INFO",
                "SQL injection test skipped",
                "Could not reach any endpoints to test.",
                endpoint=self.target_url)

    def test_xss(self):
        payloads = ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>']
        endpoints = self.known_endpoints or ["/api/search", "/"]
        tested = False
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            for payload in payloads:
                try:
                    resp = self.session.get(url, params={"q": payload, "search": payload}, timeout=10)
                    tested = True
                    if payload in resp.text:
                        self._add_finding("xss", "FAILED", "HIGH",
                            f"Reflected XSS vulnerability at {ep}",
                            f"Injected payload was reflected unescaped in the response body.",
                            evidence=f"Payload: {payload}\nFound in response body (first 500 chars): {resp.text[:500]}",
                            remediation="Sanitize and encode all user input before reflecting in responses.",
                            endpoint=url, response_code=resp.status_code)
                        return
                except Exception:
                    continue

        if tested:
            self._add_finding("xss", "PASSED", "INFO",
                "No XSS vulnerabilities detected",
                "Tested endpoints with XSS payloads. No reflected payloads found.",
                endpoint=self.target_url)
        else:
            self._add_finding("xss", "SKIPPED", "INFO", "XSS test skipped", "No reachable endpoints.", endpoint=self.target_url)

    def test_auth_bypass(self):
        protected_paths = ["/api/users", "/api/admin", "/api/dashboard", "/api/profile"]
        no_auth_session = requests.Session()
        no_auth_session.headers["User-Agent"] = "BlackRidge-QA-Agent/1.0"

        bypassed = []
        for path in protected_paths:
            url = urljoin(self.target_url + "/", path.lstrip("/"))
            try:
                resp = no_auth_session.get(url, timeout=10)
                if resp.status_code == 200:
                    bypassed.append((path, resp.status_code))
            except Exception:
                continue

        if bypassed:
            self._add_finding("auth_bypass", "FAILED", "HIGH",
                f"Authentication bypass on {len(bypassed)} endpoint(s)",
                f"The following endpoints returned 200 without authentication: {[b[0] for b in bypassed]}",
                evidence=str(bypassed),
                remediation="Implement authentication middleware on all protected endpoints.",
                endpoint=self.target_url)
        else:
            self._add_finding("auth_bypass", "PASSED", "INFO",
                "No authentication bypass detected",
                "All tested protected endpoints properly reject unauthenticated requests.",
                endpoint=self.target_url)

    def test_sensitive_data_exposure(self):
        patterns = {
            "API Key": re.compile(r'(sk[-_]|AKIA[A-Z0-9]{16})', re.IGNORECASE),
            "Password field": re.compile(r'"password"\s*:\s*"[^"]+"|"secret"\s*:\s*"[^"]+"', re.IGNORECASE),
            "Private Key": re.compile(r'-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----'),
        }
        endpoints = self.known_endpoints or ["/"]
        for ep in endpoints[:5]:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.get(url, timeout=10)
                for name, pattern in patterns.items():
                    if pattern.search(resp.text):
                        self._add_finding("sensitive_data_exposure", "FAILED", "CRITICAL",
                            f"Sensitive data exposed: {name} at {ep}",
                            f"Response body contains potentially sensitive data matching pattern for: {name}",
                            evidence=f"Pattern matched in response from {url}",
                            remediation="Remove sensitive data from API responses. Use environment variables for secrets.",
                            endpoint=url, response_code=resp.status_code)
                        return
            except Exception:
                continue

        self._add_finding("sensitive_data_exposure", "PASSED", "INFO",
            "No sensitive data exposure detected",
            "Scanned responses for API keys, passwords, and private keys. None found.",
            endpoint=self.target_url)

    def test_dangerous_http_methods(self):
        try:
            resp = self.session.options(self.target_url, timeout=10)
            allow = resp.headers.get("Allow", "")
            dangerous = [m for m in ["TRACE", "TRACK"] if m in allow.upper()]
            if dangerous:
                self._add_finding("dangerous_methods", "FAILED", "MEDIUM",
                    f"Dangerous HTTP methods enabled: {', '.join(dangerous)}",
                    f"The server allows {', '.join(dangerous)} methods which can be exploited for XST attacks.",
                    evidence=f"Allow header: {allow}",
                    remediation="Disable TRACE and TRACK methods on the server.",
                    endpoint=self.target_url, response_code=resp.status_code)
            else:
                self._add_finding("dangerous_methods", "PASSED", "INFO",
                    "No dangerous HTTP methods enabled",
                    "TRACE and TRACK methods are not listed in the Allow header.",
                    endpoint=self.target_url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("dangerous_methods", "SKIPPED", "INFO",
                "Could not check HTTP methods", f"OPTIONS request failed: {str(e)}", endpoint=self.target_url)

    def test_rate_limiting(self):
        login_paths = ["/api/auth/login", "/api/login"]
        for path in login_paths:
            url = urljoin(self.target_url + "/", path.lstrip("/"))
            try:
                responses = []
                for _ in range(15):
                    resp = self.session.post(url, json={"email": "test@test.com", "password": "test"}, timeout=10)
                    responses.append(resp.status_code)
                if 429 not in responses:
                    self._add_finding("rate_limiting", "FAILED", "HIGH",
                        f"No rate limiting on {path}",
                        f"Sent 15 rapid requests to {path}. None returned 429 Too Many Requests.",
                        evidence=f"Status codes received: {responses}",
                        remediation="Implement rate limiting on authentication endpoints (e.g., 5 attempts per minute).",
                        endpoint=url)
                else:
                    self._add_finding("rate_limiting", "PASSED", "INFO",
                        f"Rate limiting active on {path}",
                        f"Rate limiting is in effect. Received 429 after rapid requests.",
                        endpoint=url)
                return
            except Exception:
                continue

        self._add_finding("rate_limiting", "SKIPPED", "INFO",
            "No login endpoint found for rate limiting test",
            "Could not find /api/auth/login or /api/login.",
            endpoint=self.target_url)

    def test_cors_misconfiguration(self):
        evil_origin = "https://evil.blackridge-qa-test.com"
        try:
            resp = self.session.get(self.target_url, headers={"Origin": evil_origin}, timeout=10)
            acao = resp.headers.get("Access-Control-Allow-Origin", "")
            acac = resp.headers.get("Access-Control-Allow-Credentials", "").lower()

            if acao == evil_origin:
                self._add_finding("cors", "FAILED", "CRITICAL",
                    "CORS reflects arbitrary origins",
                    f"The server reflects back the evil origin '{evil_origin}' in Access-Control-Allow-Origin.",
                    evidence=f"Access-Control-Allow-Origin: {acao}",
                    remediation="Configure CORS to only allow trusted origins.",
                    endpoint=self.target_url, response_code=resp.status_code)
            elif acao == "*" and acac == "true":
                self._add_finding("cors", "FAILED", "CRITICAL",
                    "CORS wildcard with credentials",
                    "Access-Control-Allow-Origin is '*' while Allow-Credentials is 'true'. This is a dangerous combination.",
                    remediation="Do not use wildcard origin with credentials.",
                    endpoint=self.target_url, response_code=resp.status_code)
            else:
                self._add_finding("cors", "PASSED", "INFO",
                    "CORS configuration is acceptable",
                    f"CORS does not reflect arbitrary origins. ACAO: '{acao}'",
                    endpoint=self.target_url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("cors", "SKIPPED", "INFO",
                "Could not check CORS", f"Request failed: {str(e)}", endpoint=self.target_url)
