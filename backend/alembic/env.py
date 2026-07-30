"""Alembic 마이그레이션 환경.

app 설정(settings.DATABASE_URL)과 Base.metadata를 읽는다. Phase 1에는 모델이
없어 metadata가 비어 있고 초기 마이그레이션도 비어 있다. 스키마 변경은 이후
전부 Alembic으로만 관리한다.
"""
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.db.base import Base
import app.models  # noqa: F401  (모델 등록 — Phase 1엔 없음)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# alembic.ini의 빈 sqlalchemy.url을 런타임 설정값으로 채운다.
if settings.DATABASE_URL:
    config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
