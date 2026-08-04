"""좌표 거리(하버사인) — 순수 함수. 서버가 근무지 좌표와 출퇴근 좌표로 거리를
직접 재계산한다(클라이언트가 보낸 거리를 신뢰하지 않는다).

모바일(src/features/attendance/utils/geo.ts)과 동일한 상수를 쓴다:
- 지구 반지름 6_371_000 m 구 근사
- 반경 인증 기준 VERIFY_RADIUS_M = 200 m
거리 단위는 미터, 정수 반올림은 half-up(모바일 Math.round과 일치).
"""
import math

# 근무지 반경 인증 기준(m). 이 거리 이내면 '근무지에서 기록'으로 본다.
VERIFY_RADIUS_M = 200

_EARTH_RADIUS_M = 6_371_000


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """두 좌표(위경도) 사이 대략적 거리(미터)."""
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    r_lat1 = math.radians(lat1)
    r_lat2 = math.radians(lat2)
    h = (
        math.sin(d_lat / 2) ** 2
        + math.cos(r_lat1) * math.cos(r_lat2) * math.sin(d_lon / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def round_half_up_m(distance: float) -> int:
    """미터 거리 half-up 반올림(음수는 다루지 않음 — 거리는 항상 >= 0)."""
    return int(math.floor(distance + 0.5))


def proximity(
    work_lat: float | None,
    work_lon: float | None,
    rec_lat: float | None,
    rec_lon: float | None,
) -> tuple[int, bool] | None:
    """근무지·기록 좌표로 (거리[m, 정수], 반경내 여부)를 계산.

    어느 한쪽이라도 좌표가 없으면 판정 불가(None) — 좌표 없는 근무지/구버전 데이터 안전 처리.
    """
    if work_lat is None or work_lon is None or rec_lat is None or rec_lon is None:
        return None
    meters = round_half_up_m(haversine_meters(work_lat, work_lon, rec_lat, rec_lon))
    return meters, meters <= VERIFY_RADIUS_M
