import type { PlaceResult, PlaceSearchParams, PlaceSearchResult } from './place.types';

// 카카오 로컬 REST API는 브라우저 CORS를 지원하지 않아 직접 fetch로 부를 수
// 없다. 대신 브라우저에서 바로 쓰도록 만들어진 카카오맵 JavaScript SDK(로그인용
// REST API 키와는 별도의 "JavaScript 키" 필요, mobile/docs/OAUTH_SETUP.md 참고)를 스크립트로
// 불러와 kakao.maps.services.Places로 검색한다.
const KAKAO_JS_KEY = (process.env.EXPO_PUBLIC_KAKAO_JS_KEY ?? '').trim();
const SDK_SRC = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_JS_KEY}&libraries=services&autoload=false`;

interface KakaoPlaceDocument {
  id: string;
  place_name: string;
  category_name?: string;
  road_address_name?: string;
  address_name?: string;
  x: string;
  y: string;
  distance?: string;
}

interface KakaoPlaces {
  keywordSearch: (
    query: string,
    callback: (data: KakaoPlaceDocument[], status: string) => void,
    options: Record<string, unknown>
  ) => void;
  categorySearch: (
    code: string,
    callback: (data: KakaoPlaceDocument[], status: string) => void,
    options: Record<string, unknown>
  ) => void;
}

interface KakaoMapsGlobal {
  load: (callback: () => void) => void;
  LatLng: new (lat: number, lng: number) => unknown;
  services: {
    Places: new () => KakaoPlaces;
    Status: { OK: string; ZERO_RESULT: string };
    SortBy: { DISTANCE: string };
  };
}

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsGlobal };
  }
}

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.kakao?.maps?.services) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.onload = () => {
      if (!window.kakao) {
        reject(new Error('장소 검색 SDK를 불러오지 못했어요.'));
        return;
      }
      window.kakao.maps.load(() => resolve());
    };
    script.onerror = () => reject(new Error('장소 검색 SDK를 불러오지 못했어요.'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function mapDocument(doc: KakaoPlaceDocument): PlaceResult {
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
  if (!KAKAO_JS_KEY) {
    return { status: 'not_configured' };
  }
  try {
    await loadSdk();
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const kakao = window.kakao;
  if (!kakao?.maps?.services) {
    return { status: 'error', message: '장소 검색 SDK를 초기화하지 못했어요.' };
  }

  const places = new kakao.maps.services.Places();
  const options = {
    location: new kakao.maps.LatLng(params.latitude, params.longitude),
    radius: 20000,
    sort: kakao.maps.services.SortBy.DISTANCE,
  };

  return new Promise<PlaceSearchResult>((resolve) => {
    const callback = (data: KakaoPlaceDocument[], status: string) => {
      if (status === kakao.maps.services.Status.OK) {
        resolve({ status: 'success', places: data.map(mapDocument) });
      } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
        resolve({ status: 'success', places: [] });
      } else {
        resolve({ status: 'error', message: '장소 검색에 실패했어요.' });
      }
    };
    if (params.mode === 'category') {
      places.categorySearch(params.categoryCode, callback, options);
    } else {
      places.keywordSearch(params.query, callback, options);
    }
  });
}
