import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { FieldInput } from '../../../ui/components/forms/FieldInput';
import { EmailDomainField, buildEmail, parseEmail } from '../../../ui/components/forms/EmailDomainField';
import { Checkbox } from '../../../ui/components/forms/Checkbox';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '../../../ui/components/display/GoogleLogo';
import { Alert } from '../../../ui/components/feedback/Alert';
import type { RootScreenProps } from '../../../app/navigation/types';
import { getAccount, isOnboardingDone, setLoggedIn } from '../../../services/storage/storage';
import { useAuth } from '../state/AuthContext';
import { authErrorMessage, SOCIAL_BACKEND_SESSION_FAILED } from '../services/authErrors';
import { colors, fonts, radius, shadow, spacing, control, typography } from '../../../ui/design_system';
import { SOCIAL_LOGIN, SOCIAL_LABEL, loginWithNaver, type SocialLoginResult } from '../services/social/socialLogin';
import type { AuthProvider } from '../../../types/domain';
import { socialErrorMessage } from '../services/social/socialAuthErrors';
import { ApiError } from '../../../services/api/errors';

type Props = RootScreenProps<'Login'>;

export default function LoginScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { login, loginWithBridgeSession, loginWithSocialCredential } = useAuth();
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
    if (route.params?.returnToAi && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
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
      Alert.alert(`${SOCIAL_LABEL[provider]} 로그인 실패`, socialErrorMessage(provider, result.code));
      return;
    }

    if (!result.bridgeSessionId) {
      const existing = await getAccount();
      const isMatchingAccount =
        existing?.provider === result.profile.provider && existing?.providerId === result.profile.providerId;
      if (!isMatchingAccount) {
        Alert.alert('\uac00\uc785\ub41c \uacc4\uc815\uc774 \uc5c6\uc5b4\uc694', '\uba3c\uc800 \ud68c\uc6d0\uac00\uc785\uc744 \uc9c4\ud589\ud574\uc8fc\uc138\uc694.');
        return;
      }
    }
    // 소셜 provider 인증과 WorkProof 백엔드 인증을 한 단계로 마친 뒤에만 로컬
    // 로그인 플래그를 세운다. bridgeSessionId(Kakao Web/Expo Go)는 일회성 bridge
    // exchange로, Google/Naver Web credential은 서버 검증 /auth/social로 교환한다.
    // 이 순서를 뒤집으면 교환 실패 시 앱만 로그인된 반쪽 상태가 다시 생긴다.
    let backendSessionReady = true;
    try {
      if (result.bridgeSessionId) {
        await loginWithBridgeSession(result.bridgeSessionId, result.bridgeApiUrl, 'login');
      } else if (result.providerCredential) {
        await loginWithSocialCredential({
          provider,
          providerUserId: result.profile.providerId,
          email: result.profile.email || null,
          name: result.profile.name,
          credential: result.providerCredential,
        });
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404 && e.detail?.includes('\uac00\uc785\ub41c \uacc4\uc815\uc774 \uc5c6\uc5b4\uc694')) {
        Alert.alert('\uac00\uc785\ub41c \uacc4\uc815\uc774 \uc5c6\uc5b4\uc694', '\uba3c\uc800 \ud68c\uc6d0\uac00\uc785\uc744 \uc9c4\ud589\ud574\uc8fc\uc138\uc694.');
        return;
      }

      backendSessionReady = false;
      console.warn('[LoginScreen] backend social session stage failed:', e instanceof Error ? e.name : typeof e);
    }
    // 교환이 실패하면 앱 로그인만 된 반쪽 상태다. 예전에는 이것을 삼키고 "로그인 완료"만
    // 띄워서, 사용자는 AI 분석에서만 로그인을 다시 요구받는 이유를 알 수 없었다.
    if (!backendSessionReady) {
      Alert.alert(SOCIAL_BACKEND_SESSION_FAILED.title, SOCIAL_BACKEND_SESSION_FAILED.message, [
        { text: '확인', onPress: () => void goHomeAfterLogin() },
      ]);
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
      const result = await SOCIAL_LOGIN[provider]('login');
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
          style={({ pressed }) => [[styles.primaryButton, (emailLoading || socialLoading !== null) && styles.socialButtonBusy], pressed && control.pressed]}
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
          style={({ pressed }) => [[styles.kakaoButton, socialLoading === 'kakao' && styles.socialButtonBusy], pressed && control.pressed]}
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
          style={({ pressed }) => [[styles.googleButton, socialLoading === 'google' && styles.socialButtonBusy], pressed && control.pressed]}
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
          style={({ pressed }) => [[styles.naverButton, socialLoading === 'naver' && styles.socialButtonBusy], pressed && control.pressed]}
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
          style={({ pressed }) => [styles.footer, pressed && control.pressed]}
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
  socialButtonBusy: {
    opacity: 0.6 },
  container: {
    flex: 1,
    backgroundColor: colors.background },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    alignItems: 'stretch' },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.lg },
  logoBadge: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.primaryDark },
  title: {
    ...typography.title,
    color: colors.text },
  subtitle: {
    ...typography.body,
    color: colors.subtext,
    marginTop: 4,
    marginBottom: spacing.lg },
  form: {
    marginTop: spacing.xs },
  optionsRow: {
    gap: spacing.sm,
    flexWrap: 'wrap',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  link: {
    paddingVertical: spacing.control,
    minHeight: control.minTarget,
    ...typography.caption,
    color: colors.subtext,
    },
  primaryButton: {
    ...control.button,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.control,
    alignItems: 'center',
    marginTop: spacing.sm,
    ...shadow.card,
  },
  primaryButtonText: {
    ...typography.label,
    color: colors.onPrimary,
    },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
    gap: spacing.sm },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border },
  dividerText: {
    color: colors.subtext,
    fontSize: 12 },
  kakaoButton: {
    ...control.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#FEE500',
    borderRadius: radius.md,
    paddingVertical: spacing.control,
    marginBottom: spacing.sm,
  },
  kakaoButtonText: {
    color: '#1B1F1E',
    fontWeight: '700',
    fontSize: 15 },
  googleButton: {
    ...control.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#747775',
    borderRadius: radius.md,
    paddingVertical: spacing.control,
    marginBottom: spacing.sm,
  },
  googleButtonText: {
    color: '#1F1F1F',
    fontFamily: fonts.medium,
    fontSize: 15 },
  naverButton: {
    ...control.button,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: '#03C75A',
    borderRadius: radius.md,
    paddingVertical: spacing.control,
  },
  naverLogo: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15 },
  naverButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15 },
  footer: {
    justifyContent: 'center',
    minHeight: control.minTarget,
    marginTop: spacing.xl,
    alignItems: 'center' },
  footerText: {
    ...typography.caption,
    color: colors.subtext },
  footerLink: {
    color: colors.primaryDark,
    fontWeight: '700' },
});
