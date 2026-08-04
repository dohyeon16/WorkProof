import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../shared/components/Text';
import { FieldInput } from '../../../shared/components/FieldInput';
import { EmailDomainField, buildEmail, parseEmail } from '../../../shared/components/EmailDomainField';
import { Checkbox } from '../../../shared/components/Checkbox';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '../../../shared/components/GoogleLogo';
import { Alert } from '../../../shared/components/alert';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getAccount, isOnboardingDone, setLoggedIn } from '../../../core/data/storage';
import { useAuth } from '../state/AuthContext';
import { authErrorMessage } from '../services/authErrors';
import { colors, fonts, radius, shadow, spacing } from '../../../shared/theme';
import { SOCIAL_LOGIN, SOCIAL_LABEL, loginWithNaver, type SocialLoginResult } from '../services/socialLogin';
import type { AuthProvider } from '../../../core/domain/models/types';

type Props = RootScreenProps<'Login'>;

export default function LoginScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const prefill = parseEmail(route.params?.prefillEmail ?? '');
  const [emailLocal, setEmailLocal] = useState(prefill.local);
  const [emailDomain, setEmailDomain] = useState(prefill.domain);
  const [emailCustomDomain, setEmailCustomDomain] = useState(prefill.customDomain);
  const [password, setPassword] = useState('');
  const [saveId, setSaveId] = useState(true);
  const [emailLoading, setEmailLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<AuthProvider | null>(null);

  // Alert의 '확인'을 누른 뒤에 홈(또는 온보딩)으로 이동한다. 이메일/소셜
  // 로그인이 각자 다른 안내 문구를 쓰되 이동 로직은 공유한다.
  const goHomeAfterLogin = async () => {
    const onboardingDone = await isOnboardingDone();
    navigation.reset({
      index: 0,
      routes: [{ name: onboardingDone ? 'Main' : 'OnboardingIntro' }],
    });
  };

  const enterAppAfterLogin = () => {
    Alert.alert('로그인 성공', '로그인에 성공하였습니다.', [
      { text: '확인', onPress: () => void goHomeAfterLogin() },
    ]);
  };

  const handleLogin = async () => {
    if (emailLoading || socialLoading) return; // 중복 제출 방지
    if (!emailLocal.trim() || !password) {
      Alert.alert('이메일과 비밀번호를 입력해주세요.');
      return;
    }
    const email = buildEmail(emailLocal, emailDomain, emailCustomDomain);
    setEmailLoading(true);
    try {
      // 백엔드 이메일 로그인. 사용자 열거 방지를 위해 서버는 실패를 통합 메시지로
      // 내려주며, 그 문구를 그대로 노출한다(존재하지 않는 계정/오답 구분 안 함).
      await login(email, password);
      enterAppAfterLogin();
    } catch (e) {
      Alert.alert('로그인 실패', authErrorMessage(e, '이메일 또는 비밀번호가 올바르지 않아요.'));
    } finally {
      setEmailLoading(false);
    }
  };

  const finishSocialLogin = async (provider: 'google' | 'kakao' | 'naver', result: SocialLoginResult) => {
    if (result.status === 'cancelled') {
      return;
    }
    if (result.status === 'not_configured') {
      Alert.alert(`${SOCIAL_LABEL[provider]} 로그인 준비 중`, result.reason);
      return;
    }
    if (result.status === 'error') {
      Alert.alert(`${SOCIAL_LABEL[provider]} 로그인 실패`, result.message);
      return;
    }

    const existing = await getAccount();
    const isMatchingAccount =
      existing?.provider === result.profile.provider && existing?.providerId === result.profile.providerId;
    if (!isMatchingAccount) {
      Alert.alert('가입된 계정이 없어요', '먼저 회원가입을 진행해주세요.');
      return;
    }
    await setLoggedIn(true);
    // 소셜 인증 성공 → 앱 복귀 직후 앱 내부 팝업만 짧게 표시한다(Render 성공
    // 웹페이지는 정상 흐름에서 더 이상 보이지 않는다). 확인 후 홈으로 이동.
    Alert.alert('로그인 완료', '로그인되었습니다.', [
      { text: '확인', onPress: () => void goHomeAfterLogin() },
    ]);
  };

  // 네이버는 전체 페이지 리다이렉트로 처리되므로, 리다이렉트에서 돌아온 뒤
  // App.tsx가 이 화면에 route.params.naverResume로 결과를 전달해준다.
  useEffect(() => {
    const resume = route.params?.naverResume;
    if (!resume) return;
    navigation.setParams({ naverResume: undefined });
    setSocialLoading('naver');
    finishSocialLogin('naver', resume.result).finally(() => setSocialLoading(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.naverResume]);

  const handleSocial = async (provider: 'google' | 'kakao' | 'naver') => {
    if (socialLoading) return;
    setSocialLoading(provider);
    if (provider === 'naver') {
      // 웹은 정상적인 경우 이 탭이 네이버로 이동해버리므로 아래 줄로 돌아오지
      // 않는다. Client ID 미설정 등 리다이렉트가 아예 일어나지 않은 경우에만
      // 결과가 반환된다. Android는 네이티브 SDK 플로우라 바로 결과가 온다.
      const result = await loginWithNaver('login', 'Login');
      await finishSocialLogin('naver', result);
      setSocialLoading(null);
      return;
    }
    try {
      const result = await SOCIAL_LOGIN[provider]();
      await finishSocialLogin(provider, result);
    } finally {
      setSocialLoading(null);
    }
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
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Ionicons name="checkmark-done" size={18} color="#fff" />
          </View>
          <Text style={styles.logo}>WorkProof</Text>
        </View>

        <Text style={styles.title}>로그인</Text>
        <Text style={styles.subtitle}>계정으로 로그인하세요.</Text>

        <View style={styles.form}>
          <EmailDomainField
            local={emailLocal}
            onLocalChange={setEmailLocal}
            domain={emailDomain}
            onDomainChange={setEmailDomain}
            customDomain={emailCustomDomain}
            onCustomDomainChange={setEmailCustomDomain}
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
          style={[styles.primaryButton, (emailLoading || socialLoading !== null) && styles.socialButtonBusy]}
          onPress={handleLogin}
          disabled={emailLoading || socialLoading !== null}
          accessibilityRole="button"
          accessibilityLabel="로그인"
        >
          <Text style={styles.primaryButtonText}>{emailLoading ? '로그인 중...' : '로그인'}</Text>
        </Pressable>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>또는</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable
          style={[styles.kakaoButton, socialLoading === 'kakao' && styles.socialButtonBusy]}
          onPress={() => handleSocial('kakao')}
          disabled={socialLoading !== null || emailLoading}
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
          disabled={socialLoading !== null || emailLoading}
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
          disabled={socialLoading !== null || emailLoading}
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
