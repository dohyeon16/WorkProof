import { InputAccessoryView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../display/Text';
import { colors, spacing } from '../../design_system';

interface Props {
  /** useNumericInputNavigation이 만들어준 화면 전용 nativeID. */
  nativeID: string;
  /** '다음' 또는 '완료'. */
  label: string;
  onPress: () => void;
}

/**
 * iOS 숫자 키보드(number-pad 등) 위에 뜨는 '다음'/'완료' 툴바.
 * iOS에서만 렌더되며, 한 화면에 한 번만 두고 여러 입력이 nativeID로 공유한다.
 * Android/웹에서는 아무것도 렌더하지 않는다(returnKeyType으로 대체).
 */
export function InputAccessoryToolbar({ nativeID, label, onPress }: Props) {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <Pressable
          onPress={onPress}
          hitSlop={8}
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  button: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  buttonText: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
});
