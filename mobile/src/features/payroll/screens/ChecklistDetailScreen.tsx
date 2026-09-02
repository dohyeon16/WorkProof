import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getPayRecord } from '../../../core/data/storage';
import { PayRecord } from '../../../core/domain/models/types';
import { formatWon } from '../../../core/domain/payroll/payCalc';
import { colors, radius, shadow, spacing } from '../../../shared/theme';
import { LoadingScreen } from '../../../shared/components/LoadingScreen';

type Props = RootScreenProps<'ChecklistDetail'>;

export default function ChecklistDetailScreen({ navigation, route }: Props) {
  const { workplaceId, yearMonth } = route.params;
  const [payRecord, setPayRecord] = useState<PayRecord | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPayRecord(workplaceId, yearMonth).then((p) => setPayRecord(p ?? null));
    }, [workplaceId, yearMonth])
  );

  const insets = useSafeAreaInsets();

  if (!payRecord) return <LoadingScreen />;

  const diff = payRecord.diff ?? 0;
  const riskCount = payRecord.checklist.filter((c) => c.status === 'risk').length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}
    >
      <View style={styles.headerCard}>
        <Ionicons name="alert-circle" size={22} color={colors.danger} />
        <Text style={styles.headerText}>
          이번 달에 {diff < 0 ? '' : '+'}
          {formatWon(diff)}의 차액이 발생했어요.
        </Text>
        <Text style={styles.headerSub}>
          {riskCount > 0 ? `${riskCount}개 항목을 확인해보세요.` : '아래 항목들을 확인해보세요.'}
        </Text>
      </View>

      {payRecord.checklist.map((item) => (
        <View key={item.key} style={styles.row}>
          <Ionicons
            name={item.status === 'risk' ? 'alert-circle-outline' : 'checkmark-circle-outline'}
            size={18}
            color={item.status === 'risk' ? colors.danger : colors.primary}
          />
          <Text style={styles.rowLabel}>{item.label}</Text>
          <View style={[styles.chip, item.status === 'risk' ? styles.chipRisk : styles.chipOk]}>
            <Text style={[styles.chipText, item.status === 'risk' ? styles.chipTextRisk : styles.chipTextOk]}>
              {item.status === 'risk' ? '위험' : '양호'}
            </Text>
          </View>
        </View>
      ))}

      <Pressable
        style={styles.reportButton}
        onPress={() => navigation.navigate('Report', { workplaceId, yearMonth })}
        accessibilityRole="button"
        accessibilityLabel="PDF 리포트 보기"
      >
        <Ionicons name="document-text-outline" size={16} color={colors.primaryDark} />
        <Text style={styles.reportButtonText}>PDF 리포트 보기</Text>
      </Pressable>

      <Pressable
        style={styles.vaultButton}
        onPress={() => navigation.navigate('Main', { screen: 'Vault' })}
        accessibilityRole="button"
        accessibilityLabel="증빙 자료 보관함 보기"
      >
        <Ionicons name="folder-outline" size={16} color="#fff" />
        <Text style={styles.vaultButtonText}>증빙 자료 보관함 보기</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  headerCard: {
    backgroundColor: colors.dangerLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: 4,
    ...shadow.card,
  },
  headerText: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: spacing.xs },
  headerSub: { fontSize: 13, color: colors.subtext },
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
  rowLabel: { fontSize: 14, color: colors.text, flex: 1 },
  chip: { paddingHorizontal: spacing.sm + 2, paddingVertical: spacing.xs / 2 + 2, borderRadius: radius.pill },
  chipRisk: { backgroundColor: colors.dangerLight },
  chipOk: { backgroundColor: colors.successLight },
  chipText: { fontSize: 12, fontWeight: '700' },
  chipTextRisk: { color: colors.danger },
  chipTextOk: { color: colors.success },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginTop: spacing.lg,
  },
  reportButtonText: { color: colors.primaryDark, fontWeight: '700', fontSize: 15 },
  vaultButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginTop: spacing.sm,
    ...shadow.card,
  },
  vaultButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
