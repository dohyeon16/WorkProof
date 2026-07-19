import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { FieldInput } from '../components/FieldInput';
import { Alert } from '../alert';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import type { MainTabScreenProps } from '../navigation/types';
import {
  addEvidenceFile,
  deleteEvidenceFile,
  getActiveOrFirstWorkplace,
  getEvidenceByWorkplace,
  makeId,
  renameEvidenceFile,
  updateEvidenceAnalysis,
} from '../storage';
import { EvidenceFile, EvidenceKind, Workplace } from '../types';
import { colors, radius, shadow, spacing } from '../theme';
import { LoadingScreen } from '../components/LoadingScreen';
import { openStoredUriInNewTab, shareStoredUri } from '../utils/webOpen';
import { analyzeContract, mimeTypeForKind } from '../ai/analyzeContract';

type Props = MainTabScreenProps<'Vault'>;

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function iconFor(kind: EvidenceKind): keyof typeof Ionicons.glyphMap {
  if (kind === 'image') return 'image-outline';
  if (kind === 'pdf') return 'document-text-outline';
  return 'document-outline';
}

/** "열기" — 미리보기 목적. 웹에서는 새 탭으로 연다. */
async function openFile(item: EvidenceFile) {
  if (Platform.OS === 'web') {
    const opened = openStoredUriInNewTab(item.uri);
    if (!opened) {
      Alert.alert('파일을 열 수 없어요', '팝업 차단을 해제한 뒤 다시 시도해주세요.');
    }
    return;
  }
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(item.uri);
    return;
  }
  try {
    await Linking.openURL(item.uri);
  } catch {
    Alert.alert('파일을 열 수 없어요', '이 환경에서는 파일 미리보기를 지원하지 않아요.');
  }
}

/** "공유하기" — 실제로 다른 곳에 보낼 수 있어야 한다. 웹에서는 Web Share API(파일 공유)를 먼저 시도하고,
 *  지원하지 않으면 실제 파일 다운로드로 대체한다(새 탭 미리보기만 뜨는 건 "열기"와 다를 게 없어서 안 됨). */
async function shareFile(item: EvidenceFile) {
  if (Platform.OS === 'web') {
    const result = await shareStoredUri(item.uri, item.name);
    if (result === 'downloaded') {
      Alert.alert('파일을 다운로드했어요', '다운로드된 파일로 원하는 곳에 공유할 수 있어요.');
    } else if (result === 'failed') {
      Alert.alert('공유할 수 없어요', '이 브라우저에서는 지원하지 않아요.');
    }
    return;
  }
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(item.uri);
    return;
  }
  try {
    await Linking.openURL(item.uri);
  } catch {
    Alert.alert('공유할 수 없어요', '이 환경에서는 파일 공유를 지원하지 않아요.');
  }
}

