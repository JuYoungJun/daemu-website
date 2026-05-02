"""Phase 2 보안 강화 회귀 방지 테스트.

stdlib unittest 만 사용 — pytest 없이도 실행 가능:
    cd backend-py && .venv/bin/python -m unittest tests.test_security -v

본 테스트가 보호하는 회귀 시나리오:
1. ENV=prod 인데 secret 누락 → import 자체가 실패해야 함 (fail-closed).
2. 공개 /api/health 가 다시 인프라 디테일 노출하면 안 됨 (정찰 차단).
3. /api/admin/health 가 인증 없이 접근 가능하면 안 됨.
4. mask_email / mask_ip / safe_db_error 가 기대대로 동작.
5. Attachment validator 가 위험 확장자 / 큰 파일 / 잘못된 base64 reject.
"""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

# tests/ 디렉토리에서 backend-py 를 sys.path 에 추가
_HERE = Path(__file__).parent
_BACKEND = _HERE.parent
sys.path.insert(0, str(_BACKEND))


class TestEnvValidation(unittest.TestCase):
    """ENV=prod fail-closed (코드 리뷰 F-3.2, High).

    SQLAlchemy MetaData 는 process-wide singleton 이라 같은 process 안에서
    auth 를 여러 번 import 하면 'Table already defined' 충돌. 각 시나리오를
    subprocess 로 격리해 cleanly 검증.
    """

    def _run_subprocess(self, env: dict[str, str]) -> tuple[int, str]:
        """auth 모듈 import 만 시도하는 작은 python script 를 subprocess 로
        실행. fail-closed 가 import 시점에 RuntimeError 면 returncode != 0.
        return (returncode, stderr_str).
        """
        import subprocess
        full_env = {k: v for k, v in os.environ.items() if k != "ENV"}
        full_env.update(env)
        # backend-py 디렉토리를 cwd 로 — auth 모듈을 직접 import.
        result = subprocess.run(
            [str(_BACKEND / ".venv" / "bin" / "python"), "-c", "import auth"],
            cwd=str(_BACKEND),
            env=full_env,
            capture_output=True,
            text=True,
            timeout=20,
        )
        return result.returncode, result.stderr

    def test_prod_missing_secrets_raises(self):
        """ENV=prod + JWT_SECRET / ADMIN_PASSWORD 미설정 → RuntimeError.
        DATABASE_URL 은 valid 값으로 set (db engine 생성 통과) — 실제 운영
        에서 흔한 패턴 (DBA 가 DATABASE_URL 만 등록하고 secret 누락).
        """
        rc, err = self._run_subprocess({
            "ENV": "prod",
            "JWT_SECRET": "",
            "DATABASE_URL": "sqlite+aiosqlite:///./_t.db",
            "ADMIN_PASSWORD": "",
        })
        self.assertNotEqual(rc, 0, "import 가 성공해서는 안 됨")
        self.assertIn("fail-closed", err)
        self.assertIn("JWT_SECRET", err)
        self.assertIn("ADMIN_PASSWORD", err)

    def test_prod_weak_password_raises(self):
        """ENV=prod + 약한 default 비밀번호 → RuntimeError."""
        rc, err = self._run_subprocess({
            "ENV": "prod",
            "JWT_SECRET": "a" * 64,
            "DATABASE_URL": "sqlite+aiosqlite:///./_t.db",
            "ADMIN_PASSWORD": "daemu1234",
        })
        self.assertNotEqual(rc, 0)
        self.assertIn("ADMIN_PASSWORD", err)

    def test_dev_no_required_env_ok(self):
        """ENV != prod 시 secret 누락이어도 ephemeral 로 진행 (success)."""
        rc, err = self._run_subprocess({
            "JWT_SECRET": "",
            "DATABASE_URL": "sqlite+aiosqlite:///./_t.db",
        })
        self.assertEqual(rc, 0, f"dev mode import 실패: {err}")

    def test_prod_db_module_does_not_log_password_fragments(self):
        """ENV=prod 시 db.py 가 password 길이/시작/끝 글자를 stdout 에 출력하면 안 됨.

        옛 동작은 dev 환경에 도움이 되지만 운영 logs aggregator 에 유출
        시 brute-force 공간 축소 단서 제공. Cafe24 systemd journal /
        Render dashboard 노출 위험.
        """
        import subprocess
        full_env = {k: v for k, v in os.environ.items() if k != "ENV"}
        full_env.update({
            "ENV": "prod",
            "JWT_SECRET": "a" * 64,
            "DATABASE_URL": "mysql+aiomysql://daemu:supersecretpass@127.0.0.1:3306/daemu_db",
            "ADMIN_PASSWORD": "Strong!Password#2026",
        })
        result = subprocess.run(
            [str(_BACKEND / ".venv" / "bin" / "python"), "-c", "import db"],
            cwd=str(_BACKEND),
            env=full_env,
            capture_output=True,
            text=True,
            timeout=20,
        )
        combined = (result.stdout or "") + "\n" + (result.stderr or "")
        # password 단편이 logs 에 나오면 fail
        forbidden_patterns = [
            "password 진단",
            "길이=",
            "시작='",
            "supersecretpass",  # 실제 password 가 노출되면 안 됨
            "password length=",  # dev-only 메시지가 prod 에서 안 나와야
        ]
        for pat in forbidden_patterns:
            self.assertNotIn(pat, combined,
                f"prod logs 에 '{pat}' 노출됨 — db.py 의 진단 출력이 prod 에서 차단되지 않음.")


