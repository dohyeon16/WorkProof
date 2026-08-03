"""호환 진입점 — 기존 실행 방식(uvicorn main:app)을 그대로 유지한다.

실제 애플리케이션 정의는 app/main.py 에 있다. 기존 Render Start Command
`uvicorn main:app --host 0.0.0.0 --port $PORT` 가 변경 없이 동작한다.
"""
from app.main import app  # noqa: F401  (uvicorn main:app 대상)
