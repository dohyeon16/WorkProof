import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { FieldInput } from '../components/FieldInput';
import { Checkbox } from '../components/Checkbox';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '../components/GoogleLogo';
import { Alert } from '../alert';
import type { RootScreenProps } from '../navigation/types';
import { getAccount, isOnboardingDone, saveAccount, setLoggedIn } from '../storage';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import { loginWithGoogle, loginWithKakao, loginWithNaver } from '../auth/socialLogin';
import type { AuthProvider } from '../types';

type Props = RootScreenProps<'Login'>;

const SOCIAL_LOGIN = {
  google: loginWithGoogle,
  kakao: loginWithKakao,
  naver: loginWithNaver,
} as const;

const SOCIAL_LABEL: Record<'google' | 'kakao' | 'naver', string> = {
  google: 'Google',
  kakao: '카카오',
  naver: '네이버',
};

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saveId, setSaveId] = useState(true);
  const [socialLoading, setSocialLoading] = useState<AuthProvider | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    const account = await getAccount();
    if (!account) {
      Alert.alert('가입된 계정이 없어요', '먼저 회원가입을 진행해주세요.');
      return;
    }
    if (account.email !== email.trim() || account.password !== password) {
      Alert.alert('로그인 실패', '이메일 또는 비밀번호가 일치하지 않아요.');
      return;
    }
    await setLoggedIn(true);
    const onboardingDone = await isOnboardingDone();
    navigation.reset({
      index: 0,
      routes: [{ name: onboardingDone ? 'Main' : 'OnboardingIntro' }],
    });
  };

  const handleSocial = async (provider: 'google' | 'kakao' | 'naver') => {
    if (socialLoading) return;
    setSocialLoading(provider);
    try {
      const result = await SOCIAL_LOGIN[provider]();
      if (result.status === 'cancelled') {
        return;
      }
      if (result.status === 'not_configured') {
        Alert.alert(
          `${SOCIAL_LABEL[provider]} 로그인 준비 중`,
          '아직 발급받은 앱 키가 설정되지 않았어요. mobile/OAUTH_SETUP.md 안내를 참고해 Client ID를 등록해주세요.'
        );
        return;
      }
      if (result.status === 'error') {
        Alert.alert(`${SOCIAL_LABEL[provider]} 로그인 실패`, result.message);
        return;
      }

      const existing = await getAccount();
      await saveAccount({
        email: result.profile.email,
        name: result.profile.name,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        provider: result.profile.provider,
        providerId: result.profile.providerId,
      });
      await setLoggedIn(true);
      const onboardingDone = await isOnboardingDone();
      navigation.reset({
        index: 0,
        routes: [{ name: onboardingDone ? 'Main' : 'OnboardingIntro' }],
      });
    } finally {
      setSocialLoading(null);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Ionicons name="checkmark-done" size={18} color="#fff" />
          </View>
          <Text style={styles.logo}>WorkProof</Text>
        </View>

        <Text style={styles.title}>로그인</Text>
        <Text style={styles.subtitle}>계정으로 로그인하세요.</Text>

        <View style={styles.form}>
          <FieldInput
            icon="mail-outline"
            placeholder="이메일 주소"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <FieldInput
            icon="lock-closed-outline"
            placeholder="비밀번호"
            secureTextEntry
            toggleSecure
            value={password}
            onChangeText={setPassword}
          />

          <View style={styles.optionsRow}>
            <Checkbox checked={saveId} onToggle={() => setSaveId((v) => !v)} label="아이디 저장" />
            <Pressable
              onPress={() => navigation.navigate('ResetPassword')}
              accessibilityRole="button"
              accessibilityLabel="비밀번호 찾기"
            >
              <Text style={styles.link}>비밀번호 찾기</Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={styles.primaryButton}
          onPress={handleLogin}
          accessibilityRole="button"
          accessibilityLabel="로그인"
        >
          <Text style={styles.primaryButtonText}>로그인</Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable
          style={[styles.kakaoButton, socialLoading === 'kakao' && styles.socialButtonBusy]}
          onPress={() => handleSocial('kakao')}
          disabled={socialLoading !== null}
          accessibilityRole="button"
          accessibilityLabel="카카오로 로그인"
        >
          <Ionicons name="chatbubble" size={16} color="#1B1F1E" />
          <Text style={styles.kakaoButtonText}>
            {socialLoading === 'kakao' ? '연결하는 중...' : '카카오로 로그인'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.googleButton, socialLoading === 'google' && styles.socialButtonBusy]}
          onPress={() => handleSocial('google')}
          disabled={socialLoading !== null}
          accessibilityRole="button"
          accessibilityLabel="Google로 로그인"
        >
          <GoogleLogo size={18} />
          <Text style={styles.googleButtonText}>
            {socialLoading === 'google' ? '연결하는 중...' : 'Google로 로그인'}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.naverButton, socialLoading === 'naver' && styles.socialButtonBusy]}
          onPress={() => handleSocial('naver')}
          disabled={socialLoading !== null}
          accessibilityRole="button"
          accessibilityLabel="네이버로 로그인"
        >
          <Text style={styles.naverLogo}>N</Text>
          <Text style={styles.naverButtonText}>
            {socialLoading === 'naver' ? '연결하는 중...' : '네이버로 로그인'}
          </Text>
        </Pressable>

        <Pressable
          style={styles.footer}
          onPress={() => navigation.navigate('Signup')}
          accessibilityRole="button"
          accessibilityLabel="회원가입 화면으로 이동"
        >
          <Text style={styles.footerText}>
            처음이신가요? <Text style={styles.footerLink}>회원가입</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  socialButtonBusy: { opacity: 0.6 },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.xl, alignItems: 'stretch' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
  logoBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { fontSize: 20, fontWeight: '800', color: colors.primaryDark },
  title: { fontSize: 24, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 14, color: colors.subtext, marginTop: 4, marginBottom: spacing.lg },
  form: { marginTop: spacing.xs },
  optionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  link: { color: colors.subtext, fontSize: 13 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadow.card,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.lg, gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.subtext, fontSize: 12 },
  kakaoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#FEE500',
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginBottom: spacing.sm,
  },
  kakaoButtonText: { color: '#1B1F1E', fontWeight: '700', fontSize: 15 },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#747775',
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    marginBottom: spacing.sm,
  },
  googleButtonText: { color: '#1F1F1F', fontFamily: fonts.medium, fontSize: 15 },
  naverButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#03C75A',
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
  },
  naverLogo: { color: '#fff', fontWeight: '900', fontSize: 15 },
  naverButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footer: { marginTop: spacing.xl, alignItems: 'center' },
  footerText: { fontSize: 13, color: colors.subtext },
  footerLink: { color: colors.primaryDark, fontWeight: '700' },
});
