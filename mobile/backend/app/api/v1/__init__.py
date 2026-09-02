"""v1 라우터 — 파일 하나가 하나의 기능 영역이다.

auth(인증) · users(사용자) · workplaces(근무지) · work_schedules(근무 일정) ·
attendance_records(출퇴근 기록) · ai_proxy(OCR·AI 요약 프록시) · health(상태) ·
oauth_bridge(Expo Go OAuth 브릿지, 접두사 없는 레거시 경로).
work_data_deps 는 근무 데이터 목록 endpoint 들의 공통 의존성(페이지네이션/필터)이다.
"""
