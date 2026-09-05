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
import { Text } from '../display/Text';
import { TextInput } from './TextInput';
import { colors, componentTokens, control, radius, spacing, typography } from '../../design_system';

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
  onFocus?: () => void;
  blurOnSubmit?: boolean;
  inputAccessoryViewID?: string;
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
    onFocus,
    blurOnSubmit,
    inputAccessoryViewID,
  },
  ref
) {
  const [hidden, setHidden] = useState(!!secureTextEntry);
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.wrap, focused && styles.wrapFocused, error && styles.wrapError]}>
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
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => setFocused(false)}
        blurOnSubmit={blurOnSubmit}
        inputAccessoryViewID={inputAccessoryViewID}
      />
      {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      {trailingIcon && <Ionicons name={trailingIcon} size={16} color={colors.subtext} />}
      {toggleSecure && (
        <Pressable
          onPress={() => setHidden((v) => !v)}
          hitSlop={8}
          style={({ pressed }) => [styles.eyeBtn, pressed && control.pressed]}
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
    minHeight: control.inputHeight,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.control,
    marginBottom: spacing.control,
  },
  wrapFocused: { borderColor: componentTokens.input.borderFocus },
  wrapError: { borderColor: colors.danger },
  icon: { marginRight: spacing.xs + 2 },
  input: {
    ...typography.body,
    flex: 1,
    minWidth: 0,
    minHeight: control.inputHeight,
    paddingVertical: spacing.control,
    color: colors.text,
  },
  suffix: { ...typography.caption, color: colors.subtext, marginLeft: spacing.xs },
  eyeBtn: { ...control.iconButton, marginRight: -spacing.sm },
});
