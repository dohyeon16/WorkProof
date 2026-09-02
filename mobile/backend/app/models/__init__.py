"""ORM 모델 패키지.

새 모델은 여기서 import 해 Alembic(alembic/env.py의 Base.metadata)과
매퍼 설정(relationship 문자열 참조 해석)이 인식하게 한다.
"""
from app.models.attendance_record import AttendanceRecord
from app.models.oauth_account import OAuthAccount
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.work_schedule import WorkSchedule
from app.models.workplace import Workplace

__all__ = [
    "User",
    "OAuthAccount",
    "RefreshToken",
    "Workplace",
    "WorkSchedule",
    "AttendanceRecord",
]
