"""ORM 모델 패키지.

Phase 1에는 모델이 없다(사용자/데이터 테이블은 Phase 2+). 새 모델을 추가하면
여기서 import 해 Alembic autogenerate(alembic/env.py의 Base.metadata)가
인식하게 한다.
"""
