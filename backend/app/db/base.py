"""SQLAlchemy 2 DeclarativeBase.

모든 ORM 모델의 베이스이자 Alembic autogenerate가 참조할 metadata 소유자.
Phase 1에는 아직 모델이 없다(테이블 미생성).
"""
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
