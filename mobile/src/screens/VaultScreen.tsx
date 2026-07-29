import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../shared/components/Text';
import { FieldInput } from '../shared/components/FieldInput';
import { Alert } from '../shared/components/alert';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import type { MainTabScreenProps } from '../app/navigation/types';
import {
  addEvidenceFile,
  deleteEvidenceFile,
  getActiveOrFirstWorkplace,
  getEvidenceByWorkplace,
  makeId,
  renameEvidenceFile,
  updateEvidenceAnalysis,
} from '../core/data/storage';
import { EvidenceFile, EvidenceKind, Workplace } from '../core/domain/models/types';
import { colors, radius, shadow, spacing } from '../shared/theme';
import { LoadingScreen } from '../shared/components/LoadingScreen';
import { openStoredUriInNewTab, shareStoredUri } from '../shared/utils/webOpen';
import { analyzeEvidenceFile, maskFileName, mimeTypeForKind } from '../ai/analyzeContract';
import { FILE_UNREADABLE_MESSAGE } from '../ocr/visionOcr';
import { persistPickedFile, resolveReadableUri } from '../shared/utils/fileStore';

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

/** OCR에 넘길 MIME 타입을 정한다 — 저장된 mimeType 우선, 없으면 kind/파일명으로 추정. */
function resolveMimeType(item: EvidenceFile): string {
  return item.mimeType ?? mimeTypeForKind(item.kind, item.name);
}

/**
 * AI 분석(OCR)이 가능한 파일인지 판단한다. 이미지/PDF만 가능하며, 리포트 HTML처럼
 * OCR이 불가능한 형식은 제외한다. 구버전 데이터(mimeType 없음)는 kind로 판단한다.
 */
function isAnalyzable(item: EvidenceFile): boolean {
  const mime = item.mimeType ?? '';
  const isHtml =
    mime === 'text/html' ||
    item.uri.startsWith('data:text/html') ||
    item.name.toLowerCase().endsWith('.html');
  if (isHtml) return false;
  if (mime) return mime.startsWith('image/') || mime === 'application/pdf';
  return item.kind === 'image' || item.kind === 'pdf';
}

/** URI에서 스킴만 뽑는다(로그용). */
function schemeOf(uri?: string): string {
  if (!uri) return '(none)';
  const i = uri.indexOf(':');
  return i > 0 ? uri.slice(0, i) : '(none)';
}

/** 파일 추가 실패 진단 로그. 파일 내용(base64)·키는 절대 남기지 않는다. */
function logPickFailure(
  context: string,
  info: {
    canceled: boolean;
    assetCount: number;
    name?: string;
    mimeType?: string;
    originalUri?: string;
    persistedUri?: string;
    size?: number | null;
    error: unknown;
  }
) {
  const err = info.error;
  // 개인정보/파일 데이터 노출 방지: URI 본문·앞부분·실제 경로·원본 파일명·base64는
  // 절대 남기지 않는다. 스킴/길이/마스킹된 이름 등 진단에 필요한 최소 정보만 기록한다.
  console.warn(`[Vault] ${context} 실패`, {
    platform: Platform.OS,
    canceled: info.canceled,
    assetCount: info.assetCount,
    fileName: info.name ? maskFileName(info.name) : '(none)',
    mimeType: info.mimeType,
    fileSize: info.size ?? null,
    // data:/blob:/file:/content:/idb: 등 스킴만 구분해 남긴다(경로·내용 제외).
    uriScheme: schemeOf(info.originalUri),
    uriLength: info.originalUri?.length ?? 0,
    persistedScheme: schemeOf(info.persistedUri),
    error: err instanceof Error ? err.message : String(err),
  });
}

function formatAnalyzedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.toLocaleDateString('ko-KR')} ${d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** "열기" — 미리보기 목적. 웹에서는 새 탭으로 연다. */
async function openFile(item: EvidenceFile) {
  if (Platform.OS === 'web') {
    // 저장된 URI(idb:// 참조 등)를 실제로 열 수 있는 data: URI로 되돌린다.
    const uri = await resolveReadableUri(item.uri);
    if (!uri) {
      Alert.alert('원본 파일 없음', FILE_UNREADABLE_MESSAGE);
      return;
    }
    const opened = openStoredUriInNewTab(uri);
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
    const uri = await resolveReadableUri(item.uri);
    if (!uri) {
      Alert.alert('원본 파일 없음', FILE_UNREADABLE_MESSAGE);
      return;
    }
    const result = await shareStoredUri(uri, item.name);
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
  // 같은 파일 분석이 동시에 두 번 실행되지 않도록 막는 락(모달로도 막히지만 이중 안전장치).
  const analyzingRef = useRef(false);

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
    // 웹에서는 권한 요청을 await하면 파일 다이얼로그가 user-gesture를 잃어 안 열릴 수
    // 있으므로(웹은 권한 개념이 없어 항상 granted) 곧바로 선택기를 연다.
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('사진 접근 권한이 필요해요');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      base64: Platform.OS === 'web',
    });
    if (result.canceled || !result.assets?.[0]) return; // 취소 시 조용히 반환(오류 팝업 없음)
    const asset = result.assets[0];
    const mimeType = asset.mimeType ?? 'image/jpeg';
    const name = asset.fileName ?? `사진_${Date.now()}.jpg`;
    let persistedUri: string | undefined;
    try {
      // 선택기의 임시 URI(웹 blob / 네이티브 cache)를 영구 저장소로 옮긴 URI를 저장한다.
      persistedUri = await persistPickedFile({ uri: asset.uri, name, mimeType, base64: asset.base64 });
      await addEvidenceFile({
        id: makeId(),
        workplaceId,
        name,
        uri: persistedUri,
        kind: 'image',
        mimeType,
        size: asset.fileSize ?? null,
        addedAt: new Date().toISOString(),
      });
      await load(); // 목록 즉시 갱신
    } catch (e) {
      logPickFailure('사진 추가', {
        canceled: result.canceled,
        assetCount: result.assets?.length ?? 0,
        name,
        mimeType,
        originalUri: asset.uri,
        persistedUri,
        size: asset.fileSize ?? null,
        error: e,
      });
      Alert.alert('사진을 추가하지 못했어요', '다시 시도해주세요.');
    }
  };

  const pickDocument = async (workplaceId: string) => {
    // 이미지(jpg/jpeg/png/heic)와 PDF만 받는다. (그 외 형식은 OCR 대상이 아님)
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
      base64: Platform.OS === 'web',
    });
    if (result.canceled || !result.assets?.[0]) return; // 취소 시 조용히 반환(오류 팝업 없음)
    const asset = result.assets[0];
    // MIME이 없으면 확장자로 보완한다.
    const isPdf = !!asset.mimeType?.includes('pdf') || asset.name.toLowerCase().endsWith('.pdf');
    const kind: EvidenceKind = isPdf ? 'pdf' : 'image';
    const mimeType = asset.mimeType ?? (isPdf ? 'application/pdf' : 'image/jpeg');
    let persistedUri: string | undefined;
    try {
      persistedUri = await persistPickedFile({ uri: asset.uri, name: asset.name, mimeType, base64: asset.base64 });
      await addEvidenceFile({
        id: makeId(),
        workplaceId,
        name: asset.name,
        uri: persistedUri,
        kind,
        mimeType,
        size: asset.size ?? null,
        addedAt: new Date().toISOString(),
      });
      await load(); // 목록 즉시 갱신
    } catch (e) {
      logPickFailure('파일 추가', {
        canceled: result.canceled,
        assetCount: result.assets?.length ?? 0,
        name: asset.name,
        mimeType,
        originalUri: asset.uri,
        persistedUri,
        size: asset.size ?? null,
        error: e,
      });
      Alert.alert('파일을 추가하지 못했어요', '다시 시도해주세요.');
    }
  };

  const handleAdd = () => {
    if (!workplace) return;
    Alert.alert('증빙 자료 추가', undefined, [
      { text: '사진 선택', onPress: () => pickImage(workplace.id) },
      { text: '파일 선택', onPress: () => pickDocument(workplace.id) },
      { text: '취소', style: 'cancel' },
    ]);
  };

  const handleOpen = async (item: EvidenceFile) => {
    if (item.kind === 'image') {
      // 저장된 URI(idb:// 참조 등)를 <Image>가 렌더할 수 있는 형태로 되돌린다.
      const uri = await resolveReadableUri(item.uri);
      if (!uri) {
        Alert.alert('원본 파일 없음', FILE_UNREADABLE_MESSAGE);
        return;
      }
      setPreviewImage(uri);
      return;
    }
    openFile(item);
  };

  // 이미지/PDF 증빙을 OCR로 읽어 AI 요약까지 만들어 저장한다.
  // 근무지 등록 화면과 동일한 공용 파이프라인(analyzeEvidenceFile)을 사용한다.
  const runAnalysis = async (item: EvidenceFile) => {
    if (!isAnalyzable(item)) {
      Alert.alert('분석할 수 없는 형식', '이미지 또는 PDF 파일만 텍스트를 인식할 수 있어요.');
      return;
    }
    if (analyzingRef.current) return; // 중복 분석 방지
    analyzingRef.current = true;
    setAnalyzingName(item.name);
    try {
      const result = await analyzeEvidenceFile({
        uri: item.uri,
        name: item.name,
        mimeType: resolveMimeType(item),
        size: item.size,
        logContext: { screen: 'Vault' },
      });

      if (result.errorCode === 'OCR_NOT_CONFIGURED') {
        Alert.alert('OCR 준비 중', 'Google Cloud Vision 키가 설정되지 않았어요. mobile/OAUTH_SETUP.md를 참고해주세요.');
        return;
      }
      if (result.status === 'error') {
        // 만료된 URI 등 파일을 못 읽는 경우는 별도 안내(다시 추가 유도).
        const isMissing = result.errorCode === 'FILE_NOT_READY';
        Alert.alert(
          isMissing ? '원본 파일 없음' : '텍스트 추출 실패',
          isMissing
            ? FILE_UNREADABLE_MESSAGE
            : '계약서 내용을 인식하지 못했어요. 사진 상태를 확인하고 다시 시도해주세요.'
        );
        return;
      }

      // ocr_only 또는 success: 추출된 텍스트는 반드시 저장한다(요약 실패해도 보존).
      // 보관함에서 직접 분석한 파일은 계약서로 단정하지 않는다 — documentType은
      // 근무지 등록에서 첨부한 실제 근로계약서에만 붙인다(WorkplaceFormScreen).
      if (!result.ocrText || !result.analyzedAt) return; // 방어(여기 도달 시 항상 존재)
      const analysis: { ocrText: string; analyzedAt: string; aiSummary?: string } = {
        ocrText: result.ocrText,
        analyzedAt: result.analyzedAt,
      };
      // 요약 성공 시에만 갱신 — 재분석에서 요약만 실패하면 기존 요약을 지우지 않는다.
      if (result.aiSummary) analysis.aiSummary = result.aiSummary;
      await updateEvidenceAnalysis(item.id, analysis);
      await load();
      setSummaryTarget({ ...item, ...analysis });

      // 요청당 최대 1회만 안내(재시도는 내부에서 조용히 처리됨).
      if (result.errorCode === 'SUMMARY_NOT_CONFIGURED') {
        Alert.alert('AI 요약 준비 중', 'Gemini API 키가 설정되지 않아 텍스트만 추출했어요.');
      } else if (result.status === 'ocr_only') {
        Alert.alert('AI 요약 실패', '인식된 계약서 텍스트는 저장했어요. AI 요약은 잠시 후 다시 시도해주세요.');
      }
    } finally {
      analyzingRef.current = false;
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
    // 파일명이 아니라 저장된 형식/분석 결과로 판단한다. OCR이 불가능한 형식
    // (리포트 HTML 등)에는 AI 메뉴를 아예 넣지 않는다.
    const aiActions: { text: string; onPress: () => void }[] = [];
    if (isAnalyzable(item)) {
      if (item.aiSummary) {
        // 분석 성공: 요약 보기 + 다시 분석하기
        aiActions.push({ text: 'AI 요약 보기', onPress: () => setSummaryTarget(item) });
        aiActions.push({ text: '다시 분석하기', onPress: () => runAnalysis(item) });
      } else if (item.ocrText) {
        // OCR은 됐지만 요약 실패: 인식된 텍스트 보기 + 다시 분석하기
        aiActions.push({ text: '인식된 텍스트 보기', onPress: () => setSummaryTarget(item) });
        aiActions.push({ text: '다시 분석하기', onPress: () => runAnalysis(item) });
      } else {
        // 분석 전
        aiActions.push({ text: 'AI로 분석하기', onPress: () => runAnalysis(item) });
      }
    }
    Alert.alert(item.name, undefined, [
      { text: '열기', onPress: () => handleOpen(item) },
      ...aiActions,
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
            {item.aiSummary ? (
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
                  AI 분석 결과
                </Text>
              </View>
              <Pressable
                onPress={() => setSummaryTarget(null)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="닫기"
              >
                <Ionicons name="close" size={22} color={colors.subtext} />
              </Pressable>
            </View>
            {formatAnalyzedAt(summaryTarget?.analyzedAt) ? (
              <Text style={styles.summaryModalAnalyzedAt}>
                분석 일시: {formatAnalyzedAt(summaryTarget?.analyzedAt)}
              </Text>
            ) : null}
            <ScrollView style={styles.summaryModalScroll}>
              <Text style={styles.summaryModalSectionLabel}>AI 요약</Text>
              {summaryTarget?.aiSummary ? (
                <Text style={styles.summaryModalText}>{summaryTarget.aiSummary}</Text>
              ) : (
                <Text style={styles.summaryModalEmpty}>
                  아직 요약이 없어요. 아래에서 다시 시도해주세요.
                </Text>
              )}
              {summaryTarget?.ocrText ? (
                <>
                  <Text style={styles.summaryModalSectionLabel}>인식된 계약서 텍스트</Text>
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
  summaryModalAnalyzedAt: { fontSize: 11, color: colors.subtext, marginBottom: spacing.xs },
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
