import type { PlaceResult, PlaceSearchParams, PlaceSearchResult } from './place.types';

// 네이티브(iOS/Android)는 브라우저가 아니라 CORS 제약이 없으므로, 카카오 로그인에
// 쓰는 것과 같은 REST API 키로 카카오 로컬 API를 직접 호출한다. 웹에서는 이 키로
// dapi.kakao.com을 직접 호출하면 CORS에 막히므로 kakaoPlaces.web.ts가 대신
// 카카오맵 JavaScript SDK를 쓴다(mobile/docs/OAUTH_SETUP.md 참고).
const KAKAO_REST_KEY = (process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID ?? '').trim();

interface KakaoDocument {
  id: string;
  place_name: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  x: string;
  y: string;
  distance?: string;
}

function mapDocument(doc: KakaoDocument): PlaceResult {
  return {
    id: doc.id,
    name: doc.place_name,
    category: doc.category_name ?? '',
    address: doc.road_address_name || doc.address_name || '',
    latitude: Number(doc.y),
    longitude: Number(doc.x),
    distanceMeters: doc.distance ? Number(doc.distance) : undefined,
  };
}

export async function searchPlaces(params: PlaceSearchParams): Promise<PlaceSearchResult> {
  if (!KAKAO_REST_KEY) {
    return { status: 'not_configured' };
  }

  const query = new URLSearchParams({
    x: String(params.longitude),
    y: String(params.latitude),
    radius: '20000',
    sort: 'distance',
  });

  const endpoint =
    params.mode === 'category'
      ? 'https://dapi.kakao.com/v2/local/search/category.json'
      : 'https://dapi.kakao.com/v2/local/search/keyword.json';

  if (params.mode === 'category') {
    query.set('category_group_code', params.categoryCode);
  } else {
    query.set('query', params.query);
  }

  try {
    const response = await fetch(`${endpoint}?${query.toString()}`, {
      headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` },
    });
    if (!response.ok) {
      return { status: 'error', message: '장소 검색에 실패했어요.\n잠시 후 다시 시도해주세요.' };
    }
    const data = (await response.json()) as { documents?: KakaoDocument[] };
    return { status: 'success', places: (data.documents ?? []).map(mapDocument) };
  } catch (err) {
    // SDK/네트워크 원문을 그대로 보여주지 않는다 — 소셜 로그인에서와 같은 이유로,
    // 사용자에게는 원인만 짧게 알리고 진단은 로그로 남긴다.
    console.warn(
      `[places] search failed: name=${err instanceof Error ? err.name : typeof err} ` +
        `rawLen=${String(err instanceof Error ? err.message : err).length}`
    );
    return { status: 'error', message: '장소 검색에 실패했어요.\n네트워크 연결을 확인해주세요.' };
  }
}