export default function VaultScreen(_props: Props) {
  const insets = useSafeAreaInsets();
  const [workplace, setWorkplace] = useState<Workplace | null | undefined>(undefined);
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<EvidenceFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [analyzingName, setAnalyzingName] = useState<string | null>(null);
  const [summaryTarget, setSummaryTarget] = useState<EvidenceFile | null>(null);

  const load = useCallback(async () => {
    const w = await getActiveOrFirstWorkplace();
    setWorkplace(w ?? null);
    if (!w) return;
    setFiles(await getEvidenceByWorkplace(w.id));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const pickImage = async (workplaceId: string) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('사진 접근 권한이 필요해요');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: Platform.OS === 'web',
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    // On web, asset.uri is a blob: URL that dies once the tab/session ends — a data: URI
    // (built from the raw base64 payload) is what actually survives a reload.
    const uri =
      Platform.OS === 'web' && asset.base64
        ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
        : asset.uri;
    await addEvidenceFile({
      id: makeId(),
      workplaceId,
      name: asset.fileName ?? `사진_${Date.now()}.jpg`,
      uri,
      kind: 'image',
      size: asset.fileSize ?? null,
      addedAt: new Date().toISOString(),
    });
    load();
  };

  const pickDocument = async (workplaceId: string) => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      base64: Platform.OS === 'web',
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const kind: EvidenceKind = asset.mimeType?.includes('pdf') ? 'pdf' : 'file';
    // DocumentPicker's web asset.uri is always a blob: URL, even with base64 requested —
    // asset.base64 is the one that's a real (persistable) data: URI there.
    const uri = Platform.OS === 'web' && asset.base64 ? asset.base64 : asset.uri;
    await addEvidenceFile({
      id: makeId(),
      workplaceId,
      name: asset.name,
      uri,
      kind,
      size: asset.size ?? null,
      addedAt: new Date().toISOString(),
    });
    load();
  };

  const handleAdd = () => {
    if (!workplace) return;
    Alert.alert('증빙 자료 추가', undefined, [
      { text: '사진 선택', onPress: () => pickImage(workplace.id) },
      { text: '파일 선택', onPress: () => pickDocument(workplace.id) },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const handleOpen = (item: EvidenceFile) => {
    if (item.kind === 'image') {
      setPreviewImage(item.uri);
      return;
    }
    openFile(item);
  };

  // 이미지/PDF 증빙을 OCR로 읽어 AI 요약까지 만들어 저장한다.
  const runAnalysis = async (item: EvidenceFile) => {
    if (item.kind === 'file') {
      Alert.alert('분석할 수 없는 형식', '이미지 또는 PDF 파일만 텍스트를 인식할 수 있어요.');
      return;
    }
    setAnalyzingName(item.name);
    try {
      const result = await analyzeContract(item.uri, mimeTypeForKind(item.kind, item.name));
      if (result.status === 'ocr_not_configured') {
        Alert.alert('OCR 준비 중', 'Google Cloud Vision 키가 설정되지 않았어요. mobile/OAUTH_SETUP.md를 참고해주세요.');
        return;
      }
      if (result.status === 'ocr_error') {
        Alert.alert('텍스트 추출 실패', result.message);
        return;
      }
      // 요약이 실패해도 추출된 텍스트는 저장해 다시 시도할 수 있게 한다.
      const summary = result.status === 'success' ? result.summary : undefined;
      await updateEvidenceAnalysis(item.id, { ocrText: result.ocrText, summary });
      await load();
      const updated: EvidenceFile = { ...item, ocrText: result.ocrText, summary };
      setSummaryTarget(updated);
      if (result.status === 'summary_not_configured') {
        Alert.alert('AI 요약 준비 중', 'Gemini API 키가 설정되지 않아 텍스트만 추출했어요.');
      } else if (result.status === 'summary_error') {
        Alert.alert('AI 요약 실패', result.message);
      }
    } finally {
      setAnalyzingName(null);
    }
  };

  const handleDelete = (id: string) => {
    Alert.alert('파일 삭제', '이 파일을 삭제할까요?', [
      { text: '삭제', style: 'destructive', onPress: async () => { await deleteEvidenceFile(id); load(); } },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const startRename = (item: EvidenceFile) => {
    setRenameValue(item.name);
    setRenaming(item);
  };

  const confirmRename = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) {
      Alert.alert('이름을 입력해주세요.');
      return;
    }
    await renameEvidenceFile(renaming.id, name);
    setRenaming(null);
    load();
  };

  const handleMenu = (item: EvidenceFile) => {
    const canAnalyze = item.kind === 'image' || item.kind === 'pdf';
    const analyzeAction = item.summary
      ? { text: 'AI 요약 보기', onPress: () => setSummaryTarget(item) }
      : { text: 'AI로 분석·요약', onPress: () => runAnalysis(item) };
    Alert.alert(item.name, undefined, [
      { text: '열기', onPress: () => handleOpen(item) },
      ...(canAnalyze ? [analyzeAction] : []),
      { text: '이름 변경', onPress: () => startRename(item) },
      { text: '공유하기', onPress: () => shareFile(item) },
      { text: '삭제', style: 'destructive', onPress: () => handleDelete(item.id) },
      { text: '취소', style: 'cancel' },
    ]);
  };

  if (workplace === undefined) return <LoadingScreen />;

  if (workplace === null) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIconCircle}>
          <Ionicons name="folder-outline" size={32} color={colors.primary} />
        </View>
        <Text style={styles.emptyTitle}>등록된 근무지가 없어요</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={files}
        keyExtractor={(f) => f.id}
        numColumns={3}
        contentContainerStyle={[styles.listContent, { paddingTop: insets.top + spacing.md }]}
        ListHeaderComponent={<Text style={styles.title}>증빙 보관함</Text>}
        ListEmptyComponent={
          <View style={styles.emptyListWrap}>
            <Ionicons name="document-attach-outline" size={36} color={colors.subtext} />
            <Text style={styles.empty}>보관된 증빙 자료가 없어요.</Text>
            <Text style={styles.emptySub}>근로계약서, 급여명세서 등을 추가해보세요.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.fileCell}>
            <Pressable
              onPress={() => handleOpen(item)}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} 열기`}
            >
              <View style={styles.fileIconWrap}>
                <Ionicons name={iconFor(item.kind)} size={26} color={colors.primaryDark} />
              </View>
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.fileMeta}>{formatBytes(item.size)}</Text>
            </Pressable>
            {item.summary ? (
              <Pressable
                style={styles.summaryBadge}
                onPress={() => setSummaryTarget(item)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} AI 요약 보기`}
              >
                <Ionicons name="sparkles" size={11} color="#fff" />
              </Pressable>
            ) : null}
            <Pressable
              style={styles.menuButton}
              onPress={() => handleMenu(item)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} 더보기 (AI 분석, 이름 변경, 공유, 삭제)`}
            >
              <Ionicons name="ellipsis-vertical" size={14} color={colors.subtext} />
            </Pressable>
          </View>
        )}
      />
      <View style={styles.fabContainer} pointerEvents="box-none">
        <Pressable
          style={styles.fab}
          onPress={handleAdd}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="증빙 자료 추가"
        >
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      <Modal visible={!!previewImage} transparent animationType="fade" onRequestClose={() => setPreviewImage(null)}>
        <View style={styles.previewBackdrop}>
          <Pressable
            style={styles.previewCloseButton}
            onPress={() => setPreviewImage(null)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="미리보기 닫기"
          >
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
          {previewImage && (
            <Image source={{ uri: previewImage }} style={styles.previewImage} resizeMode="contain" />
          )}
        </View>
      </Modal>

      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <View style={styles.renameBackdrop}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>이름 변경</Text>
            <FieldInput value={renameValue} onChangeText={setRenameValue} placeholder="파일 이름" />
            <View style={styles.renameButtonRow}>
              <Pressable
                style={styles.renameCancelButton}
                onPress={() => setRenaming(null)}
                accessibilityRole="button"
                accessibilityLabel="취소"
              >
                <Text style={styles.renameCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={styles.renameSaveButton}
                onPress={confirmRename}
                accessibilityRole="button"
                accessibilityLabel="저장"
              >
                <Text style={styles.renameSaveText}>저장</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!analyzingName} transparent animationType="fade">
        <View style={styles.analyzingBackdrop}>
          <View style={styles.analyzingCard}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.analyzingText}>계약서를 분석하는 중...</Text>
            <Text style={styles.analyzingSub} numberOfLines={1}>
              {analyzingName}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal
        visible={!!summaryTarget}
        transparent
        animationType="fade"
        onRequestClose={() => setSummaryTarget(null)}
      >
        <View style={styles.summaryBackdrop}>
          <View style={styles.summaryModalCard}>
            <View style={styles.summaryModalHeader}>
              <View style={styles.summaryModalTitleWrap}>
                <Ionicons name="sparkles" size={16} color={colors.primaryDark} />
                <Text style={styles.summaryModalTitle} numberOfLines={1}>
                  AI 요약
                </Text>
              </View>
              <Pressable
                onPress={() => setSummaryTarget(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="요약 닫기"
              >
                <Ionicons name="close" size={22} color={colors.subtext} />
              </Pressable>
            </View>
            <ScrollView style={styles.summaryModalScroll}>
              {summaryTarget?.summary ? (
                <Text style={styles.summaryModalText}>{summaryTarget.summary}</Text>
              ) : (
                <Text style={styles.summaryModalEmpty}>
                  아직 요약이 없어요. 아래에서 다시 시도해주세요.
                </Text>
              )}
              {summaryTarget?.ocrText ? (
                <>
                  <Text style={styles.summaryModalSectionLabel}>인식된 원문</Text>
                  <Text style={styles.summaryModalOcr}>{summaryTarget.ocrText}</Text>
                </>
              ) : null}
            </ScrollView>
            <Pressable
              style={styles.summaryModalRetry}
              onPress={() => {
                const target = summaryTarget;
                if (!target) return;
                setSummaryTarget(null);
                runAnalysis(target);
              }}
              accessibilityRole="button"
              accessibilityLabel="다시 분석하기"
            >
              <Ionicons name="refresh-outline" size={14} color="#fff" />
              <Text style={styles.summaryModalRetryText}>다시 분석하기</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, position: 'relative' },
  listContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md, width: '100%' },
  emptyListWrap: { width: '100%', alignItems: 'center', marginTop: spacing.xl, gap: 4 },
  empty: { color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  emptySub: { color: colors.subtext, fontSize: 12, textAlign: 'center' },
  fileCell: { width: '33%', alignItems: 'center', padding: spacing.xs, marginBottom: spacing.sm },
  fileIconWrap: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButton: {
    position: 'absolute',
    top: -6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryBadge: {
    position: 'absolute',
    top: -6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: { fontSize: 11, color: colors.text, marginTop: spacing.xs, maxWidth: 90 },
  fileMeta: { fontSize: 10, color: colors.subtext, marginTop: 1 },
  fabContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.lg,
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
  },
  fab: {
    backgroundColor: colors.primary,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewCloseButton: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.md,
    zIndex: 1,
    padding: spacing.xs,
  },
  previewImage: { width: '100%', height: '80%' },
  renameBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  renameCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  renameTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  renameButtonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  renameCancelButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  renameCancelText: { color: colors.subtext, fontWeight: '700', fontSize: 14 },
  renameSaveButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  renameSaveText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  analyzingBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  analyzingCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 280,
  },
  analyzingText: { fontSize: 14, fontWeight: '700', color: colors.text },
  analyzingSub: { fontSize: 12, color: colors.subtext, maxWidth: 200 },
  summaryBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  summaryModalCard: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  summaryModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  summaryModalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  summaryModalTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  summaryModalScroll: { flexGrow: 0 },
  summaryModalText: { fontSize: 13, color: colors.text, lineHeight: 20 },
  summaryModalEmpty: { fontSize: 13, color: colors.subtext, lineHeight: 20 },
  summaryModalSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.subtext,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  summaryModalOcr: { fontSize: 12, color: colors.subtext, lineHeight: 18 },
  summaryModalRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  summaryModalRetryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
