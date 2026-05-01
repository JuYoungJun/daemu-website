"""DAEMU 운영자 CLI — host-agnostic 비상 도구.

어떤 host (Render shell / Cafe24 ssh / 로컬 dev) 에서도 동일하게:

    python -m manage reset-2fa --email superadmin@daemu.kr
    python -m manage list-admins
    python -m manage promote-to-admin --email user@example.com

env (.env 또는 export) 의 DATABASE_URL 을 사용. 백엔드 프로세스가 실행 중이
지 않아도 동작 (CLI 가 자체 connection 사용).

설계 원칙:
  - 환경변수 trick (예: DAEMU_RESET_TOTP_EMAIL) 으로 운영자 실수가 backdoor
    로 이어지는 위험을 제거.
  - 모든 변경은 audit_logs 에 기록 (actor_email='cli', action='cli.*').
  - 1회 실행 후 흔적 남지 않음 (env 미설정 시 다시 안 도는 패턴 X).
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone


async def _reset_2fa(email: str, dry_run: bool) -> int:
    from sqlalchemy import select
    from db import SessionLocal
    from models import AdminUser

    email_norm = email.strip().lower()
    async with SessionLocal() as session:
        res = await session.execute(select(AdminUser).where(AdminUser.email == email_norm))
        user = res.scalar_one_or_none()
        if not user:
            print(f"[manage] ⚠ 사용자 없음: {email_norm}")
            return 1
        before = {
            "totp_enabled": user.totp_enabled,
            "has_secret": bool(user.totp_secret),
            "app_label": user.totp_app_label or "",
            "recovery_count": len(user.recovery_codes or []),
        }
        print(f"[manage] 대상: {user.email} (id={user.id}, role={user.role})")
        print(f"[manage] 현재: {before}")
        if dry_run:
            print("[manage] --dry-run — 실제 변경 안 함.")
            return 0

        user.totp_enabled = False
        user.totp_secret = ""
        user.recovery_codes = []
        user.totp_app_label = ""

        # audit log — actor_email='cli' 로 forensic 추적 가능.
        try:
            from models import AuditLog
            session.add(AuditLog(
                actor_user_id=user.id,
                actor_email="cli",
                action="cli.totp.reset",
                target_type="admin_users",
                target_id=str(user.id),
                ip="",
                user_agent="manage.py",
                request_id=f"cli-{int(datetime.now(timezone.utc).timestamp())}",
                detail={"email": user.email, "before": before},
            ))
        except Exception as e:  # noqa: BLE001
            print(f"[manage] ⚠ audit log 기록 실패 (변경은 진행): {e!r}")

        await session.commit()
        print(f"[manage] ✓ 2FA 해제 완료. 사용자가 비밀번호로 로그인 후 즉시 새로 등록 권장.")
        return 0


async def _list_admins() -> int:
    from sqlalchemy import select
    from db import SessionLocal
    from models import AdminUser

    async with SessionLocal() as session:
        res = await session.execute(select(AdminUser).order_by(AdminUser.id))
        rows = res.scalars().all()
        if not rows:
            print("[manage] (사용자 없음)")
            return 0
        print(f"{'ID':<4} {'EMAIL':<40} {'ROLE':<10} {'ACTIVE':<7} {'2FA':<6} {'LABEL':<24}")
        print("-" * 100)
        for u in rows:
            print(f"{u.id:<4} {u.email:<40} {u.role:<10} {str(u.active):<7} {str(u.totp_enabled):<6} {(u.totp_app_label or '-'):<24}")
        return 0


async def _promote(email: str, role: str) -> int:
    if role not in {"admin", "tester", "developer"}:
        print(f"[manage] ⚠ role 은 admin / tester / developer 중 하나여야 합니다. (입력: {role})")
        return 1
    from sqlalchemy import select
    from db import SessionLocal
    from models import AdminUser

    email_norm = email.strip().lower()
    async with SessionLocal() as session:
        res = await session.execute(select(AdminUser).where(AdminUser.email == email_norm))
        user = res.scalar_one_or_none()
        if not user:
            print(f"[manage] ⚠ 사용자 없음: {email_norm}")
            return 1
        old_role = user.role
        user.role = role

        try:
            from models import AuditLog
            session.add(AuditLog(
                actor_user_id=user.id, actor_email="cli", action="cli.role.change",
                target_type="admin_users", target_id=str(user.id),
                ip="", user_agent="manage.py",
                request_id=f"cli-{int(datetime.now(timezone.utc).timestamp())}",
                detail={"email": user.email, "from": old_role, "to": role},
            ))
        except Exception:
            pass
        await session.commit()
        print(f"[manage] ✓ {user.email}: {old_role} → {role}")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        prog="manage", description="DAEMU 운영자 CLI (host-agnostic)"
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_reset = sub.add_parser("reset-2fa", help="사용자 2FA 강제 해제 (시나리오 ③/④)")
    p_reset.add_argument("--email", required=True, help="대상 사용자 이메일")
    p_reset.add_argument("--dry-run", action="store_true", help="검증만, 실제 변경 X")

    sub.add_parser("list-admins", help="모든 어드민 사용자 + 2FA 상태 표시")

    p_promote = sub.add_parser("promote-to-admin", help="role 변경 (admin/tester/developer)")
    p_promote.add_argument("--email", required=True)
    p_promote.add_argument("--role", default="admin", help="admin / tester / developer (기본 admin)")

    args = parser.parse_args()

    # backend-py 디렉토리에서 실행하지 않은 경우 안내.
    if not os.path.exists("models.py") or not os.path.exists("db.py"):
        sys.stderr.write(
            "[manage] backend-py 디렉토리에서 실행해 주세요.\n"
            "  cd /srv/daemu/backend && .venv/bin/python -m manage <command>\n"
            "  또는 로컬: cd backend-py && python -m manage <command>\n"
        )
        return 2

    if args.cmd == "reset-2fa":
        return asyncio.run(_reset_2fa(args.email, args.dry_run))
    if args.cmd == "list-admins":
        return asyncio.run(_list_admins())
    if args.cmd == "promote-to-admin":
        return asyncio.run(_promote(args.email, args.role))
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
