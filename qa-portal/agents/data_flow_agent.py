import requests
import time
import re
import concurrent.futures
from urllib.parse import urljoin


class DataFlowAgent:
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
            "agent": "Data Flow",
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
            self.test_create_read_consistency,
            self.test_data_type_integrity,
            self.test_required_field_validation,
            self.test_update_propagation,
            self.test_delete_verification,
            self.test_financial_calculation,
            self.test_data_sanitization,
            self.test_timestamp_format,
            self.test_concurrent_write_safety,
        ]
        for test in tests:
            try:
                test()
            except Exception as e:
                self._add_finding(test.__name__, "SKIPPED", "INFO", f"Test skipped: {test.__name__}", f"Exception: {str(e)}")
        return self.findings

    def _get_crud_endpoint(self):
        crud_patterns = ["users", "orders", "items", "products", "posts", "comments"]
        for ep in self.known_endpoints:
            if any(p in ep.lower() for p in crud_patterns):
                return ep
        return self.known_endpoints[0] if self.known_endpoints else None

    def test_create_read_consistency(self):
        ep = self._get_crud_endpoint()
        if not ep:
            self._add_finding("create_read", "SKIPPED", "INFO", "Create-read test skipped", "No CRUD endpoints provided.", endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", ep.lstrip("/"))
        test_data = {"name": "QA_TEST_ITEM_" + str(int(time.time())), "email": "qa-test@blackridge.test", "description": "QA test record"}
        try:
            create_resp = self.session.post(url, json=test_data, timeout=10)
            if create_resp.status_code not in (200, 201):
                self._add_finding("create_read", "SKIPPED", "INFO",
                    "Create-read test: could not create resource",
                    f"POST returned {create_resp.status_code}.",
                    endpoint=url, response_code=create_resp.status_code)
                return

            try:
                created = create_resp.json()
                resource_id = created.get("id") or created.get("_id")
            except Exception:
                self._add_finding("create_read", "SKIPPED", "INFO",
                    "Create-read test: no ID in response", "Cannot verify without ID.",
                    endpoint=url, response_code=create_resp.status_code)
                return

            if resource_id:
                read_url = f"{url.rstrip('/')}/{resource_id}"
                read_resp = self.session.get(read_url, timeout=10)
                if read_resp.status_code == 200:
                    read_data = read_resp.json()
                    mismatches = []
                    for key, val in test_data.items():
                        if key in read_data and read_data[key] != val:
                            mismatches.append(f"{key}: sent={val}, got={read_data[key]}")
                    if mismatches:
                        self._add_finding("create_read", "FAILED", "HIGH",
                            "Create-read data mismatch",
                            f"Fields differ between POST and GET: {mismatches}",
                            endpoint=url, response_code=read_resp.status_code)
                    else:
                        self._add_finding("create_read", "PASSED", "INFO",
                            "Create-read consistency verified",
                            "POST and GET return matching data.",
                            endpoint=url, response_code=read_resp.status_code)

                    self.session.delete(read_url, timeout=10)
                else:
                    self._add_finding("create_read", "WARNING", "MEDIUM",
                        f"Could not read back created resource (status {read_resp.status_code})",
                        "GET after POST did not return the created resource.",
                        endpoint=read_url, response_code=read_resp.status_code)
        except Exception as e:
            self._add_finding("create_read", "SKIPPED", "INFO", "Create-read test error", str(e), endpoint=url)

    def test_data_type_integrity(self):
        ep = self._get_crud_endpoint()
        if not ep:
            self._add_finding("data_types", "SKIPPED", "INFO", "Data type test skipped", "No endpoints.", endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", ep.lstrip("/"))
        payload = {"name": "QA_TYPE_TEST", "count": 42, "price": 19.99, "active": True, "notes": None}
        try:
            resp = self.session.post(url, json=payload, timeout=10)
            if resp.status_code in (200, 201):
                data = resp.json()
                type_issues = []
                if "count" in data and not isinstance(data["count"], int):
                    type_issues.append(f"count: expected int, got {type(data['count']).__name__}")
                if "price" in data and not isinstance(data["price"], (int, float)):
                    type_issues.append(f"price: expected number, got {type(data['price']).__name__}")
                if "active" in data and not isinstance(data["active"], bool):
                    type_issues.append(f"active: expected bool, got {type(data['active']).__name__}")

                if type_issues:
                    self._add_finding("data_types", "FAILED", "MEDIUM",
                        "Data type integrity issues", f"Type mismatches: {type_issues}",
                        endpoint=url, response_code=resp.status_code)
                else:
                    self._add_finding("data_types", "PASSED", "INFO",
                        "Data types preserved correctly", "All data types match expected types.",
                        endpoint=url, response_code=resp.status_code)

                resource_id = data.get("id") or data.get("_id")
                if resource_id:
                    self.session.delete(f"{url.rstrip('/')}/{resource_id}", timeout=10)
            else:
                self._add_finding("data_types", "SKIPPED", "INFO",
                    "Data type test: POST failed", f"Status {resp.status_code}",
                    endpoint=url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("data_types", "SKIPPED", "INFO", "Data type test error", str(e), endpoint=url)

    def test_required_field_validation(self):
        ep = self._get_crud_endpoint()
        if not ep:
            self._add_finding("required_fields", "SKIPPED", "INFO", "Required field test skipped", "No endpoints.", endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", ep.lstrip("/"))
        try:
            resp = self.session.post(url, json={"name": None, "email": None}, timeout=10)
            if resp.status_code in (400, 422):
                self._add_finding("required_fields", "PASSED", "INFO",
                    "Required field validation works",
                    f"Server returned {resp.status_code} for null required fields.",
                    endpoint=url, response_code=resp.status_code)
            elif resp.status_code == 500:
                self._add_finding("required_fields", "FAILED", "HIGH",
                    "Server error on null required fields",
                    "Server crashed with 500 instead of returning validation error.",
                    remediation="Add null checks for required fields.",
                    endpoint=url, response_code=500)
            else:
                self._add_finding("required_fields", "WARNING", "MEDIUM",
                    f"Unexpected response ({resp.status_code}) for null fields",
                    "Expected 400/422 for null required fields.",
                    endpoint=url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("required_fields", "SKIPPED", "INFO", "Required field test error", str(e), endpoint=url)

    def test_update_propagation(self):
        ep = self._get_crud_endpoint()
        if not ep:
            self._add_finding("update_propagation", "SKIPPED", "INFO", "Update test skipped", "No endpoints.", endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", ep.lstrip("/"))
        try:
            create_resp = self.session.post(url, json={"name": "QA_UPDATE_TEST", "email": "update@blackridge.test"}, timeout=10)
            if create_resp.status_code not in (200, 201):
                self._add_finding("update_propagation", "SKIPPED", "INFO", "Update test: create failed", f"Status {create_resp.status_code}", endpoint=url)
                return

            data = create_resp.json()
            resource_id = data.get("id") or data.get("_id")
            if not resource_id:
                self._add_finding("update_propagation", "SKIPPED", "INFO", "Update test: no ID", "No ID in response.", endpoint=url)
                return

            item_url = f"{url.rstrip('/')}/{resource_id}"
            update_data = {"name": "QA_UPDATE_VERIFIED"}
            patch_resp = self.session.patch(item_url, json=update_data, timeout=10)
            if patch_resp.status_code not in (200, 204):
                self.session.put(item_url, json={**data, **update_data}, timeout=10)

            get_resp = self.session.get(item_url, timeout=10)
            if get_resp.status_code == 200:
                updated = get_resp.json()
                if updated.get("name") == "QA_UPDATE_VERIFIED":
                    self._add_finding("update_propagation", "PASSED", "INFO",
                        "Update propagation verified", "PATCH + GET shows updated data.",
                        endpoint=item_url, response_code=200)
                else:
                    self._add_finding("update_propagation", "WARNING", "MEDIUM",
                        "Update may not have propagated", f"Expected 'QA_UPDATE_VERIFIED', got '{updated.get('name')}'",
                        endpoint=item_url, response_code=200)

            self.session.delete(item_url, timeout=10)
        except Exception as e:
            self._add_finding("update_propagation", "SKIPPED", "INFO", "Update test error", str(e), endpoint=url)

    def test_delete_verification(self):
        ep = self._get_crud_endpoint()
        if not ep:
            self._add_finding("delete_verify", "SKIPPED", "INFO", "Delete test skipped", "No endpoints.", endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", ep.lstrip("/"))
        try:
            create_resp = self.session.post(url, json={"name": "QA_DELETE_TEST", "email": "delete@blackridge.test"}, timeout=10)
            if create_resp.status_code not in (200, 201):
                self._add_finding("delete_verify", "SKIPPED", "INFO", "Delete test: create failed", "", endpoint=url)
                return

            data = create_resp.json()
            resource_id = data.get("id") or data.get("_id")
            if not resource_id:
                self._add_finding("delete_verify", "SKIPPED", "INFO", "Delete test: no ID", "", endpoint=url)
                return

            item_url = f"{url.rstrip('/')}/{resource_id}"
            del_resp = self.session.delete(item_url, timeout=10)
            if del_resp.status_code not in (200, 204, 404):
                self._add_finding("delete_verify", "SKIPPED", "INFO", "Delete test: delete failed", f"Status {del_resp.status_code}", endpoint=item_url)
                return

            get_resp = self.session.get(item_url, timeout=10)
            if get_resp.status_code == 404:
                self._add_finding("delete_verify", "PASSED", "INFO",
                    "Delete verification passed", "Deleted resource returns 404.",
                    endpoint=item_url, response_code=404)
            elif get_resp.status_code == 200:
                self._add_finding("delete_verify", "FAILED", "MEDIUM",
                    "Deleted resource still accessible",
                    "GET after DELETE still returns 200.",
                    remediation="Ensure DELETE fully removes the resource.",
                    endpoint=item_url, response_code=200)
        except Exception as e:
            self._add_finding("delete_verify", "SKIPPED", "INFO", "Delete test error", str(e), endpoint=url)

    def test_financial_calculation(self):
        calc_endpoints = [ep for ep in self.known_endpoints if any(p in ep.lower() for p in ["order", "calc", "invoice", "payment", "checkout"])]
        if not calc_endpoints:
            self._add_finding("financial_calc", "SKIPPED", "INFO",
                "Financial calculation test skipped", "No order/calculation endpoints provided.",
                endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", calc_endpoints[0].lstrip("/"))
        try:
            payload = {"items": [{"price": 29.99, "quantity": 3}], "tax_rate": 0.08}
            resp = self.session.post(url, json=payload, timeout=10)
            if resp.status_code in (200, 201):
                data = resp.json()
                expected_subtotal = 89.97
                if "subtotal" in data:
                    actual = round(float(data["subtotal"]), 2)
                    if abs(actual - expected_subtotal) < 0.01:
                        self._add_finding("financial_calc", "PASSED", "INFO",
                            "Financial calculations are accurate",
                            f"Subtotal: expected {expected_subtotal}, got {actual}",
                            endpoint=url, response_code=resp.status_code)
                    else:
                        self._add_finding("financial_calc", "FAILED", "HIGH",
                            "Financial calculation error",
                            f"Expected subtotal {expected_subtotal}, got {actual}",
                            remediation="Verify all financial calculations use proper decimal arithmetic.",
                            endpoint=url, response_code=resp.status_code)
                else:
                    self._add_finding("financial_calc", "SKIPPED", "INFO",
                        "No subtotal in response", "Cannot verify calculations.",
                        endpoint=url, response_code=resp.status_code)
            else:
                self._add_finding("financial_calc", "SKIPPED", "INFO",
                    "Financial test: endpoint rejected request", f"Status {resp.status_code}",
                    endpoint=url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("financial_calc", "SKIPPED", "INFO", "Financial test error", str(e), endpoint=url)

    def test_data_sanitization(self):
        ep = self._get_crud_endpoint()
        if not ep:
            self._add_finding("sanitization", "SKIPPED", "INFO", "Sanitization test skipped", "No endpoints.", endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", ep.lstrip("/"))
        xss_payload = "<script>alert(1)</script>"
        try:
            resp = self.session.post(url, json={"name": xss_payload, "description": xss_payload}, timeout=10)
            if resp.status_code in (200, 201):
                body = resp.text
                if xss_payload in body:
                    self._add_finding("sanitization", "FAILED", "HIGH",
                        "Data not sanitized — XSS payload stored",
                        "Script tags submitted as field values are returned unsanitized.",
                        evidence=f"Payload '{xss_payload}' found in response.",
                        remediation="Sanitize all user input before storage and output.",
                        endpoint=url, response_code=resp.status_code)
                else:
                    self._add_finding("sanitization", "PASSED", "INFO",
                        "Data sanitization working",
                        "Script tags were sanitized or escaped in the response.",
                        endpoint=url, response_code=resp.status_code)

                data = resp.json() if resp.status_code in (200, 201) else {}
                rid = data.get("id") or data.get("_id")
                if rid:
                    self.session.delete(f"{url.rstrip('/')}/{rid}", timeout=10)
            else:
                self._add_finding("sanitization", "SKIPPED", "INFO",
                    "Sanitization test: POST rejected", f"Status {resp.status_code}",
                    endpoint=url, response_code=resp.status_code)
        except Exception as e:
            self._add_finding("sanitization", "SKIPPED", "INFO", "Sanitization test error", str(e), endpoint=url)

    def test_timestamp_format(self):
        iso_pattern = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')
        endpoints = self.known_endpoints[:2] if self.known_endpoints else ["/"]

        for ep in endpoints:
            url = urljoin(self.target_url + "/", ep.lstrip("/"))
            try:
                resp = self.session.get(url, timeout=10)
                if resp.status_code == 200:
                    try:
                        data = resp.json()
                        text = str(data)
                        ts_fields = ["created_at", "updated_at", "createdAt", "updatedAt", "timestamp", "date"]
                        found_ts = False
                        for field in ts_fields:
                            if field in text:
                                found_ts = True
                                break
                        if found_ts:
                            if iso_pattern.search(text):
                                self._add_finding("timestamp_format", "PASSED", "INFO",
                                    "Timestamps use ISO 8601 format",
                                    "Detected ISO 8601 formatted timestamps in responses.",
                                    endpoint=url, response_code=200)
                            else:
                                self._add_finding("timestamp_format", "WARNING", "LOW",
                                    "Timestamps may not use ISO 8601",
                                    "Timestamp fields found but not in ISO 8601 format.",
                                    remediation="Use ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ) for all timestamps.",
                                    endpoint=url, response_code=200)
                            return
                    except Exception:
                        pass
            except Exception:
                continue

        self._add_finding("timestamp_format", "SKIPPED", "INFO",
            "No timestamps found to validate", "No timestamp fields detected in responses.",
            endpoint=self.target_url)

    def test_concurrent_write_safety(self):
        ep = self._get_crud_endpoint()
        if not ep:
            self._add_finding("concurrent_writes", "SKIPPED", "INFO", "Concurrent write test skipped", "No endpoints.", endpoint=self.target_url)
            return

        url = urljoin(self.target_url + "/", ep.lstrip("/"))
        try:
            create_resp = self.session.post(url, json={"name": "QA_CONCURRENT_TEST", "email": "concurrent@blackridge.test"}, timeout=10)
            if create_resp.status_code not in (200, 201):
                self._add_finding("concurrent_writes", "SKIPPED", "INFO", "Concurrent test: create failed", "", endpoint=url)
                return

            data = create_resp.json()
            resource_id = data.get("id") or data.get("_id")
            if not resource_id:
                self._add_finding("concurrent_writes", "SKIPPED", "INFO", "Concurrent test: no ID", "", endpoint=url)
                return

            item_url = f"{url.rstrip('/')}/{resource_id}"
            headers = dict(self.session.headers)

            def patch_request(i):
                try:
                    resp = requests.patch(item_url, json={"name": f"CONCURRENT_{i}"}, timeout=10, headers=headers)
                    return resp.status_code
                except Exception:
                    return 0

            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                futures = [executor.submit(patch_request, i) for i in range(5)]
                results = [f.result() for f in concurrent.futures.as_completed(futures)]

            errors = [r for r in results if r >= 500]
            if errors:
                self._add_finding("concurrent_writes", "FAILED", "HIGH",
                    f"Server errors during concurrent writes ({len(errors)}/5)",
                    f"Status codes: {results}",
                    remediation="Add proper locking or conflict resolution for concurrent writes.",
                    endpoint=item_url)
            else:
                self._add_finding("concurrent_writes", "PASSED", "INFO",
                    "Concurrent writes handled safely",
                    f"All 5 concurrent PATCH requests completed without 500 errors. Status codes: {results}",
                    endpoint=item_url)

            self.session.delete(item_url, timeout=10)
        except Exception as e:
            self._add_finding("concurrent_writes", "SKIPPED", "INFO", "Concurrent test error", str(e), endpoint=url)
