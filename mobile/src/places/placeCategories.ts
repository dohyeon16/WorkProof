export interface PlaceCategoryChip {
  label: string;
  mode: 'category' | 'keyword';
  value: string; // category_group_code(카카오 분류 코드) 또는 검색어
}

// 카카오 로컬 API의 category_group_code로 검색 가능한 업종은 code를 쓰고,
// 코드가 없는 업종(PC방/술집 등)은 keyword 검색으로 대체한다.
export const PLACE_CATEGORY_CHIPS: PlaceCategoryChip[] = [
  { label: '음식점', mode: 'category', value: 'FD6' },
  { label: '카페', mode: 'category', value: 'CE7' },
  { label: '편의점', mode: 'category', value: 'CS2' },
  { label: 'PC방', mode: 'keyword', value: 'PC방' },
  { label: '술집', mode: 'keyword', value: '술집' },
  { label: '마트', mode: 'category', value: 'MT1' },
  { label: '주유소', mode: 'category', value: 'OL7' },
  { label: '학원', mode: 'category', value: 'AC5' },
  { label: '병원', mode: 'category', value: 'HP8' },
  { label: '문화시설', mode: 'category', value: 'CT1' },
];