class TestMaskingUtils(unittest.TestCase):
    """security_utils 의 마스킹 함수 — log/응답 PII/secret 누설 차단."""

    def test_mask_email(self):
        from security_utils import mask_email
        self.assertEqual(mask_email("admin@daemu.kr"), "a***@daemu.kr")
        self.assertEqual(mask_email("a@b.kr"), "a***@b.kr")
        self.assertEqual(mask_email(""), "***")
        self.assertEqual(mask_email("invalid"), "***")

    def test_mask_ip_v4(self):
        from security_utils import mask_ip
        self.assertEqual(mask_ip("203.0.113.45"), "203.0.113.***")
        self.assertEqual(mask_ip(""), "")

    def test_scrub_inline_secrets(self):
        from security_utils import _scrub_inline_secrets
        # bcrypt hash redacted
        s = _scrub_inline_secrets("hash=$2b$12$" + "a" * 53)
        self.assertIn("[REDACTED]", s)
        # JWT redacted
        s = _scrub_inline_secrets("token=eyJabcdefghij.eyJpayload12.signaturexyz")
        self.assertIn("[REDACTED]", s)
        # Resend API key redacted
        s = _scrub_inline_secrets("re_abcdefghijklmnopqrstuvwx")
        self.assertIn("[REDACTED]", s)
        # 64-char hex (JWT_SECRET 형태) redacted
        s = _scrub_inline_secrets("secret=" + "a" * 64)
        self.assertIn("[REDACTED]", s)
        # DB conn string password redacted
        s = _scrub_inline_secrets("mysql+aiomysql://user:secretpass@host:3306/db")
        self.assertIn("[REDACTED]", s)
        self.assertNotIn("secretpass", s)

    def test_mask_dict_recursive(self):
        from security_utils import mask_dict
        out = mask_dict({
            "email": "x@y.kr",
            "password": "supersecret",
            "nested": {"api_key": "kkk", "user": "alice"},
            "tokens": ["jwt_xyz"],
        })
        self.assertEqual(out["password"], "[REDACTED]")
        self.assertEqual(out["nested"]["api_key"], "[REDACTED]")
        self.assertEqual(out["nested"]["user"], "alice")  # 비-민감 키는 유지

    def test_safe_db_error_prod_categorizes(self):
        from security_utils import safe_db_error
        os.environ["ENV"] = "prod"
        try:
            self.assertEqual(safe_db_error("(2003, \"Can't connect\")"), "DB connection failed")
            self.assertEqual(safe_db_error("Access denied for user 'avnadmin'"), "DB auth failed")
            self.assertEqual(safe_db_error("connection timed out after 30s"), "DB timeout")
            self.assertEqual(safe_db_error("Unknown database 'foo'"), "DB schema misconfigured")
            self.assertEqual(safe_db_error("some random error"), "DB internal error")
        finally:
            os.environ.pop("ENV", None)

    def test_safe_db_url_prod_redacts_host(self):
        from security_utils import safe_db_url
        os.environ["ENV"] = "prod"
        try:
            redacted = safe_db_url("mysql+aiomysql://avnadmin:***@daemu.aivencloud.com:21776/defaultdb")
            self.assertNotIn("aivencloud.com", redacted)
            self.assertNotIn("avnadmin", redacted)
            self.assertIn("[redacted]", redacted)
            self.assertIn("defaultdb", redacted)  # DB name 만 보존
        finally:
            os.environ.pop("ENV", None)


