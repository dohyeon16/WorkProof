import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../display/Text';
import { colors, spacing, typography } from '../../design_system';

export function LoadingScreen() {
  return (
    <View style={styles.container} accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={styles.label}>불러오는 중이에요</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: spacing.md },
  label: { ...typography.body, color: colors.subtext },
});
