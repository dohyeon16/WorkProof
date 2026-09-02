export interface PlaceResult {
  id: string;
  name: string;
  category: string; // 예: "음식점 > 한식"
  address: string; // 도로명 주소 우선, 없으면 지번 주소
  latitude: number;
  longitude: number;
  distanceMeters?: number;
}

export type PlaceSearchParams =
  | { mode: 'keyword'; query: string; latitude: number; longitude: number }
  | { mode: 'category'; categoryCode: string; latitude: number; longitude: number };

export type PlaceSearchResult =
  | { status: 'success'; places: PlaceResult[] }
  | { status: 'not_configured' }
  | { status: 'error'; message: string };
