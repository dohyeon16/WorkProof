import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Text } from '../../../shared/components/Text';
import { Alert } from '../../../shared/components/alert';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';
import type { RootScreenProps } from '../../../app/navigation/types';
import {
  addEvidenceFile,
  getPayslipsByWorkplace,
  getWorkplace,
  makeId,
} from '../../../core/data/storage';
import { EvidenceKind, PayslipRecord, Workplace } from '../../../core/domain/models/types';
import { formatWon } from '../../../core/domain/payroll/payCalc';
import { currentYearMonth, formatYearMonth } from '../../../shared/utils/date';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import { persistPickedFile } from '../../../shared/utils/fileStore';
import { useAiAnalysis } from '../../evidence/services/ai/useAiAnalysis';
import { analyzePayslipFile } from '../services/analyzePayslip';

type Props = RootScreenProps<'PayslipList'>;

export default function PayslipListScreen({ navigation, route }: Props) {
  const { workplaceId } = route.params;
  const insets = useSafeAreaInsets();
  const ai = useAiAnalysis();
  const [workplace, setWorkplace] = useState<Workplace | null | undefined>(undefined);
  const [payslips, setPayslips] = useState<PayslipRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null); // 진행 상태 라벨
  const pickBusyRef = useRef(false);

  const load = useCallback(() => {
    getWorkplace(workplaceId).then((w) => setWorkplace(w ?? null));
    getPayslipsByWorkplace(workplaceId).then(setPayslips);
  }, [workplaceId]);

  useFocusEffect(useCallback(() => load(), [load]));

  // 파일 하나를 저장→OCR→구조화하고 확인 화면으로 넘긴다.
  const runCapture = async (input: { uri: string; name: string; mimeType: string; size: number | null; kind: EvidenceKind }) => {
    setBusy('명세서를 분석하고 있어요…');
    try {
      const evidenceId = makeId();
      // 원본 파일을 증빙 보관함에도 남긴다(급여명세서로 표시). 실패해도 분석은 계속.
      await addEvidenceFile({
        id: evidenceId,
        workplaceId,
        name: input.name,
        uri: input.uri,
        kind: input.kind,
        size: input.size,
        addedAt: new Date().toISOString(),
        mimeType: input.mimeType,
        documentType: 'payslip',
      });

      const result = await analyzePayslipFile(ai.remote, {
        uri: input.uri,
        name: input.name,
        mimeType: input.mimeType,
        size: input.size,
      });

      if (result.errorCode === 'AUTH_REQUIRED') {
        ai.promptLogin();
        return;
      }
      if (result.status === 'error') {
        Alert.alert(
          '분석 실패',
          result.errorCode === 'OCR_EMPTY'
            ? '명세서에서 글자를 인식하지 못했어요. 더 선명한 파일로 다시 시도해주세요.'
            : '명세서를 읽지 못했어요. 잠시 후 다시 시도해주세요.'
        );
        return;
      }

      // OCR 성공 — 구조화 성공(extracted) 또는 실패(ocr_only) 모두 확인 화면으로.
      // 구조화 실패여도 OCR 텍스트를 넘겨 수동 입력으로 이어가게 한다.
      const extractionFailed = result.status === 'ocr_only';
      navigation.navigate('PayslipReview', {
        workplaceId,
        yearMonth: currentYearMonth(),
        amounts: result.amounts, // extracted 일 때만 채워짐
        aiExtracted: result.amounts ?? null,
        rawOcrText: result.ocrText,
        evidenceFileId: evidenceId,
        source: 'ai',
        extractionFailed,
      });
    } finally {
      setBusy(null);
    }
  };

  const handlePickImage = async () => {
    if (pickBusyRef.current || busy) return;
    if (!ai.ensureCanAnalyze()) return; // 비로그인 게이트(요청 시작 전)
    pickBusyRef.current = true;
    try {
      if (Platform.OS !== 'web') {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('사진 접근 권한이 필요해요', '설정에서 권한을 허용해주세요.');
          return;
        }
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.7,
        base64: Platform.OS === 'web',
      });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const name = asset.fileName ?? `급여명세서_${Date.now()}.jpg`;
      const uri = await persistPickedFile({ uri: asset.uri, name, mimeType, base64: asset.base64 });
      await runCapture({ uri, name, mimeType, size: asset.fileSize ?? null, kind: 'image' });
    } catch (e) {
      console.warn('[PayslipList] 사진 첨부 실패:', e instanceof Error ? e.message : String(e));
      Alert.alert('사진을 첨부하지 못했어요', '다시 시도해주세요.');
    } finally {
      pickBusyRef.current = false;
    }
  };

  const handlePickDocument = async () => {
    if (pickBusyRef.current || busy) return;
    if (!ai.ensureCanAnalyze()) return;
    pickBusyRef.current = true;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      const mimeType = asset.mimeType ?? 'application/pdf';
      const name = asset.name ?? `급여명세서_${Date.now()}`;
      const kind: EvidenceKind = mimeType === 'application/pdf' ? 'pdf' : mimeType.startsWith('image/') ? 'image' : 'file';
      const uri = await persistPickedFile({ uri: asset.uri, name, mimeType });
      await runCapture({ uri, name, mimeType, size: asset.size ?? null, kind });
    } catch (e) {
      console.warn('[PayslipList] 문서 첨부 실패:', e instanceof Error ? e.message : String(e));
      Alert.alert('문서를 첨부하지 못했어요', '다시 시도해주세요.');
    } finally {
      pickBusyRef.current = false;
    }
  };

  const addManually = () => {
    navigation.navigate('PayslipReview', {
      workplaceId,
      yearMonth: currentYearMonth(),
      source: 'manual',
    });
  };

  if (workplace === undefined) return <LoadingScreen />;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 + insets.bottom }}
    >
      <Text style={styles.title}>급여명세서</Text>
      <Text style={styles.subtitle}>
        사업주가 발급한 명세서를 등록하면 AI가 항목을 추출해요. 저장 전에 실제 명세서와
        비교해 확인·수정할 수 있어요.
      </Text>

      {busy ? (
        <View style={styles.busyCard}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.busyText}>{busy}</Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={handlePickImage} accessibilityRole="button" accessibilityLabel="사진으로 명세서 추가">
            <Ionicons name="image-outline" size={20} color={colors.primaryDark} />
            <Text style={styles.actionText}>사진으로 추가</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={handlePickDocument} accessibilityRole="button" accessibilityLabel="PDF로 명세서 추가">
            <Ionicons name="document-text-outline" size={20} color={colors.primaryDark} />
            <Text style={styles.actionText}>PDF로 추가</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={addManually} accessibilityRole="button" accessibilityLabel="직접 입력">
            <Ionicons name="create-outline" size={20} color={colors.primaryDark} />
            <Text style={styles.actionText}>직접 입력</Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.sectionTitle}>저장된 명세서</Text>
      {payslips.length === 0 ? (
        <Text style={styles.empty}>아직 등록한 명세서가 없어요.</Text>
      ) : (
        payslips.map((p) => (
          <Pressable
            key={p.id}
            style={styles.row}
            onPress={() => navigation.navigate('PayslipReview', { workplaceId, payslipId: p.id })}
            accessibilityRole="button"
            accessibilityLabel={`${formatYearMonth(p.yearMonth)} 급여명세서`}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowMonth}>{formatYearMonth(p.yearMonth)}</Text>
              <Text style={styles.rowMeta}>
                {p.reviewedByUser ? '확인 완료' : '확인 필요'}
                {p.extractionSource === 'ai' ? ' · AI 추출' : ' · 직접 입력'}
              </Text>
            </View>
            <Text style={styles.rowNet}>{p.amounts.netPay != null ? formatWon(p.amounts.netPay) : '미상'}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { fontSize: 18, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.subtext, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  action: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    ...shadow.card,
  },
  actionText: { fontSize: 12, fontWeight: '700', color: colors.text },
  busyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  busyText: { fontSize: 13, color: colors.primaryDark, fontWeight: '600' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  empty: { fontSize: 13, color: colors.subtext },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  rowMonth: { fontSize: 14, fontWeight: '700', color: colors.text },
  rowMeta: { fontSize: 11, color: colors.subtext, marginTop: 2 },
  rowNet: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
});
