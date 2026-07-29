import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../shared/components/Text';
import { FieldInput } from '../shared/components/FieldInput';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../shared/components/alert';
import type { RootScreenProps } from '../app/navigation/types';
import { getAccount, saveAccount } from '../core/data/storage';
import { colors, radius, shadow, spacing } from '../shared/theme';

type Props = RootScreenProps<'ResetPassword'>;

export default function ResetPasswordScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'verify' | 'reset'>('verify');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const handleVerify = async () => {
    if (!email.trim()) {
      Alert.alert('이메일을 입력해주세요.');
      return;
    }
    const account = await getAccount();
    if (!account || account.email !== email.trim()) {
      Alert.alert('일치하는 계정이 없어요', '입력한 이메일로 가입된 계정을 찾을 수 없어요.');
      return;
    }
    if (account.provider && account.provider !== 'local') {
      Alert.alert(
        '소셜 로그인 계정이에요',
        `이 계정은 ${account.provider === 'google' ? 'Google' : account.provider === 'kakao' ? '카카오' : '네이버'} 로그인으로 가입됐어요. 로그인 화면에서 해당 소셜 로그인을 이용해주세요.`
      );
      return;
    }
    setStep('reset');
  };

  const handleReset = async () => {
    if (!password || !passwordConfirm) {
      Alert.alert('새 비밀번호를 입력해주세요.');
      return;
    }
    if (password.length < 8 || password.length > 16) {
      Alert.alert('비밀번호는 8~16자리로 입력해주세요.');
      return;
    }
    if (password !== passwordConfirm) {
      Alert.alert('비밀번호가 일치하지 않아요.');
      return;
    }
    const account = await getAccount();
    if (!account) return; // verify 단계를 통과했다면 존재가 보장됨
    await saveAccount({ ...account, password });
    Alert.alert('비밀번호가 변경됐어요', '새 비밀번호로 로그인해주세요.', [
      { text: '확인', onPress: () => navigation.navigate('Login') },
    ]);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="이전으로"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>

        <Text style={styles.title}>비밀번호 찾기</Text>
        <Text style={styles.subtitle}>
          {step === 'verify'
            ? '가입한 이메일을 입력해주세요.'
            : '새로 사용할 비밀번호를 입력해주세요.'}
        </Text>

        {step === 'verify' ? (
          <View style={styles.form}>
            <FieldInput
              icon="mail-outline"
              placeholder="이메일 주소"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <Pressable
              style={styles.primaryButton}
              onPress={handleVerify}
              accessibilityRole="button"
              accessibilityLabel="계정 확인"
            >
              <Text style={styles.primaryButtonText}>계정 확인</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.form}>
            <FieldInput
              icon="lock-closed-outline"
              placeholder="새 비밀번호 (8~16자리)"
              secureTextEntry
              toggleSecure
              value={password}
              onChangeText={setPassword}
            />
            <FieldInput
              icon="lock-closed-outline"
              placeholder="새 비밀번호 확인"
              secureTextEntry
              toggleSecure
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
            />
            <Pressable
              style={styles.primaryButton}
              onPress={handleReset}
              accessibilityRole="button"
              accessibilityLabel="비밀번호 변경"
            >
              <Text style={styles.primaryButtonText}>비밀번호 변경</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl, alignItems: 'stretch' },
  backButton: { marginBottom: spacing.md, alignSelf: 'flex-start' },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 14, color: colors.subtext, marginTop: 4, marginBottom: spacing.lg },
  form: { marginTop: spacing.xs },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadow.card,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