class TestHealthEndpoint(unittest.TestCase):
    """공개 /api/health 가 운영 정보 노출하지 않는지 (코드 리뷰 F-3.1)."""

    @classmethod
    def setUpClass(cls):
        os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./_t_health.db"
        os.environ.pop("ENV", None)
        # main 재import 보장
        for mod in list(sys.modules):
            if mod in {"main", "auth", "models", "db"}:
                sys.modules.pop(mod, None)
        from fastapi.testclient import TestClient
        import main
        cls.app = main.app
        cls.client = TestClient(cls.app)

    def test_public_health_minimal(self):
        """공개 /api/health 응답에 인프라 디테일 없어야 함."""
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        # 노출되어선 안 되는 키들
        forbidden = {
            "emailProvider", "resendConfigured", "smtpConfigured",
            "smtpHost", "smtpFrom", "database", "databaseConnected",
            "databaseError", "from", "allowedOrigins", "publicBase",
            "warnings", "uploadEndpoint",
        }
        leaked = forbidden & set(body.keys())
        self.assertFalse(leaked, f"공개 응답에 인프라 정보 leak: {leaked}")
        # 최소 정보만
        self.assertEqual(body, {"ok": True})

    def test_admin_health_requires_auth(self):
        """/api/admin/health 는 인증 없이 401 (혹은 403 — bearer missing)."""
        r = self.client.get("/api/admin/health")
        # require_perm 의 _resolve_user 가 missing bearer → 401
        self.assertIn(r.status_code, (401, 403))


class TestAttachmentValidation(unittest.TestCase):
    """첨부 파일 strict validation (코드 리뷰 F-3.9, Phase 2)."""

    @classmethod
    def setUpClass(cls):
        os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./_t_att.db"
        os.environ.pop("ENV", None)
        for mod in list(sys.modules):
            if mod in {"main", "auth", "models", "db"}:
                sys.modules.pop(mod, None)
        import main
        cls.main = main

    def test_denied_extensions_blocked(self):
        """위험한 확장자 (.html / .js / .exe / .sh 등) 차단."""
        from main import DENIED_EXTS
        for ext in (".html", ".js", ".svg", ".exe", ".bat", ".sh", ".php"):
            self.assertIn(ext, DENIED_EXTS, f"{ext} 가 deny set 에 없음")

    def test_normalize_attachments_rejects_bad_base64(self):
        """잘못된 base64 → HTTPException (validate=True)."""
        from fastapi import HTTPException
        from main import normalize_attachments, Attachment
        att = Attachment(filename="test.png", content="not-valid-base64!!!", contentType="image/png")
        with self.assertRaises(HTTPException) as ctx:
            normalize_attachments([att])
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("base64", ctx.exception.detail)

    def test_normalize_attachments_rejects_denied_ext(self):
        """위험 확장자 첨부 → 415."""
        import base64
        from fastapi import HTTPException
        from main import normalize_attachments, Attachment
        b64 = base64.b64encode(b"<script>alert(1)</script>").decode()
        att = Attachment(filename="evil.html", content=b64)
        with self.assertRaises(HTTPException) as ctx:
            normalize_attachments([att])
        self.assertEqual(ctx.exception.status_code, 415)

    def test_normalize_attachments_total_size_cap(self):
        """합계 크기 cap 초과 → 413."""
        import base64
        from fastapi import HTTPException
        from main import normalize_attachments, Attachment, MAX_ATTACHMENT_BYTES
        # 9MB 첨부 3개 → 27MB > 20MB total cap
        big = b"\x00" * (9 * 1024 * 1024)
        b64 = base64.b64encode(big).decode()
        atts = [Attachment(filename=f"f{i}.png", content=b64) for i in range(3)]
        # 첨부 자체는 9MB < 10MB cap 이라 single 은 통과, total cap 에서 fail
        with self.assertRaises(HTTPException) as ctx:
            normalize_attachments(atts)
        self.assertEqual(ctx.exception.status_code, 413)


if __name__ == "__main__":
    unittest.main(verbosity=2)
