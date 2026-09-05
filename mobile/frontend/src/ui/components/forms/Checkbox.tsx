import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../display/Text';
import { colors, control, spacing, typography } from '../../design_system';

interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  label: string;
  bold?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function Checkbox({ checked, onToggle, label, bold, size = 20, style }: CheckboxProps) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, style, pressed && control.pressed]}
      onPress={onToggle}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={size}
        color={checked ? colors.primary : colors.subtext}
      />
      <Text style={[styles.label, bold && styles.labelBold]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: control.minTarget, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  label: { ...typography.caption, color: colors.text, flexShrink: 1 },
  labelBold: { fontWeight: '700', fontSize: 14 },
});
