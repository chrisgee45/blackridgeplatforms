import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "qa_audits.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS audits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            project_name TEXT,
            target_url TEXT,
            auth_token TEXT,
            status TEXT DEFAULT 'pending',
            current_agent TEXT,
            score REAL,
            grade TEXT,
            total_tests INTEGER,
            passed INTEGER,
            failed INTEGER,
            critical_count INTEGER,
            high_count INTEGER,
            medium_count INTEGER,
            low_count INTEGER,
            ai_analysis TEXT,
            report_json TEXT,
            report_markdown TEXT,
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME
        );

        CREATE TABLE IF NOT EXISTS audit_findings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            audit_id INTEGER,
            agent TEXT,
            test_name TEXT,
            status TEXT,
            severity TEXT,
            title TEXT,
            description TEXT,
            evidence TEXT,
            remediation TEXT,
            endpoint TEXT,
            response_code INTEGER,
            response_time_ms REAL,
            FOREIGN KEY (audit_id) REFERENCES audits(id)
        );
    """)
    conn.commit()
    conn.close()


def create_audit(user_id, project_name, target_url, auth_token=None):
    conn = get_db()
    cursor = conn.execute(
        "INSERT INTO audits (user_id, project_name, target_url, auth_token, status) VALUES (?, ?, ?, ?, 'pending')",
        (user_id, project_name, target_url, auth_token)
    )
    audit_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return audit_id


def update_audit(audit_id, updates: dict):
    conn = get_db()
    set_clauses = ", ".join(f"{k} = ?" for k in updates.keys())
    values = list(updates.values()) + [audit_id]
    conn.execute(f"UPDATE audits SET {set_clauses} WHERE id = ?", values)
    conn.commit()
    conn.close()


def insert_findings(audit_id, findings: list):
    conn = get_db()
    for f in findings:
        conn.execute(
            """INSERT INTO audit_findings
            (audit_id, agent, test_name, status, severity, title, description, evidence, remediation, endpoint, response_code, response_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (audit_id, f.get("agent"), f.get("test_name"), f.get("status"), f.get("severity"),
             f.get("title"), f.get("description"), f.get("evidence"), f.get("remediation"),
             f.get("endpoint"), f.get("response_code"), f.get("response_time_ms"))
        )
    conn.commit()
    conn.close()


def get_audit(audit_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM audits WHERE id = ?", (audit_id,)).fetchone()
    if not row:
        conn.close()
        return None
    audit = dict(row)
    findings = conn.execute("SELECT * FROM audit_findings WHERE audit_id = ? ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END", (audit_id,)).fetchall()
    audit["findings"] = [dict(f) for f in findings]
    conn.close()
    return audit


def get_audits(limit=50, offset=0):
    conn = get_db()
    rows = conn.execute("SELECT id, user_id, project_name, target_url, status, score, grade, total_tests, passed, failed, created_at, completed_at FROM audits ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)).fetchall()
    total = conn.execute("SELECT COUNT(*) FROM audits").fetchone()[0]
    conn.close()
    return {"audits": [dict(r) for r in rows], "total": total}
