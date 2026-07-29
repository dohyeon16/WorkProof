import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { Ionicons } from '@expo/vector-icons';
import type { RootScreenProps } from '../../../app/navigation/types';
import { LEGAL_DOCUMENTS } from '../content/legalContent';
import { colors, radius, spacing } from '../../../shared/theme';

type Props = RootScreenProps<'LegalDocument'>;

export default function LegalDocumentScreen({ navigation, route }: Props) {
  const doc = LEGAL_DOCUMENTS[route.params.doc];
  const insets = useSafeAreaInsets();

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
        <Text style={styles.headerTitle}>{doc.title}</Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: spacing.xl * 2 + insets.bottom }]}>
        <Text style={styles.updatedAt}>최종 개정일: {doc.updatedAt}</Text>
        <Text style={styles.intro}>{doc.intro}</Text>
        {doc.sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.sectionHeading}>{section.heading}</Text>
            <Text style={styles.sectionBody}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
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
  content: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  updatedAt: { fontSize: 12, color: colors.subtext, marginBottom: spacing.sm },
  intro: { fontSize: 13, color: colors.text, lineHeight: 20, marginBottom: spacing.lg },
  section: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  sectionHeading: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  sectionBody: { fontSize: 13, color: colors.subtext, lineHeight: 19 },
});
