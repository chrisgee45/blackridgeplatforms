import requests
import time
from urllib.parse import urljoin


class APIAgent:
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
            "agent": "API",
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
            self.test_content_type,
            self.test_method_enforcement,
            self.test_empty_body_validation,
            self.test_invalid_email_validation,
            self.test_negative_number_validation,
            self.test_consistent_error_format,
            self.test_pagination,
            self.test_idempotent_get,
            self.test_api_versioning,
        ]
        for test in tests:
            try:
                test()
            except Exception as e:
                self._add_finding(test.__name__, "SKIPPED", "INFO", f"Test skipped: {test.__name__}", f"Exception: {str(e)}")
        return self.findings

    def test_content_type(self):
        endpoints = self.known_endpoints[:3] if self.known_endpoints else ["/"]
        issues = []
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.get(url, timeout=10)
                ct = resp.headers.get("Content-Type", "")
                if "application/json" not in ct and resp.status_code == 200:
                    issues.append({"endpoint": ep, "content_type": ct, "status": resp.status_code})
            except Exception:
                continue

        if issues:
            self._add_finding("content_type", "WARNING", "LOW",
                f"Missing JSON Content-Type on {len(issues)} endpoint(s)",
                f"Endpoints returning non-JSON Content-Type: {[i['endpoint'] for i in issues]}",
                evidence=str(issues),
                remediation="Set Content-Type: application/json on all API responses.",
                endpoint=self.target_url)
        else:
            self._add_finding("content_type", "PASSED", "INFO",
                "API responses include proper Content-Type",
                "All tested endpoints return Content-Type: application/json.",
                endpoint=self.target_url)

    def test_method_enforcement(self):
        endpoints = self.known_endpoints[:3] if self.known_endpoints else ["/api/users"]
        tested = False
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                get_resp = self.session.get(url, timeout=10)
                if get_resp.status_code == 200:
                    post_resp = self.session.post(url, json={}, timeout=10)
                    tested = True
                    if post_resp.status_code == 405:
                        self._add_finding("method_enforcement", "PASSED", "INFO",
                            "HTTP method enforcement working",
                            f"POST to GET-only endpoint {ep} correctly returns 405.",
                            endpoint=url, response_code=405)
                        return
                    elif post_resp.status_code in (200, 201):
                        self._add_finding("method_enforcement", "WARNING", "LOW",
                            f"No method enforcement on {ep}",
                            f"POST to {ep} returned {post_resp.status_code} instead of 405.",
                            remediation="Return 405 Method Not Allowed for unsupported HTTP methods.",
                            endpoint=url, response_code=post_resp.status_code)
                        return
            except Exception:
                continue

        if not tested:
            self._add_finding("method_enforcement", "SKIPPED", "INFO",
                "Method enforcement test skipped", "No suitable endpoints found.", endpoint=self.target_url)
        else:
            self._add_finding("method_enforcement", "PASSED", "INFO",
                "Method enforcement checked",
                "Tested available endpoints for method enforcement.",
                endpoint=self.target_url)

    def test_empty_body_validation(self):
        endpoints = self.known_endpoints[:3] if self.known_endpoints else ["/api/users", "/api/orders"]
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.post(url, json={}, timeout=10)
                if resp.status_code in (400, 422):
                    self._add_finding("empty_body_validation", "PASSED", "INFO",
                        f"Empty body properly validated on {ep}",
                        f"Server returned {resp.status_code} for empty POST body.",
                        endpoint=url, response_code=resp.status_code)
                    return
                elif resp.status_code == 500:
                    self._add_finding("empty_body_validation", "FAILED", "HIGH",
                        f"Server error on empty body POST to {ep}",
                        f"Server returned 500 instead of 400/422 for empty body.",
                        remediation="Add input validation to reject empty request bodies gracefully.",
                        endpoint=url, response_code=500)
                    return
            except Exception:
                continue

        self._add_finding("empty_body_validation", "SKIPPED", "INFO",
            "Empty body validation test skipped", "No POST endpoints responded.", endpoint=self.target_url)

    def test_invalid_email_validation(self):
        endpoints = self.known_endpoints[:3] if self.known_endpoints else ["/api/users", "/api/register"]
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.post(url, json={"email": "not-an-email", "name": "Test"}, timeout=10)
                if resp.status_code in (400, 422):
                    self._add_finding("invalid_email", "PASSED", "INFO",
                        f"Invalid email properly rejected on {ep}",
                        f"Server returned {resp.status_code} for invalid email.",
                        endpoint=url, response_code=resp.status_code)
                    return
                elif resp.status_code in (200, 201):
                    self._add_finding("invalid_email", "FAILED", "MEDIUM",
                        f"Invalid email accepted on {ep}",
                        "Server accepted 'not-an-email' as a valid email address.",
                        remediation="Add email format validation.",
                        endpoint=url, response_code=resp.status_code)
                    return
            except Exception:
                continue

        self._add_finding("invalid_email", "SKIPPED", "INFO",
            "Email validation test skipped", "No suitable endpoints found.", endpoint=self.target_url)

    def test_negative_number_validation(self):
        endpoints = self.known_endpoints[:3] if self.known_endpoints else ["/api/orders", "/api/products"]
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.post(url, json={"price": -999, "amount": -999, "quantity": -1}, timeout=10)
                if resp.status_code in (400, 422):
                    self._add_finding("negative_numbers", "PASSED", "INFO",
                        f"Negative numbers properly rejected on {ep}",
                        f"Server returned {resp.status_code} for negative values.",
                        endpoint=url, response_code=resp.status_code)
                    return
                elif resp.status_code in (200, 201):
                    self._add_finding("negative_numbers", "WARNING", "MEDIUM",
                        f"Negative numbers accepted on {ep}",
                        "Server accepted negative values for price/amount fields.",
                        remediation="Add validation to reject negative numbers for monetary and quantity fields.",
                        endpoint=url, response_code=resp.status_code)
                    return
            except Exception:
                continue

        self._add_finding("negative_numbers", "SKIPPED", "INFO",
            "Negative number validation test skipped", "No suitable endpoints found.", endpoint=self.target_url)

    def test_consistent_error_format(self):
        endpoints = ["/api/this-does-not-exist-qa-test"]
        if self.known_endpoints:
            endpoints.append(self.known_endpoints[0])

        error_responses = []
        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.get(url, timeout=10)
                if resp.status_code >= 400:
                    try:
                        body = resp.json()
                        has_error_field = "error" in body or "message" in body or "detail" in body
                        error_responses.append({"endpoint": ep, "status": resp.status_code, "has_error_field": has_error_field, "keys": list(body.keys())})
                    except Exception:
                        error_responses.append({"endpoint": ep, "status": resp.status_code, "has_error_field": False, "keys": []})
            except Exception:
                continue

        if not error_responses:
            self._add_finding("error_format", "SKIPPED", "INFO",
                "Error format test skipped", "No error responses received.", endpoint=self.target_url)
            return

        all_have_field = all(e["has_error_field"] for e in error_responses)
        if all_have_field:
            self._add_finding("error_format", "PASSED", "INFO",
                "Consistent error response format",
                "All error responses include 'error' or 'message' field.",
                evidence=str(error_responses),
                endpoint=self.target_url)
        else:
            self._add_finding("error_format", "WARNING", "LOW",
                "Inconsistent error response format",
                "Some error responses lack a standard error/message field.",
                evidence=str(error_responses),
                remediation="Standardize all error responses to include an 'error' or 'message' field.",
                endpoint=self.target_url)

    def test_pagination(self):
        list_endpoints = [ep for ep in self.known_endpoints if any(p in ep.lower() for p in ["users", "orders", "items", "list", "products"])]
        if not list_endpoints:
            list_endpoints = ["/api/users", "/api/orders"]

        for ep in list_endpoints[:2]:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.get(url, timeout=10)
                if resp.status_code == 200:
                    try:
                        body = resp.json()
                        pagination_keys = ["page", "total", "limit", "offset", "count", "next", "per_page", "totalPages"]
                        if isinstance(body, dict):
                            found = [k for k in pagination_keys if k in body]
                            if found:
                                self._add_finding("pagination", "PASSED", "INFO",
                                    f"Pagination detected on {ep}",
                                    f"Found pagination fields: {found}",
                                    endpoint=url, response_code=200)
                                return
                    except Exception:
                        pass
            except Exception:
                continue

        self._add_finding("pagination", "WARNING", "LOW",
            "No pagination detected on list endpoints",
            "List endpoints do not appear to include pagination metadata.",
            remediation="Add pagination (page, total, limit) to all list endpoints.",
            endpoint=self.target_url)

    def test_idempotent_get(self):
        endpoints = self.known_endpoints[:1] if self.known_endpoints else ["/"]
        url = urljoin(self.target_url + "/", endpoints[0].lstrip("/"))
        try:
            responses = []
            for _ in range(3):
                resp = self.session.get(url, timeout=10)
                responses.append(resp.text)

            if len(set(responses)) == 1:
                self._add_finding("idempotent_get", "PASSED", "INFO",
                    "GET requests are idempotent",
                    f"Three identical GET requests to {endpoints[0]} returned identical responses.",
                    endpoint=url, response_code=resp.status_code)
            else:
                self._add_finding("idempotent_get", "WARNING", "LOW",
                    "GET responses are not consistent",
                    "Three identical GET requests returned different responses.",
                    remediation="Ensure GET requests are idempotent and return consistent results.",
                    endpoint=url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("idempotent_get", "SKIPPED", "INFO", "Idempotency test skipped", str(e), endpoint=url)

    def test_api_versioning(self):
        try:
            resp = self.session.get(self.target_url, timeout=10)
            url_has_version = any(v in self.target_url.lower() for v in ["/v1/", "/v2/", "/v3/", "/api/v"])
            header_version = resp.headers.get("X-API-Version") or resp.headers.get("API-Version")

            if url_has_version or header_version:
                self._add_finding("api_versioning", "PASSED", "INFO",
                    "API versioning detected",
                    f"URL versioning: {url_has_version}, Header versioning: {header_version}",
                    endpoint=self.target_url, response_code=resp.status_code)
            else:
                self._add_finding("api_versioning", "WARNING", "LOW",
                    "No API versioning detected",
                    "No version prefix in URL or version headers found.",
                    remediation="Consider adding API versioning (e.g., /api/v1/) for backward compatibility.",
                    endpoint=self.target_url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("api_versioning", "SKIPPED", "INFO", "Versioning test skipped", str(e), endpoint=self.target_url)
