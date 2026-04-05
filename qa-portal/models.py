from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


class AuditRequest(BaseModel):
    project_name: str
    target_url: str
    auth_token: Optional[str] = None
    known_endpoints: Optional[List[str]] = None


class LoginRequest(BaseModel):
    password: str


class AuditFinding(BaseModel):
    agent: str
    test_name: str
    status: str
    severity: str
    title: str
    description: str
    evidence: Optional[str] = None
    remediation: Optional[str] = None
    endpoint: Optional[str] = None
    response_code: Optional[int] = None
    response_time_ms: Optional[float] = None
