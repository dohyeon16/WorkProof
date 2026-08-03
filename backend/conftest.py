"""pytest 부트스트랩.

- backend/ 를 import 경로에 올려 `from main import app` / `from app...` 가 되게 한다.
- 앱 import 전에 필수 시크릿을 테스트용 더미로 설정한다(실제 값 아님).
- DATABASE_URL은 일부러 설정하지 않아 "DB 없이도 앱 import 가능"을 검증한다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.environ.setdefault("SESSION_SIGNING_SECRET", "test-signing-secret-not-a-real-value")
os.environ.setdefault("ENVIRONMENT", "test")
