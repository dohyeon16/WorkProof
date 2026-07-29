import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../shared/components/Text';
import { Alert } from '../shared/components/alert';
import { useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import type { RootScreenProps } from '../app/navigation/types';
import {
  addEvidenceFile,
  getAttendanceByMonth,
  getEvidenceByWorkplace,
  getPayRecord,
  getWorkplace,
  makeId,
} from '../core/data/storage';
import { AttendanceRecord, EvidenceFile, PayRecord, Workplace } from '../core/domain/models/types';
import { calcMonthlySummary, formatMinutesAsHours, formatWon } from '../core/domain/payroll/payCalc';
import { buildComplaintHtml, buildReportHtml } from '../report';
import { formatYearMonth } from '../shared/utils/date';
import { openHtmlInNewTab, toHtmlDataUri } from '../shared/utils/webOpen';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadow, spacing } from '../shared/theme';
import { LoadingScreen } from '../shared/components/LoadingScreen';

type Props = RootScreenProps<'Report'>;

export default function ReportScreen({ navigation, route }: Props) {
  const { workplaceId, yearMonth } = route.params;
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [payRecord, setPayRecord] = useState<PayRecord | undefined>(undefined);
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
  const [generating, setGenerating] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const w = await getWorkplace(workplaceId);
        const [list, pay, evidence] = await Promise.all([
          getAttendanceByMonth(workplaceId, yearMonth),
          getPayRecord(workplaceId, yearMonth),
          getEvidenceByWorkplace(workplaceId),
        ]);
        setWorkplace(w ?? null);
        setRecords(list);
        setPayRecord(pay);
        setEvidenceFiles(evidence);
      })();
    }, [workplaceId, yearMonth])
  );

  const insets = useSafeAreaInsets();

  if (!workplace) return <LoadingScreen />;

  const summary = calcMonthlySummary(records, workplace, yearMonth);
  const diff = payRecord?.diff ?? null;
  const riskCount = payRecord?.checklist.filter((c) => c.status === 'risk').length ?? 0;
  const pct = diff != null && summary.expectedPay > 0 ? (diff / summary.expectedPay) * 100 : null;

  const generate = async (intent: 'save' | 'share', kind: 'report' | 'complaint' = 'report') => {
    setGenerating(true);
    try {
      const html =
        kind === 'complaint'
          ? buildComplaintHtml(workplace, records, yearMonth, payRecord, evidenceFiles)
          : buildReportHtml(workplace, records, yearMonth, payRecord, evidenceFiles);
      const docLabel = kind === 'complaint' ? '진정서초안' : '리포트';

      if (Platform.OS === 'web') {
        // expo-print has no file-system access on web — printToFileAsync() there just calls
        // window.print() on the current page and ignores the html argument. A window.open('', '_blank')
        // + document.write() + print() popup is unreliable (print() firing before the popup paints
        // leaves a blank "about:blank" tab). Chrome also blocks top-level navigation to `data:` URLs
        // outright, so we can't just window.open() one either. We open a fresh blob: URL (always
        // allowed) for viewing right now, and separately persist a `data:` URI in the vault — see
        // utils/webOpen.ts for how that gets reopened later (re-blobbed at open time).
        const opened = openHtmlInNewTab(html);
        if (!opened) {
          Alert.alert('리포트를 열 수 없어요', '팝업 차단을 해제한 뒤 다시 시도해주세요.');
          return;
        }
        if (intent === 'save') {
          await addEvidenceFile({
            id: makeId(),
            workplaceId,
            name: `WorkProof_${yearMonth}_${docLabel}.html`,
            uri: toHtmlDataUri(html),
            kind: 'pdf',
            size: null,
            addedAt: new Date().toISOString(),
          });
        }
        navigation.navigate('ShareComplete', {
          workplaceId,
          yearMonth,
          intent,
          note:
            intent === 'save'
              ? '새 탭에서 리포트를 열었고 증빙 보관함에도 저장했어요. 브라우저 인쇄 메뉴에서 PDF로 저장할 수 있어요.'
              : '새 탭에서 리포트를 열었어요. 브라우저 인쇄 메뉴에서 PDF로 저장할 수 있어요.',
        });
        return;
      }

      const { uri } = await Print.printToFileAsync({ html });

      if (intent === 'save') {
        // "저장"은 이 앱의 증빙 보관함에 실제로 남기는 것을 의미한다 — printToFileAsync()가 만든
        // 파일은 캐시 디렉터리에 있어 OS가 언제든 지울 수 있으므로, 문서 디렉터리로 복사해 보관함에 등록한다.
        const fileName = `WorkProof_${yearMonth}_${docLabel}_${makeId()}.pdf`;
        const destination = new File(Paths.document, fileName);
        await new File(uri).copy(destination);
        await addEvidenceFile({
          id: makeId(),
          workplaceId,
          name: fileName,
          uri: destination.uri,
          kind: 'pdf',
          size: destination.size ?? null,
          addedAt: new Date().toISOString(),
        });
        navigation.navigate('ShareComplete', { workplaceId, yearMonth, intent });
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('공유하기를 사용할 수 없어요', '이 기기/환경에서는 파일 저장·공유 기능을 지원하지 않아요.');
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `WorkProof ${docLabel} - ${formatYearMonth(yearMonth)}`,
      });
      navigation.navigate('ShareComplete', { workplaceId, yearMonth, intent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Full error (with stack, if any) goes to the Metro console — open the
      // in-app dev menu "Show Dev Menu" > "Debug Remote JS" / `npx expo start`
      // terminal to see it. The Alert only carries the message string.
      console.error('[ReportScreen] PDF generate failed:', err);
      Alert.alert('리포트 생성 실패', __DEV__ ? message : '잠시 후 다시 시도해주세요.');
    } finally {
      setGenerating(false);
    }
  };

  const items = [
    { label: '근무지 정보', value: workplace.name },
    { label: '근무 기록 요약', value: formatMinutesAsHours(summary.totalWorkedMinutes) },
    { label: '예상 급여 산정', value: formatWon(summary.expectedPay) },
    { label: '실제 입금액', value: payRecord?.actualPay != null ? formatWon(payRecord.actualPay) : '미입력' },
    {
      label: '차액 분석',
      value:
        diff == null
          ? '-'
          : `${diff < 0 ? '-' : '+'}${formatWon(Math.abs(diff))}${pct != null ? ` (${pct.toFixed(2)}%)` : ''}`,
    },
    { label: '확인 필요 항목', value: `${riskCount}개 항목` },
    { label: '첨부 자료', value: `${evidenceFiles.length}개 파일` },
  ];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
    >
      <Text style={styles.title}>{formatYearMonth(yearMonth)} 급여 리포트</Text>

      <View style={styles.card}>
        {items.map((item, idx) => (
          <View key={item.label} style={styles.row}>
            <Text style={styles.rowIndex}>{idx + 1}.</Text>
            <Text style={styles.rowLabel}>{item.label}</Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.disclaimerCard}>
        <Ionicons name="information-circle-outline" size={16} color={colors.subtext} />
        <Text style={styles.disclaimer}>
          본 리포트는 법적 판단 자료가 아닌 개인 기록 자료입니다. 급여 차이가 발생한 경우, 이 리포트를
          바탕으로 사업주에게 급여 산정 기준을 먼저 확인해보세요.
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          style={styles.saveButton}
          onPress={() => generate('save')}
          disabled={generating}
          accessibilityRole="button"
          accessibilityLabel="PDF 저장"
        >
          <Ionicons name="download-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.saveButtonText}>PDF 저장</Text>
        </Pressable>
        <Pressable
          style={styles.shareButton}
          onPress={() => generate('share')}
          disabled={generating}
          accessibilityRole="button"
          accessibilityLabel="공유하기"
        >
          {generating ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="share-social-outline" size={16} color="#fff" />
              <Text style={styles.shareButtonText}>공유하기</Text>
            </>
          )}
        </Pressable>
      </View>

      {diff != null && diff < 0 && (
        <>
          <View style={styles.complaintDivider} />
          <Text style={styles.complaintTitle}>급여를 못 받았나요?</Text>
          <Text style={styles.complaintSub}>
            근무 기록을 바탕으로 고용노동부 진정에 참고할 수 있는 임금체불 진정서 초안을 만들어 드려요.
          </Text>
          <Pressable
            style={styles.complaintButton}
            onPress={() => generate('share', 'complaint')}
            disabled={generating}
            accessibilityRole="button"
            accessibilityLabel="진정서 초안 만들기"
          >
            <Ionicons name="document-text-outline" size={16} color={colors.danger} />
            <Text style={styles.complaintButtonText}>진정서 초안 만들기</Text>
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  title: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs + 2, gap: spacing.xs },
  rowIndex: { fontSize: 13, color: colors.subtext, width: 18 },
  rowLabel: { fontSize: 13, color: colors.text, flex: 1 },
  rowValue: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, maxWidth: '45%' },
  disclaimerCard: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.md,
  },
  disclaimer: { flex: 1, fontSize: 12, color: colors.subtext, lineHeight: 18 },
  buttonRow: { flexDirection: 'row', gap: spacing.sm },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
  },
  saveButtonText: { color: colors.primaryDark, fontWeight: '700', fontSize: 15 },
  shareButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    ...shadow.card,
  },
  shareButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  complaintDivider: { height: 1, backgroundColor: colors.border, marginTop: spacing.lg, marginBottom: spacing.md },
  complaintTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  complaintSub: { fontSize: 12, color: colors.subtext, lineHeight: 18, marginTop: 2, marginBottom: spacing.sm },
  complaintButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
  },
  complaintButtonText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
});
