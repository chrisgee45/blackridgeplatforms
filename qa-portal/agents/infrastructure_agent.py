import requests
import ssl
import socket
import time
import concurrent.futures
from urllib.parse import urlparse, urljoin


class InfrastructureAgent:
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
            "agent": "Infrastructure",
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
            self.test_reachability,
            self.test_response_time,
            self.test_ssl_certificate,
            self.test_cors_headers,
            self.test_error_handling,
            self.test_large_payload,
            self.test_concurrent_load,
            self.test_health_endpoint,
            self.test_http_to_https_redirect,
        ]
        for test in tests:
            try:
                test()
            except Exception as e:
                self._add_finding(test.__name__, "SKIPPED", "INFO", f"Test skipped: {test.__name__}", f"Exception: {str(e)}")
        return self.findings

    def test_reachability(self):
        start = time.time()
        try:
            resp = self.session.get(self.target_url, timeout=10)
            elapsed = (time.time() - start) * 1000
            self._add_finding("reachability", "PASSED", "INFO",
                "API is reachable",
                f"Successfully connected to {self.target_url}. Status: {resp.status_code}",
                endpoint=self.target_url, response_code=resp.status_code, response_time_ms=elapsed)
        except requests.ConnectionError:
            self._add_finding("reachability", "FAILED", "CRITICAL",
                "API is unreachable",
                f"Connection refused or DNS resolution failed for {self.target_url}.",
                remediation="Verify the server is running and the URL is correct.",
                endpoint=self.target_url)
        except requests.Timeout:
            self._add_finding("reachability", "FAILED", "CRITICAL",
                "API connection timed out",
                f"Connection to {self.target_url} timed out after 10 seconds.",
                remediation="Check server health and network connectivity.",
                endpoint=self.target_url)

    def test_response_time(self):
        start = time.time()
        try:
            resp = self.session.get(self.target_url, timeout=15)
            elapsed = (time.time() - start) * 1000

            if elapsed > 5000:
                self._add_finding("response_time", "FAILED", "HIGH",
                    f"Very slow response: {elapsed:.0f}ms",
                    f"Response time of {elapsed:.0f}ms exceeds 5000ms threshold.",
                    remediation="Optimize server performance, add caching, or check for blocking operations.",
                    endpoint=self.target_url, response_code=resp.status_code, response_time_ms=elapsed)
            elif elapsed > 2000:
                self._add_finding("response_time", "WARNING", "MEDIUM",
                    f"Slow response: {elapsed:.0f}ms",
                    f"Response time of {elapsed:.0f}ms exceeds 2000ms warning threshold.",
                    remediation="Consider performance optimization.",
                    endpoint=self.target_url, response_code=resp.status_code, response_time_ms=elapsed)
            else:
                self._add_finding("response_time", "PASSED", "INFO",
                    f"Good response time: {elapsed:.0f}ms",
                    f"Response time of {elapsed:.0f}ms is within acceptable limits.",
                    endpoint=self.target_url, response_code=resp.status_code, response_time_ms=elapsed)
        except Exception as e:
            self._add_finding("response_time", "SKIPPED", "INFO", "Response time test skipped", str(e), endpoint=self.target_url)

    def test_ssl_certificate(self):
        parsed = urlparse(self.target_url)
        if parsed.scheme != "https":
            self._add_finding("ssl_certificate", "SKIPPED", "INFO",
                "SSL test skipped (not HTTPS)",
                "Target URL uses HTTP. SSL certificate check requires HTTPS.",
                endpoint=self.target_url)
            return

        hostname = parsed.hostname
        port = parsed.port or 443
        try:
            ctx = ssl.create_default_context()
            with socket.create_connection((hostname, port), timeout=10) as sock:
                with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                    cert = ssock.getpeercert()
                    not_after = ssl.cert_time_to_seconds(cert["notAfter"])
                    remaining_days = (not_after - time.time()) / 86400

                    if remaining_days < 0:
                        self._add_finding("ssl_certificate", "FAILED", "CRITICAL",
                            "SSL certificate has expired",
                            f"The certificate expired {abs(remaining_days):.0f} days ago.",
                            remediation="Renew the SSL certificate immediately.",
                            endpoint=self.target_url)
                    elif remaining_days < 30:
                        self._add_finding("ssl_certificate", "WARNING", "MEDIUM",
                            f"SSL certificate expires in {remaining_days:.0f} days",
                            f"Certificate expires on {cert['notAfter']}.",
                            remediation="Renew the SSL certificate before expiry.",
                            endpoint=self.target_url)
                    else:
                        self._add_finding("ssl_certificate", "PASSED", "INFO",
                            f"SSL certificate valid ({remaining_days:.0f} days remaining)",
                            f"Certificate is valid until {cert['notAfter']}.",
                            endpoint=self.target_url)
        except ssl.SSLError as e:
            self._add_finding("ssl_certificate", "FAILED", "CRITICAL",
                "SSL certificate validation failed",
                f"SSL error: {str(e)}",
                remediation="Ensure a valid, trusted SSL certificate is installed.",
                endpoint=self.target_url)
        except Exception as e:
            self._add_finding("ssl_certificate", "SKIPPED", "INFO",
                "SSL check failed", f"Error: {str(e)}", endpoint=self.target_url)

    def test_cors_headers(self):
        try:
            resp = self.session.get(self.target_url, timeout=10)
            acao = resp.headers.get("Access-Control-Allow-Origin")
            if acao:
                self._add_finding("cors_headers", "PASSED", "INFO",
                    "CORS headers present",
                    f"Access-Control-Allow-Origin: {acao}",
                    endpoint=self.target_url, response_code=resp.status_code)
            else:
                self._add_finding("cors_headers", "WARNING", "LOW",
                    "No CORS headers detected",
                    "No Access-Control-Allow-Origin header found. This may block cross-origin requests.",
                    remediation="Add appropriate CORS headers if cross-origin access is needed.",
                    endpoint=self.target_url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("cors_headers", "SKIPPED", "INFO", "CORS check skipped", str(e), endpoint=self.target_url)

    def test_error_handling(self):
        url = urljoin(self.target_url + "/", "api/this-does-not-exist-qa-test")
        try:
            resp = self.session.get(url, timeout=10)
            elapsed_ms = resp.elapsed.total_seconds() * 1000

            if resp.status_code == 404:
                stack_patterns = ["Traceback", "at Object.", "node_modules", "Error:", "at Function.", "at Module."]
                has_stack = any(p in resp.text for p in stack_patterns)
                if has_stack:
                    self._add_finding("error_handling", "FAILED", "MEDIUM",
                        "Error response contains stack trace",
                        "404 response includes internal stack trace information.",
                        evidence=resp.text[:500],
                        remediation="Customize error responses to hide internal details.",
                        endpoint=url, response_code=404, response_time_ms=elapsed_ms)
                else:
                    self._add_finding("error_handling", "PASSED", "INFO",
                        "Proper 404 error handling",
                        "Non-existent endpoint returns 404 without exposing internals.",
                        endpoint=url, response_code=404, response_time_ms=elapsed_ms)
            elif resp.status_code == 500:
                self._add_finding("error_handling", "FAILED", "HIGH",
                    "Server error on unknown endpoint",
                    f"Non-existent endpoint returned 500 instead of 404.",
                    remediation="Add catch-all route that returns 404 for unknown endpoints.",
                    endpoint=url, response_code=500, response_time_ms=elapsed_ms)
            elif resp.status_code == 200:
                self._add_finding("error_handling", "WARNING", "MEDIUM",
                    "Non-existent endpoint returns 200",
                    "A non-existent endpoint returned 200 OK. This may indicate a wildcard route.",
                    remediation="Ensure unknown endpoints return 404.",
                    endpoint=url, response_code=200, response_time_ms=elapsed_ms)
            else:
                self._add_finding("error_handling", "PASSED", "INFO",
                    f"Error handling returns {resp.status_code}",
                    f"Non-existent endpoint returned status {resp.status_code}.",
                    endpoint=url, response_code=resp.status_code, response_time_ms=elapsed_ms)
        except Exception as e:
            self._add_finding("error_handling", "SKIPPED", "INFO", "Error handling test skipped", str(e), endpoint=url)

    def test_large_payload(self):
        large_body = "x" * (10 * 1024 * 1024)
        endpoints = self.known_endpoints[:1] if self.known_endpoints else ["/api/test-large-payload"]
        url = urljoin(self.target_url + "/", endpoints[0].lstrip("/"))
        try:
            resp = self.session.post(url, data=large_body, timeout=15, headers={"Content-Type": "application/octet-stream"})
            if resp.status_code in (413, 400):
                self._add_finding("large_payload", "PASSED", "INFO",
                    "Server correctly rejects large payloads",
                    f"Server returned {resp.status_code} for 10MB payload.",
                    endpoint=url, response_code=resp.status_code)
            elif resp.status_code == 500:
                self._add_finding("large_payload", "FAILED", "MEDIUM",
                    "Server crashes on large payload",
                    "Server returned 500 Internal Server Error when sent a 10MB payload.",
                    remediation="Set a request body size limit (e.g., 1MB).",
                    endpoint=url, response_code=500)
            else:
                self._add_finding("large_payload", "WARNING", "LOW",
                    f"Large payload returned {resp.status_code}",
                    f"Server accepted a 10MB payload with status {resp.status_code}.",
                    remediation="Consider adding request body size limits.",
                    endpoint=url, response_code=resp.status_code)
        except requests.Timeout:
            self._add_finding("large_payload", "WARNING", "LOW",
                "Large payload test timed out",
                "Request with 10MB body timed out.",
                endpoint=url)
        except Exception as e:
            self._add_finding("large_payload", "SKIPPED", "INFO", "Large payload test skipped", str(e), endpoint=url)

    def test_concurrent_load(self):
        def make_request():
            try:
                resp = requests.get(self.target_url, timeout=10, headers={"User-Agent": "BlackRidge-QA-Agent/1.0"})
                return resp.status_code
            except Exception:
                return 0

        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(make_request) for _ in range(10)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        server_errors = [r for r in results if r >= 500]
        failures = [r for r in results if r == 0]

        if server_errors:
            self._add_finding("concurrent_load", "FAILED", "HIGH",
                f"Server errors under concurrent load ({len(server_errors)}/10 requests)",
                f"Status codes: {results}",
                remediation="Investigate server capacity and connection pooling.",
                endpoint=self.target_url)
        elif failures:
            self._add_finding("concurrent_load", "WARNING", "MEDIUM",
                f"Some concurrent requests failed ({len(failures)}/10)",
                f"Results: {results}",
                endpoint=self.target_url)
        else:
            self._add_finding("concurrent_load", "PASSED", "INFO",
                "Server handles concurrent load",
                f"All 10 concurrent requests succeeded. Status codes: {results}",
                endpoint=self.target_url)

    def test_health_endpoint(self):
        health_paths = ["/health", "/api/health", "/ping", "/healthz"]
        for path in health_paths:
            url = urljoin(self.target_url + "/", path.lstrip("/"))
            try:
                resp = self.session.get(url, timeout=10)
                if resp.status_code == 200:
                    self._add_finding("health_endpoint", "PASSED", "INFO",
                        f"Health endpoint found at {path}",
                        f"Health endpoint returns 200 OK.",
                        endpoint=url, response_code=200)
                    return
            except Exception:
                continue

        self._add_finding("health_endpoint", "WARNING", "LOW",
            "No health check endpoint found",
            f"Checked: {', '.join(health_paths)}. None returned 200.",
            remediation="Add a /health endpoint that returns 200 when the service is healthy.",
            endpoint=self.target_url)

    def test_http_to_https_redirect(self):
        parsed = urlparse(self.target_url)
        if parsed.scheme != "https":
            self._add_finding("http_redirect", "SKIPPED", "INFO",
                "HTTP redirect test skipped", "Target is not HTTPS.", endpoint=self.target_url)
            return

        http_url = self.target_url.replace("https://", "http://", 1)
        try:
            resp = requests.get(http_url, timeout=10, allow_redirects=False, headers={"User-Agent": "BlackRidge-QA-Agent/1.0"})
            if resp.status_code in (301, 302, 307, 308):
                location = resp.headers.get("Location", "")
                if "https://" in location:
                    self._add_finding("http_redirect", "PASSED", "INFO",
                        "HTTP to HTTPS redirect configured",
                        f"HTTP redirects to HTTPS with status {resp.status_code}.",
                        endpoint=http_url, response_code=resp.status_code)
                else:
                    self._add_finding("http_redirect", "WARNING", "MEDIUM",
                        "HTTP redirect does not point to HTTPS",
                        f"Redirect location: {location}",
                        endpoint=http_url, response_code=resp.status_code)
            else:
                self._add_finding("http_redirect", "WARNING", "MEDIUM",
                    f"No HTTP to HTTPS redirect (status {resp.status_code})",
                    "HTTP requests are served without redirecting to HTTPS.",
                    remediation="Add a redirect from HTTP to HTTPS.",
                    endpoint=http_url, response_code=resp.status_code)
        except Exception:
            self._add_finding("http_redirect", "PASSED", "INFO",
                "HTTP port not accessible",
                "HTTP version is not reachable, which is acceptable if HTTPS is enforced.",
                endpoint=http_url)
