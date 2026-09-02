import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../../shared/components/Text';
import { FieldInput } from '../../../shared/components/FieldInput';
import { Alert } from '../../../shared/components/alert';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';
import { CalendarPickerModal } from '../../../shared/components/CalendarPickerModal';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getPayslip, makeId, savePayslip } from '../../../core/data/storage';
import { PayslipAmounts, PayslipExtractionSource, PayslipRecord } from '../../../core/domain/models/types';
import { formatWon } from '../../../core/domain/payroll/payCalc';
import { currentYearMonth, formatYearMonth, shiftYearMonth } from '../../../shared/utils/date';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import {
  emptyPayslipAmounts,
  reconcileTotals,
  PAYSLIP_DEDUCTION_FIELDS,
  PAYSLIP_EARNING_FIELDS,
  PAYSLIP_FIELD_LABELS,
  PAYSLIP_RESULT_FIELDS,
  type PayslipField,
} from '../services/payslipExtraction';

type Props = RootScreenProps<'PayslipReview'>;

function toInput(v: number | null): string {
  return v == null ? '' : String(v);
}

export default function PayslipReviewScreen({ navigation, route }: Props) {
  const { workplaceId, payslipId } = route.params;
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<PayslipAmounts>(emptyPayslipAmounts());
  const [yearMonth, setYearMonth] = useState<string>(route.params.yearMonth ?? currentYearMonth());
  const [payDate, setPayDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [showOcr, setShowOcr] = useState(false);

  // 편집 시 보존해야 하는 원본 메타(로드 결과 또는 draft params).
  const [meta, setMeta] = useState<{
    source: PayslipExtractionSource;
    rawOcrText?: string;
    aiExtracted: PayslipAmounts | null;
    evidenceFileId?: string;
    createdAt: string;
    extractionFailed: boolean;
  }>({ source: route.params.source ?? 'manual', aiExtracted: null, createdAt: new Date().toISOString(), extractionFailed: false });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        if (payslipId) {
          const rec = await getPayslip(payslipId);
          if (!active) return;
          if (rec) {
            setAmounts(rec.amounts);
            setYearMonth(rec.yearMonth);
            setPayDate(rec.payDate ?? null);
            setMeta({
              source: rec.extractionSource,
              rawOcrText: rec.rawOcrText,
              aiExtracted: rec.aiExtractedAmounts ?? null,
              evidenceFileId: rec.evidenceFileId,
              createdAt: rec.createdAt,
              extractionFailed: false,
            });
          }
        } else {
          setAmounts(route.params.amounts ?? emptyPayslipAmounts());
          setMeta({
            source: route.params.source ?? 'manual',
            rawOcrText: route.params.rawOcrText,
            aiExtracted: route.params.aiExtracted ?? null,
            evidenceFileId: route.params.evidenceFileId,
            createdAt: new Date().toISOString(),
            extractionFailed: route.params.extractionFailed ?? false,
          });
        }
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
      // payslipId 기준으로만 재로딩(파라미터 draft는 최초 1회).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payslipId])
  );

  const setField = (field: PayslipField, text: string) => {
    const digits = text.replace(/[^\d]/g, '');
    setAmounts((prev) => ({ ...prev, [field]: digits === '' ? null : Number(digits) }));
  };

  const warnings = useMemo(() => reconcileTotals(amounts), [amounts]);

  const handleSave = async () => {
    const now = new Date().toISOString();
    const record: PayslipRecord = {
      id: payslipId ?? makeId(),
      workplaceId,
      yearMonth,
      payDate,
      amounts,
      extractionSource: meta.source,
      rawOcrText: meta.rawOcrText,
      // AI 원본 추출값 보존(확정값 amounts 와 구분). 수동 입력이면 null.
      aiExtractedAmounts: meta.source === 'ai' ? meta.aiExtracted : null,
      reviewedByUser: true,
      reviewedAt: now,
      evidenceFileId: meta.evidenceFileId,
      createdAt: meta.createdAt,
      updatedAt: now,
    };
    await savePayslip(record);
    Alert.alert('저장했어요', `${formatYearMonth(yearMonth)} 급여명세서를 저장했어요.`);
    navigation.goBack();
  };

  if (loading) return <LoadingScreen />;

  const renderField = (field: PayslipField) => (
    <View key={field} style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{PAYSLIP_FIELD_LABELS[field]}</Text>
      <View style={styles.fieldInput}>
        <FieldInput
          value={toInput(amounts[field])}
          onChangeText={(t) => setField(field, t)}
          keyboardType="number-pad"
          placeholder="미입력"
          suffix="원"
        />
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        {/* AI 추출 고지 — 확정 사실이 아님을 항상 알린다. */}
        {meta.source === 'ai' && (
          <View style={styles.disclaimer}>
            <Ionicons name="sparkles-outline" size={16} color={colors.primaryDark} />
            <Text style={styles.disclaimerText}>
              AI가 추출한 내용입니다. 실제 명세서와 비교해 확인해 주세요.
            </Text>
          </View>
        )}

        {/* 구조화 실패(OCR만 성공) → 수동 입력 안내 */}
        {meta.extractionFailed && (
          <View style={styles.notice}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.noticeText}>
              AI 자동 항목 분석을 현재 사용할 수 없습니다. OCR 결과를 확인하고 직접 입력할 수 있어요.
            </Text>
          </View>
        )}

        {/* 귀속 월 */}
        <Text style={styles.groupTitle}>귀속 월</Text>
        <View style={styles.monthRow}>
          <Pressable onPress={() => setYearMonth(shiftYearMonth(yearMonth, -1))} accessibilityRole="button" accessibilityLabel="이전 달">
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.monthLabel}>{formatYearMonth(yearMonth)}</Text>
          <Pressable onPress={() => setYearMonth(shiftYearMonth(yearMonth, 1))} accessibilityRole="button" accessibilityLabel="다음 달">
            <Ionicons name="chevron-forward" size={22} color={colors.text} />
          </Pressable>
        </View>

        <Text style={styles.groupTitle}>지급 항목</Text>
        {PAYSLIP_EARNING_FIELDS.map(renderField)}

        <Text style={styles.groupTitle}>공제 항목</Text>
        {PAYSLIP_DEDUCTION_FIELDS.map(renderField)}

        <Text style={styles.groupTitle}>합계</Text>
        {PAYSLIP_RESULT_FIELDS.map(renderField)}

        {/* 지급일(선택) */}
        <Text style={styles.groupTitle}>지급일 (선택)</Text>
        <Pressable onPress={() => setCalendarVisible(true)} accessibilityRole="button" accessibilityLabel="지급일 선택">
          <View pointerEvents="none">
            <FieldInput icon="calendar-outline" value={payDate ?? ''} onChangeText={() => {}} placeholder="날짜 선택" />
          </View>
        </Pressable>
        <CalendarPickerModal
          visible={calendarVisible}
          value={payDate ?? currentYearMonth() + '-01'}
          onClose={() => setCalendarVisible(false)}
          onSelect={setPayDate}
        />

        {/* 합계 정합성 경고 */}
        {warnings.length > 0 && (
          <View style={styles.warnBox}>
            {warnings.map((w, i) => (
              <View key={`${w.code}-${i}`} style={styles.warnRow}>
                <Ionicons name="warning-outline" size={14} color={colors.danger} />
                <Text style={styles.warnText}>{w.message}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 원본 OCR 텍스트 */}
        {meta.rawOcrText ? (
          <>
            <Pressable style={styles.ocrToggle} onPress={() => setShowOcr((v) => !v)} accessibilityRole="button" accessibilityLabel="원본 OCR 텍스트 보기">
              <Ionicons name={showOcr ? 'chevron-up' : 'chevron-down'} size={16} color={colors.subtext} />
              <Text style={styles.ocrToggleText}>원본 OCR 텍스트 {showOcr ? '숨기기' : '보기'}</Text>
            </Pressable>
            {showOcr && (
              <View style={styles.ocrBox}>
                <Text style={styles.ocrText}>{meta.rawOcrText}</Text>
              </View>
            )}
          </>
        ) : null}

        <Pressable style={styles.saveButton} onPress={handleSave} accessibilityRole="button" accessibilityLabel="저장하기">
          <Text style={styles.saveButtonText}>확인하고 저장하기</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  disclaimerText: { flex: 1, fontSize: 12, color: colors.primaryDark, fontWeight: '600', lineHeight: 17 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  noticeText: { flex: 1, fontSize: 12, color: colors.danger, fontWeight: '600', lineHeight: 17 },
  groupTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: spacing.md, marginBottom: spacing.xs },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  monthLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  fieldLabel: { width: 96, fontSize: 13, color: colors.text },
  fieldInput: { flex: 1 },
  warnBox: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.md,
    gap: 4,
  },
  warnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  warnText: { flex: 1, fontSize: 12, color: colors.danger },
  ocrToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg },
  ocrToggleText: { fontSize: 13, color: colors.subtext, fontWeight: '600' },
  ocrBox: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  ocrText: { fontSize: 12, color: colors.subtext, lineHeight: 18 },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.xl,
    ...shadow.card,
  },
  saveButtonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
});
