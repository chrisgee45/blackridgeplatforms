import json
import os
from datetime import datetime

from agents.security_agent import SecurityAgent
from agents.infrastructure_agent import InfrastructureAgent
from agents.api_agent import APIAgent
from agents.data_flow_agent import DataFlowAgent


class QAOrchestrator:
    def __init__(self, audit_id, target_url, auth_token, known_endpoints, db_update_callback, progress_callback):
        self.audit_id = audit_id
        self.target_url = target_url
        self.auth_token = auth_token
        self.known_endpoints = known_endpoints or []
        self.db_update = db_update_callback
        self.progress = progress_callback

    def run(self):
        agents = [
            ("Security", SecurityAgent),
            ("Infrastructure", InfrastructureAgent),
            ("API", APIAgent),
            ("Data Flow", DataFlowAgent),
        ]
        all_findings = []

        try:
            for agent_name, AgentClass in agents:
                self.progress("progress", {"agent": agent_name, "message": f"Running {agent_name} tests..."})
                self.db_update(self.audit_id, {"status": "running", "current_agent": agent_name})

                agent = AgentClass(self.target_url, self.auth_token, self.known_endpoints)
                findings = agent.run()
                all_findings.extend(findings)

                passed = len([f for f in findings if f["status"] == "PASSED"])
                failed = len([f for f in findings if f["status"] == "FAILED"])
                warnings = len([f for f in findings if f["status"] == "WARNING"])
                self.progress("agent_complete", {
                    "agent": agent_name,
                    "passed": passed,
                    "failed": failed,
                    "warnings": warnings,
                    "total": len(findings),
                })

            score = self._calculate_score(all_findings)
            grade = self._score_to_grade(score)

            total = len(all_findings)
            passed = len([f for f in all_findings if f["status"] == "PASSED"])
            failed = len([f for f in all_findings if f["status"] == "FAILED"])
            critical = len([f for f in all_findings if f["severity"] == "CRITICAL" and f["status"] != "PASSED"])
            high = len([f for f in all_findings if f["severity"] == "HIGH" and f["status"] != "PASSED"])
            medium = len([f for f in all_findings if f["severity"] == "MEDIUM" and f["status"] != "PASSED"])
            low = len([f for f in all_findings if f["severity"] == "LOW" and f["status"] != "PASSED"])

            self.progress("progress", {"agent": "AI Analysis", "message": "Generating executive summary..."})
            ai_analysis = self._generate_ai_analysis(all_findings, score, grade)

            report_markdown = self._generate_markdown_report(all_findings, score, grade, ai_analysis)

            from database import insert_findings
            insert_findings(self.audit_id, all_findings)

            self.db_update(self.audit_id, {
                "status": "completed",
                "score": score,
                "grade": grade,
                "total_tests": total,
                "passed": passed,
                "failed": failed,
                "critical_count": critical,
                "high_count": high,
                "medium_count": medium,
                "low_count": low,
                "ai_analysis": ai_analysis,
                "report_json": json.dumps({"findings": all_findings, "score": score, "grade": grade, "total": total, "passed": passed, "failed": failed}),
                "report_markdown": report_markdown,
                "completed_at": datetime.utcnow().isoformat(),
                "current_agent": None,
            })

            self.progress("complete", {"score": score, "grade": grade, "audit_id": self.audit_id})

        except Exception as e:
            self.db_update(self.audit_id, {
                "status": "failed",
                "error_message": str(e),
                "current_agent": None,
            })
            self.progress("error", {"message": str(e)})

    def _calculate_score(self, findings):
        score = 100.0
        for f in findings:
            if f["status"] in ("PASSED", "SKIPPED"):
                continue
            sev = f["severity"]
            if sev == "CRITICAL":
                score -= 25
            elif sev == "HIGH":
                score -= 10
            elif sev == "MEDIUM":
                score -= 5
            elif sev == "LOW":
                score -= 2
        return max(0, round(score, 1))

    def _score_to_grade(self, score):
        if score >= 95:
            return "A+"
        elif score >= 90:
            return "A"
        elif score >= 85:
            return "B+"
        elif score >= 80:
            return "B"
        elif score >= 70:
            return "C"
        elif score >= 60:
            return "D"
        else:
            return "F"

    def _generate_ai_analysis(self, findings, score, grade):
        failed_findings = [f for f in findings if f["status"] in ("FAILED", "WARNING")]
        if not failed_findings:
            return "All tests passed successfully. The target application demonstrates strong security practices, robust infrastructure, well-designed APIs, and reliable data handling. No immediate action is required."

        critical_high = [f for f in failed_findings if f["severity"] in ("CRITICAL", "HIGH")]
        top_issues = critical_high[:5] if critical_high else failed_findings[:5]

        summary_input = f"Score: {score}/100 (Grade: {grade})\n"
        summary_input += f"Total findings: {len(failed_findings)} issues found\n\n"
        for f in top_issues:
            summary_input += f"[{f['severity']}] {f['title']}: {f['description']}\n"

        try:
            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                connector_hostname = os.environ.get("REPLIT_CONNECTORS_HOSTNAME")
                x_replit_token = None
                if os.environ.get("REPL_IDENTITY"):
                    x_replit_token = "repl " + os.environ["REPL_IDENTITY"]
                elif os.environ.get("WEB_REPL_RENEWAL"):
                    x_replit_token = "depl " + os.environ["WEB_REPL_RENEWAL"]

                if connector_hostname and x_replit_token:
                    import requests as req
                    conn_resp = req.get(
                        f"https://{connector_hostname}/api/v2/connection?include_secrets=true&connector_names=openai",
                        headers={"Accept": "application/json", "X_REPLIT_TOKEN": x_replit_token},
                        timeout=10
                    )
                    items = conn_resp.json().get("items", [])
                    if items and items[0].get("settings", {}).get("api_key"):
                        api_key = items[0]["settings"]["api_key"]

            base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
            ai_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or api_key

            if not ai_key:
                return self._rule_based_summary(findings, score, grade)

            from openai import OpenAI
            client_kwargs = {"api_key": ai_key}
            if base_url:
                client_kwargs["base_url"] = base_url
            client = OpenAI(**client_kwargs)

            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a senior QA engineer at BlackRidge Platforms. Write a concise 3-paragraph executive summary for a website/API quality audit. Paragraph 1: Overall risk level. Paragraph 2: Top 3 most critical issues and their business impact. Paragraph 3: Recommended immediate actions."},
                    {"role": "user", "content": summary_input}
                ],
                max_tokens=500,
                temperature=0.3,
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"AI analysis error: {e}")
            return self._rule_based_summary(findings, score, grade)

    def _rule_based_summary(self, findings, score, grade):
        failed = [f for f in findings if f["status"] in ("FAILED", "WARNING")]
        critical = [f for f in failed if f["severity"] == "CRITICAL"]
        high = [f for f in failed if f["severity"] == "HIGH"]

        risk = "LOW" if score >= 80 else "MODERATE" if score >= 60 else "HIGH" if score >= 40 else "CRITICAL"

        summary = f"Overall Risk Level: {risk}. The target scored {score}/100 (Grade: {grade}) with {len(failed)} issues identified across security, infrastructure, API quality, and data flow testing.\n\n"

        if critical or high:
            top = (critical + high)[:3]
            summary += "Top Issues:\n"
            for f in top:
                summary += f"• [{f['severity']}] {f['title']}: {f['description']}\n"
            summary += "\n"

        summary += "Recommended Actions: "
        if critical:
            summary += "Address all CRITICAL findings immediately as they pose significant security or reliability risks. "
        if high:
            summary += "Resolve HIGH severity issues within the current sprint. "
        summary += "Review MEDIUM and LOW findings during regular maintenance cycles."

        return summary

    def _generate_markdown_report(self, findings, score, grade, ai_analysis):
        report = f"# BlackRidge QA Audit Report\n\n"
        report += f"**Target:** {self.target_url}\n"
        report += f"**Date:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        report += f"**Score:** {score}/100 (Grade: {grade})\n\n"

        total = len(findings)
        passed = len([f for f in findings if f["status"] == "PASSED"])
        failed = len([f for f in findings if f["status"] == "FAILED"])
        report += f"## Summary\n\n"
        report += f"| Metric | Value |\n|---|---|\n"
        report += f"| Total Tests | {total} |\n"
        report += f"| Passed | {passed} |\n"
        report += f"| Failed | {failed} |\n\n"

        report += f"## AI Executive Summary\n\n{ai_analysis}\n\n"

        report += f"## Findings\n\n"
        for severity in ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]:
            sev_findings = [f for f in findings if f["severity"] == severity and f["status"] != "PASSED"]
            if sev_findings:
                report += f"### {severity} ({len(sev_findings)})\n\n"
                for f in sev_findings:
                    report += f"#### {f['title']}\n\n"
                    report += f"- **Agent:** {f['agent']}\n"
                    report += f"- **Status:** {f['status']}\n"
                    report += f"- **Description:** {f['description']}\n"
                    if f.get("evidence"):
                        report += f"- **Evidence:** `{f['evidence'][:200]}`\n"
                    if f.get("remediation"):
                        report += f"- **Remediation:** {f['remediation']}\n"
                    report += "\n"

        return report
