import { forwardRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type TextInputSubmitEditingEvent,
  type TextInput as RNTextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { TextInput } from './TextInput';
import { colors, radius, spacing } from '../theme';

interface FieldInputProps {
  icon?: keyof typeof Ionicons.glyphMap;
  placeholder?: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  toggleSecure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  suffix?: string;
  trailingIcon?: keyof typeof Ionicons.glyphMap;
  error?: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: (e: TextInputSubmitEditingEvent) => void;
}

/** 아이콘/비밀번호 토글/단위 접미사를 포함한 공용 입력 필드. 로그인·회원가입·근무지 등록 화면에서 재사용. */
export const FieldInput = forwardRef<RNTextInput, FieldInputProps>(function FieldInput(
  {
    icon,
    placeholder,
    value,
    onChangeText,
    secureTextEntry,
    toggleSecure,
    keyboardType,
    autoCapitalize,
    suffix,
    trailingIcon,
    error,
    returnKeyType,
    onSubmitEditing,
  },
  ref
) {
  const [hidden, setHidden] = useState(!!secureTextEntry);
  return (
    <View style={[styles.wrap, error && styles.wrapError]}>
      {icon && <Ionicons name={icon} size={18} color={colors.subtext} style={styles.icon} />}
      <TextInput
        ref={ref}
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={colors.subtext}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry ? hidden : false}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={placeholder}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
      />
      {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      {trailingIcon && <Ionicons name={trailingIcon} size={16} color={colors.subtext} />}
      {toggleSecure && (
        <Pressable
          onPress={() => setHidden((v) => !v)}
          hitSlop={8}
          style={styles.eyeBtn}
          accessibilityRole="button"
          accessibilityLabel={hidden ? '비밀번호 표시' : '비밀번호 숨기기'}
        >
          <Ionicons name={hidden ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.subtext} />
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm + 4,
    marginBottom: spacing.sm + 2,
  },
  wrapError: { borderColor: colors.danger },
  icon: { marginRight: spacing.xs + 2 },
  input: {
    flex: 1,
    paddingVertical: spacing.sm + 6,
    fontSize: 15,
    color: colors.text,
  },
  suffix: { fontSize: 13, color: colors.subtext, marginLeft: spacing.xs },
  eyeBtn: { padding: spacing.xs },
});
