import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../shared/components/Text';
import { TextInput } from '../shared/components/TextInput';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Alert } from '../shared/components/alert';
import type { RootScreenProps } from '../app/navigation/types';
import { colors, radius, shadow, spacing } from '../shared/theme';
import LocationMapPicker from '../components/LocationMapPicker';
import { searchPlaces } from '../places/kakaoPlaces';
import { PLACE_CATEGORY_CHIPS } from '../places/placeCategories';
import type { PlaceResult } from '../places/types';

type Props = RootScreenProps<'WorkplacePlacePicker'>;

// 검색 기준 위치를 아직 모를 때(현재 위치 권한이 없거나 실패했을 때) 쓸 기본값.
const DEFAULT_CENTER = { latitude: 37.5665, longitude: 126.978 }; // 서울시청

function formatDistance(meters?: number): string | null {
  if (meters == null) return null;
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

export default function WorkplacePlacePickerScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const hasKnownCenter = route.params?.latitude != null && route.params?.longitude != null;
  const [center, setCenter] = useState(
    hasKnownCenter
      ? { latitude: route.params.latitude as number, longitude: route.params.longitude as number }
      : DEFAULT_CENTER
  );
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PlaceResult | null>(null);
  const chipScrollRef = useRef<ScrollView>(null);
  const chipScrollOffset = useRef(0);

  // 웹은 마우스 휠이 기본적으로 세로로만 스크롤되어, 가로 칩 목록이 휠로는
  // 안 움직인다. 세로 휠 델타를 가로 스크롤로 변환해준다(네이티브에서는
  // onWheel 자체가 발생하지 않으므로 영향 없음).
  const handleChipWheel =
    Platform.OS === 'web'
      ? (event: { deltaX: number; deltaY: number; preventDefault: () => void }) => {
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          event.preventDefault();
          chipScrollOffset.current = Math.max(0, chipScrollOffset.current + event.deltaY);
          chipScrollRef.current?.scrollTo({ x: chipScrollOffset.current, animated: false });
        }
      : undefined;

  useEffect(() => {
    // 이미 알고 있는 위치(수정 중인 근무지)가 있으면 그 근처를 기준으로 검색하고,
    // 없을 때만 현재 위치를 조용히 가져와 기준으로 삼는다. 실패해도 기본
    // 좌표로 검색은 계속 가능하다.
    if (hasKnownCenter) return;
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) return;
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCenter({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      } catch {
        // 무시하고 기본 좌표로 검색을 진행한다.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runSearch = async (search: { mode: 'keyword'; query: string } | { mode: 'category'; categoryCode: string }) => {
    setSearching(true);
    setSelected(null);
    try {
      const result = await searchPlaces(
        search.mode === 'category'
          ? { mode: 'category', categoryCode: search.categoryCode, latitude: center.latitude, longitude: center.longitude }
          : { mode: 'keyword', query: search.query, latitude: center.latitude, longitude: center.longitude }
      );
      if (result.status === 'not_configured') {
        Alert.alert(
          '장소 검색 준비 중',
          '아직 카카오맵 키가 설정되지 않았어요. mobile/OAUTH_SETUP.md 안내를 참고해 키를 등록해주세요.'
        );
        return;
      }
      if (result.status === 'error') {
        Alert.alert('장소 검색 실패', result.message);
        return;
      }
      setSearched(true);
      setResults(result.places);
    } finally {
      setSearching(false);
    }
  };

  const handleSearchSubmit = () => {
    const q = queryText.trim();
    if (!q) return;
    runSearch({ mode: 'keyword', query: q });
  };

  const handleConfirm = () => {
    if (!selected) return;
    // navigate()는 React Navigation 7부터 같은 이름의 화면이 스택에 있어도
    // 그 화면으로 돌아가지 않고 새 인스턴스를 push한다(기존 폼 상태가 새
    // 화면에 반영되지 않고 그대로 남아 뒤로가기가 꼬인다). popTo + merge로
    // 원래 WorkplaceForm 인스턴스로 돌아가 값만 합쳐야 한다.
    navigation.popTo(
      'WorkplaceForm',
      {
        pickedLatitude: selected.latitude,
        pickedLongitude: selected.longitude,
        pickedAddress: selected.address,
        pickedName: selected.name,
      },
      { merge: true }
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm + 2 }]}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="닫기"
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>근무지 선택</Text>
        <View style={{ width: 24 }} />
      </View>

      {selected ? (
        <>
          <View style={styles.mapWrap}>
            <LocationMapPicker
              latitude={selected.latitude}
              longitude={selected.longitude}
              onSelect={(lat, lng) => setSelected((s) => (s ? { ...s, latitude: lat, longitude: lng } : s))}
            />
          </View>
          <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
            <Pressable
              onPress={() => setSelected(null)}
              accessibilityRole="button"
              accessibilityLabel="다시 검색"
              style={styles.backToSearch}
            >
              <Ionicons name="arrow-back" size={14} color={colors.subtext} />
              <Text style={styles.backToSearchText}>다시 검색</Text>
            </Pressable>
            <Text style={styles.selectedName}>{selected.name}</Text>
            {!!selected.category && <Text style={styles.selectedCategory}>{selected.category}</Text>}
            <Text style={styles.selectedAddress}>{selected.address || '주소 정보 없음'}</Text>
            <Text style={styles.help}>정확한 위치가 다르면 지도를 탭하거나 핀을 드래그해서 조정하세요.</Text>
            <Pressable
              style={styles.confirmButton}
              onPress={handleConfirm}
              accessibilityRole="button"
              accessibilityLabel="이 장소로 등록"
            >
              <Text style={styles.confirmButtonText}>이 장소로 등록</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={colors.subtext} />
            <TextInput
              style={styles.searchInput}
              placeholder="상호명으로 검색 (예: 스타벅스 강남점)"
              placeholderTextColor={colors.subtext}
              value={queryText}
              onChangeText={setQueryText}
              onSubmitEditing={handleSearchSubmit}
              returnKeyType="search"
              autoCapitalize="none"
            />
          </View>

          <ScrollView
            ref={chipScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
            style={styles.chipScroll}
            onScroll={(e) => {
              chipScrollOffset.current = e.nativeEvent.contentOffset.x;
            }}
            scrollEventThrottle={32}
            {...(handleChipWheel ? ({ onWheel: handleChipWheel } as object) : {})}
          >
            {PLACE_CATEGORY_CHIPS.map((chip) => (
              <Pressable
                key={chip.label}
                style={styles.chip}
                onPress={() => {
                  setQueryText('');
                  runSearch(
                    chip.mode === 'category'
                      ? { mode: 'category', categoryCode: chip.value }
                      : { mode: 'keyword', query: chip.value }
                  );
                }}
                accessibilityRole="button"
                accessibilityLabel={`${chip.label} 검색`}
              >
                <Text style={styles.chipText}>{chip.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.resultsWrap}>
            {searching ? (
              <View style={styles.centerFill}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : !searched ? (
              <View style={styles.centerFill}>
                <Ionicons name="business-outline" size={32} color={colors.subtext} />
                <Text style={styles.emptyText}>업종을 고르거나 상호명을 검색해보세요.</Text>
              </View>
            ) : results.length === 0 ? (
              <View style={styles.centerFill}>
                <Text style={styles.emptyText}>검색 결과가 없어요.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={styles.resultsList}>
                {results.map((place) => (
                  <Pressable
                    key={place.id}
                    style={styles.resultRow}
                    onPress={() => setSelected(place)}
                    accessibilityRole="button"
                    accessibilityLabel={`${place.name} 선택`}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultName}>{place.name}</Text>
                      <Text style={styles.resultMeta} numberOfLines={1}>
                        {[place.category, place.address].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {formatDistance(place.distanceMeters) && (
                      <Text style={styles.resultDistance}>{formatDistance(place.distanceMeters)}</Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    margin: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
  },
  searchInput: { flex: 1, paddingVertical: spacing.sm + 4, fontSize: 15, color: colors.text },
  chipScroll: { flexGrow: 0 },
  chipRow: { paddingHorizontal: spacing.md, gap: spacing.xs, paddingBottom: spacing.sm },
  chip: {
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  resultsWrap: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  emptyText: { fontSize: 13, color: colors.subtext, textAlign: 'center' },
  resultsList: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultName: { fontSize: 14, fontWeight: '700', color: colors.text },
  resultMeta: { fontSize: 12, color: colors.subtext, marginTop: 2 },
  resultDistance: { fontSize: 12, color: colors.subtext },
  mapWrap: { flex: 1 },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  backToSearch: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: spacing.xs, alignSelf: 'flex-start' },
  backToSearchText: { fontSize: 12, color: colors.subtext, fontWeight: '600' },
  selectedName: { fontSize: 15, fontWeight: '800', color: colors.text },
  selectedCategory: { fontSize: 12, color: colors.primaryDark, marginTop: 2 },
  selectedAddress: { fontSize: 13, color: colors.subtext, marginTop: 2 },
  help: { fontSize: 12, color: colors.subtext, marginTop: spacing.xs, marginBottom: spacing.sm },
  confirmButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    ...shadow.card,
  },
  confirmButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
