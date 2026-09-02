"""비즈니스 로직 — 라우터가 얇게 유지되도록 실제 처리는 여기서 한다.

auth/(인증·토큰·소셜·OAuth 브릿지) · ocr/(Vision 문자 추출) ·
ai_summary/(Gemini 요약·구조화) · work_data_service(근무지/일정/기록 CRUD) ·
google_provider(OCR·AI 가 함께 쓰는 Google 호출 공용 계층).
"""
