import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../../ui/components/display/Text';
import { FieldInput } from '../../../ui/components/forms/FieldInput';
import { EmailDomainField, EMAIL_DOMAINS, buildEmail } from '../../../ui/components/forms/EmailDomainField';
import { Checkbox } from '../../../ui/components/forms/Checkbox';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '../../../ui/components/display/GoogleLogo';
import { Alert } from '../../../ui/components/feedback/Alert';
import type { RootScreenProps } from '../../../app/navigation/types';
import { clearAllData, getAccount, saveAccount } from '../../../services/storage/storage';
import { useAuth } from '../state/AuthContext';
import { authErrorMessage, SOCIAL_BACKEND_SESSION_FAILED } from '../services/authErrors';
import { ApiError } from '../../../services/api/errors';
import { colors, fonts, radius, shadow, spacing, control, typography } from '../../../ui/design_system';
import { SOCIAL_LOGIN, SOCIAL_LABEL, loginWithNaver, type SocialLoginResult } from '../services/social/socialLogin';
import type { AuthProvider } from '../../../types/domain';
import { socialErrorMessage } from '../services/social/socialAuthErrors';

type Props = RootScreenProps<'Signup'>;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,16}$/;

// Step 3 상단에 로그인한 소셜 계정을 간단히 보여줄 때 이메일을 마스킹한다.
// 예: abcdef@gmail.com → abc***@gmail.com
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  return `${email.slice(0, Math.min(3, at))}***@${email.slice(at + 1)}`;
}

const STEP_META: Record<number, { title: string; subtitle: string }> = {
  1: {
    title: '회원가입 (1/3)',
    subtitle: '약관에 동의하고 계정 정보를 입력해주세요.' },
  2: {
    title: '회원가입 (2/3)',
    subtitle: '계정 정보를 입력해주세요.' },
  3: {
    title: '회원가입 (3/3)',
    subtitle: '마지막 정보를 입력하면 가입이 완료돼요.' },
};

function Stepper({ step }: { step: number }) {
  return (
    <View style={styles.stepperRow}>
      {[1, 2, 3].map((n, idx) => (
        <View key={n} style={styles.stepperItem}>
          <View
            style={[
              styles.stepCircle,
              n < step && styles.stepCircleDone,
              n === step && styles.stepCircleActive,
            ]}
          >
            {n < step ? (
              <Ionicons name="checkmark" size={14} color="#fff" />
            ) : (
              <Text style={[styles.stepNumber, n === step && styles.stepNumberActive]}>{n}</Text>
            )}
          </View>
          {idx < 2 && <View style={[styles.stepLine, n < step && styles.stepLineDone]} />}
        </View>
      ))}
    </View>
  );
}

export default function SignupScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { register, loginWithBridgeSession, loginWithSocialCredential } = useAuth();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1: 약관 동의
  const [termsService, setTermsService] = useState(false);
  const [termsPrivacy, setTermsPrivacy] = useState(false);
  const [termsMarketing, setTermsMarketing] = useState(false);
  const allAgreed = termsService && termsPrivacy && termsMarketing;

  // Step 2: 계정 정보
  const [emailLocal, setEmailLocal] = useState('');
  const [emailDomain, setEmailDomain] = useState<string>(EMAIL_DOMAINS[0]);
  const [emailCustomDomain, setEmailCustomDomain] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const getFinalEmail = () => buildEmail(emailLocal, emailDomain, emailCustomDomain);

  // Step 3: 프로필
  const [name, setName] = useState('');
  const [finalAgree, setFinalAgree] = useState(false);

  // 소셜 회원가입 (Step 1에서 진입 시 Step 2를 건너뛰고 Step 3으로 이동)
  const [socialLoading, setSocialLoading] = useState<AuthProvider | null>(null);
  const [socialProfile, setSocialProfile] = useState<{
    email: string;
    name: string;
    provider: AuthProvider;
    providerId: string;
    bridgeSessionId?: string;
    bridgeApiUrl?: string;
    providerCredential?: string;
  } | null>(null);
  // 소셜 인증 성공 직후 Step 3 상단에 잠깐 뜨는 "인증 완료" 안내(토스트 성격).
  // 아직 최종 회원가입은 아니므로 시스템 팝업 대신 화면 내 안내로만 표시하고,
  // 잠시 뒤 자동으로 사라진다.
  const [authNoticeVisible, setAuthNoticeVisible] = useState(false);

  useEffect(() => {
    if (!authNoticeVisible) return;
    const timer = setTimeout(() => setAuthNoticeVisible(false), 3500);
    return () => clearTimeout(timer);
  }, [authNoticeVisible]);

  const toggleAll = () => {
    const next = !allAgreed;
    setTermsService(next);
    setTermsPrivacy(next);
    setTermsMarketing(next);
  };

  const handleBack = () => {
    if (step === 1) {
      navigation.goBack();
    } else if (step === 3 && socialProfile) {
      setStep(1);
    } else {
      setStep((s) => s - 1);
    }
  };

  const handleNextFromStep1 = () => {
    if (!termsService || !termsPrivacy) {
      Alert.alert('필수 약관에 동의해주세요.');
      return;
    }
    setSocialProfile(null);
    setStep(2);
  };

  const finishSocialSignup = (provider: 'google' | 'kakao' | 'naver', result: SocialLoginResult) => {
    if (result.status === 'cancelled') {
      return;
    }
    if (result.status === 'not_configured') {
      Alert.alert(`${SOCIAL_LABEL[provider]} 회원가입 준비 중`, result.reason);
      return;
    }
    if (result.status === 'error') {
      Alert.alert(`${SOCIAL_LABEL[provider]} 회원가입 실패`, socialErrorMessage(provider, result.code));
      return;
    }
    setSocialProfile({
      email: result.profile.email,
      name: result.profile.name,
      provider: result.profile.provider,
      providerId: result.profile.providerId,
      bridgeSessionId: result.bridgeSessionId,
      bridgeApiUrl: result.bridgeApiUrl,
      providerCredential: result.providerCredential,
    });
    // provider가 이름을 주지 않았으면(빈 문자열) 비워두고 직접 입력하게 둔다.
    setName(result.profile.name ?? '');
    // 인증은 됐지만 최종 가입 전이므로 시스템 팝업이 아니라 Step 3 상단의
    // 짧은 화면 내 안내로만 알린다.
    setAuthNoticeVisible(true);
    setStep(3);
  };

  // 네이버는 전체 페이지 리다이렉트로 처리되므로, 리다이렉트에서 돌아온 뒤
  // App.tsx가 이 화면에 route.params.naverResume로 결과를 전달해준다.
  useEffect(() => {
    const resume = route.params?.naverResume;
    if (!resume) return;
    navigation.setParams({ naverResume: undefined });
    setSocialLoading('naver');
    finishSocialSignup('naver', resume.result);
    setSocialLoading(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.naverResume]);

  const handleSocialSignup = async (provider: 'google' | 'kakao' | 'naver') => {
    if (socialLoading) return;
    if (!termsService || !termsPrivacy) {
      Alert.alert('필수 약관에 동의해주세요.');
      return;
    }
    setSocialLoading(provider);
    if (provider === 'naver') {
      // 웹은 정상적인 경우 이 탭이 네이버로 이동해버리므로 아래 줄로 돌아오지
      // 않는다. Client ID 미설정 등 리다이렉트가 아예 일어나지 않은 경우에만
      // 결과가 반환된다. Android는 네이티브 SDK 플로우라 바로 결과가 온다.
      const result = await loginWithNaver('signup', 'Signup');
      finishSocialSignup('naver', result);
      setSocialLoading(null);
      return;
    }
    try {
      const result = await SOCIAL_LOGIN[provider]();
      finishSocialSignup(provider, result);
    } finally {
      setSocialLoading(null);
    }
  };

  const handleNextFromStep2 = () => {
    const domain = emailDomain === 'custom' ? emailCustomDomain.trim() : emailDomain;
    if (!emailLocal.trim() || !domain || !password || !passwordConfirm) {
      Alert.alert('모든 항목을 입력해주세요.');
      return;
    }
    if (!EMAIL_RE.test(getFinalEmail())) {
      Alert.alert('올바른 이메일 형식이 아니에요.');
      return;
    }
    if (!PASSWORD_RE.test(password)) {
      Alert.alert('비밀번호는 8~16자리로 영문, 숫자, 특수문자를 모두 포함해 입력해주세요.');
      return;
    }
    if (password !== passwordConfirm) {
      Alert.alert('비밀번호가 일치하지 않아요.');
      return;
    }
    setStep(3);
  };

  const handleSignup = async () => {
    if (submitting) return; // 중복 제출 방지
    if (!name.trim()) {
      Alert.alert('이름 또는 닉네임을 입력해주세요.');
      return;
    }
    if (!finalAgree) {
      Alert.alert('필수 약관 및 개인정보 수집·이용에 동의해주세요.');
      return;
    }

    // ---- 소셜 회원가입: 기존 로컬 흐름 그대로 유지 ----
    // 소셜 브릿지는 아직 Phase 2 토큰을 발급하지 않고 프로필만 돌려주므로,
    // 이메일 인증 연동과 분리해 로컬 Account 저장 방식을 그대로 둔다.
    if (socialProfile) {
      const existing = await getAccount();
      const alreadyRegistered =
        existing?.provider === socialProfile.provider &&
        existing?.providerId === socialProfile.providerId;
      if (alreadyRegistered) {
        Alert.alert(
          '이미 가입된 계정이에요',
          `${SOCIAL_LABEL[socialProfile.provider as 'google' | 'kakao' | 'naver']} 계정으로 이미 가입돼 있어요. 로그인해주세요.`
        );
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        return;
      }
      // provider 인증 결과를 WorkProof 백엔드 세션으로 먼저 교환한다. 성공 전에
      // 로컬 계정을 저장하면 앱만 가입된 반쪽 상태가 남아 AI가 다시 로그인 gate를
      // 띄우므로, bridge/direct credential 모두 같은 순서로 처리한다.
      let backendSessionReady = true;
      try {
        if (socialProfile.bridgeSessionId) {
          await loginWithBridgeSession(socialProfile.bridgeSessionId, socialProfile.bridgeApiUrl);
        } else if (socialProfile.providerCredential) {
          await loginWithSocialCredential({
            provider: socialProfile.provider as 'google' | 'kakao' | 'naver',
            providerUserId: socialProfile.providerId,
            email: socialProfile.email || null,
            name: name.trim(),
            credential: socialProfile.providerCredential,
          });
        }
      } catch (e) {
        backendSessionReady = false;
        console.warn('[SignupScreen] backend social session stage failed:', e instanceof Error ? e.name : typeof e);
      }
      if (!backendSessionReady) {
        Alert.alert(SOCIAL_BACKEND_SESSION_FAILED.title, SOCIAL_BACKEND_SESSION_FAILED.message, [
          { text: '확인', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) },
        ]);
        return;
      }
      await clearAllData();
      await saveAccount({
        email: socialProfile.email,
        password: undefined,
        name: name.trim(),
        createdAt: new Date().toISOString(),
        provider: socialProfile.provider,
        providerId: socialProfile.providerId,
      });
      Alert.alert('회원가입 완료', 'WorkProof 회원가입이 완료되었어요.', [
        { text: '확인', onPress: () => navigation.reset({ index: 0, routes: [{ name: 'Login' }] }) },
      ]);
      return;
    }

    // ---- 이메일 회원가입: Phase 2 백엔드(/api/v1/auth/register) ----
    const signupEmail = getFinalEmail();
    setSubmitting(true);
    try {
      // 가입 성공과 인증 성공은 분리한다. register 응답은 계정 생성 확인에만 쓰고,
      // 토큰/세션은 사용자가 로그인 화면에서 실제 로그인한 뒤에만 저장한다.
      await register({ email: signupEmail, password, name: name.trim() });
      // 새 계정이 이전 기기 로컬 데이터와 섞이지 않게 정리하되 인증 세션은 만들지 않는다.
      await clearAllData();
      Alert.alert('회원가입 완료', 'WorkProof 회원가입이 완료되었어요.', [
        {
          text: '로그인하기',
          onPress: () =>
            navigation.reset({ index: 0, routes: [{ name: 'Login', params: { prefillEmail: signupEmail } }] }),
        },
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert('이미 가입된 이메일이에요', authErrorMessage(e, '이미 가입된 이메일이에요.'), [
          {
            text: '확인',
            onPress: () =>
              navigation.reset({ index: 0, routes: [{ name: 'Login', params: { prefillEmail: signupEmail } }] }),
          },
        ]);
      } else {
        Alert.alert('회원가입 실패', authErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const meta = STEP_META[step];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && control.pressed]}
          onPress={handleBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="이전으로"
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>

        <Text style={styles.title}>{meta.title}</Text>
        <Text style={styles.subtitle}>{meta.subtitle}</Text>

        <Stepper step={step} />

        {step === 1 && (
          <View>
            <Text style={styles.sectionLabel}>약관 동의</Text>
            <View style={styles.termsCard}>
              <Checkbox checked={allAgreed} onToggle={toggleAll} label="전체 동의합니다." bold />
              <View style={styles.termsDivider} />
              <Pressable
                style={({ pressed }) => [styles.termsRow, pressed && control.pressed]}
                onPress={() => navigation.navigate('LegalDocument', { doc: 'terms' })}
                accessibilityRole="button"
                accessibilityLabel="서비스 이용약관 상세보기"
              >
                <Checkbox
                  checked={termsService}
                  onToggle={() => setTermsService((v) => !v)}
                  label="[필수] 서비스 이용약관 동의"
                />
                <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.termsRow, pressed && control.pressed]}
                onPress={() => navigation.navigate('LegalDocument', { doc: 'privacy' })}
                accessibilityRole="button"
                accessibilityLabel="개인정보 처리방침 상세보기"
              >
                <Checkbox
                  checked={termsPrivacy}
                  onToggle={() => setTermsPrivacy((v) => !v)}
                  label="[필수] 개인정보 처리방침 동의"
                />
                <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.termsRow, pressed && control.pressed]}
                onPress={() => navigation.navigate('LegalDocument', { doc: 'marketing' })}
                accessibilityRole="button"
                accessibilityLabel="마케팅 정보 수신 동의 상세보기"
              >
                <Checkbox
                  checked={termsMarketing}
                  onToggle={() => setTermsMarketing((v) => !v)}
                  label="[선택] 마케팅 정보 수신 동의"
                />
                <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && control.pressed]}
              onPress={handleNextFromStep1}
              accessibilityRole="button"
              accessibilityLabel="다음으로"
            >
              <Text style={styles.primaryButtonText}>다음으로</Text>
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>또는 소셜 계정으로 가입</Text>
              <View style={styles.dividerLine} />
            </View>

            <Pressable
              style={({ pressed }) => [[styles.kakaoButton, socialLoading === 'kakao' && styles.socialButtonBusy], pressed && control.pressed]}
              onPress={() => handleSocialSignup('kakao')}
              disabled={socialLoading !== null}
              accessibilityRole="button"
              accessibilityLabel="카카오로 회원가입"
            >
              <Ionicons name="chatbubble" size={16} color="#1B1F1E" />
              <Text style={styles.kakaoButtonText}>
                {socialLoading === 'kakao' ? '연결하는 중...' : '카카오로 회원가입'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [[styles.googleButton, socialLoading === 'google' && styles.socialButtonBusy], pressed && control.pressed]}
              onPress={() => handleSocialSignup('google')}
              disabled={socialLoading !== null}
              accessibilityRole="button"
              accessibilityLabel="Google로 회원가입"
            >
              <GoogleLogo size={18} />
              <Text style={styles.googleButtonText}>
                {socialLoading === 'google' ? '연결하는 중...' : 'Google로 회원가입'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [[styles.naverButton, socialLoading === 'naver' && styles.socialButtonBusy], pressed && control.pressed]}
              onPress={() => handleSocialSignup('naver')}
              disabled={socialLoading !== null}
              accessibilityRole="button"
              accessibilityLabel="네이버로 회원가입"
            >
              <Text style={styles.naverLogo}>N</Text>
              <Text style={styles.naverButtonText}>
                {socialLoading === 'naver' ? '연결하는 중...' : '네이버로 회원가입'}
              </Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.footer, pressed && control.pressed]}
              onPress={() => navigation.goBack()}
              accessibilityRole="button"
              accessibilityLabel="로그인으로 돌아가기"
            >
              <Text style={styles.footerText}>로그인으로 돌아가기</Text>
            </Pressable>
          </View>
        )}

        {step === 2 && (
          <View>
            <Text style={styles.label}>이메일</Text>
            <EmailDomainField
              local={emailLocal}
              onLocalChange={setEmailLocal}
              domain={emailDomain}
              onDomainChange={setEmailDomain}
              customDomain={emailCustomDomain}
              onCustomDomainChange={setEmailCustomDomain}
              showPreview
            />
            <Text style={styles.label}>비밀번호</Text>
            <FieldInput
              icon="lock-closed-outline"
              placeholder="비밀번호를 입력해주세요"
              secureTextEntry
              toggleSecure
              value={password}
              onChangeText={setPassword}
            />
            <Text style={styles.help}>8~16자리, 영문·숫자·특수문자를 모두 포함해주세요.</Text>

            <Text style={styles.label}>비밀번호 확인</Text>
            <FieldInput
              icon="lock-closed-outline"
              placeholder="비밀번호를 다시 입력해주세요"
              secureTextEntry
              toggleSecure
              value={passwordConfirm}
              onChangeText={setPasswordConfirm}
            />

            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && control.pressed]}
              onPress={handleNextFromStep2}
              accessibilityRole="button"
              accessibilityLabel="다음으로"
            >
              <Text style={styles.primaryButtonText}>다음으로</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.footer, pressed && control.pressed]}
              onPress={() => setStep(1)}
              accessibilityRole="button"
              accessibilityLabel="이전 단계로 돌아가기"
            >
              <Text style={styles.footerText}>이전 단계로 돌아가기</Text>
            </Pressable>
          </View>
        )}

        {step === 3 && (
          <View>
            {socialProfile && authNoticeVisible && (
              <View style={styles.successBanner}>
                <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                <Text style={styles.successBannerText}>
                  {SOCIAL_LABEL[socialProfile.provider as 'google' | 'kakao' | 'naver']} 계정 인증이
                  완료되었어요.
                </Text>
              </View>
            )}
            {socialProfile && (
              <View style={styles.noticeCard}>
                <Ionicons name="link" size={20} color={colors.primaryDark} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.noticeAccount}>
                    {SOCIAL_LABEL[socialProfile.provider as 'google' | 'kakao' | 'naver']} 계정
                    {socialProfile.email ? ` · ${maskEmail(socialProfile.email)}` : ''}
                  </Text>
                  <Text style={styles.noticeText}>가입 정보를 확인해주세요.</Text>
                </View>
              </View>
            )}
            <Text style={styles.label}>이름 또는 닉네임</Text>
            <FieldInput icon="person-outline" placeholder="도현" value={name} onChangeText={setName} />
            <Text style={styles.help}>WorkProof에서 사용할 이름을 입력해주세요.</Text>

            <View style={styles.noticeCard}>
              <Ionicons name="shield-checkmark" size={20} color={colors.primaryDark} />
              <Text style={styles.noticeText}>
                안전한 서비스 이용을 위해 입력하신 정보는 암호화하여 안전하게 보관합니다. 동의하신
                목적 이외에는 사용되지 않습니다.
              </Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.termsRow, pressed && control.pressed]}
              onPress={() =>
                Alert.alert('약관 및 개인정보', '확인할 문서를 선택해주세요.', [
                  { text: '서비스 이용약관', onPress: () => navigation.navigate('LegalDocument', { doc: 'terms' }) },
                  { text: '개인정보 처리방침', onPress: () => navigation.navigate('LegalDocument', { doc: 'privacy' }) },
                  { text: '취소', style: 'cancel' },
                ])
              }
              accessibilityRole="button"
              accessibilityLabel="약관 및 개인정보 상세보기"
            >
              <Checkbox
                checked={finalAgree}
                onToggle={() => setFinalAgree((v) => !v)}
                label="필수 약관 및 개인정보 수집·이용에 동의합니다."
              />
              <Ionicons name="chevron-forward" size={16} color={colors.subtext} />
            </Pressable>

            <Pressable
              style={({ pressed }) => [[styles.primaryButton, submitting && styles.socialButtonBusy], pressed && control.pressed]}
              onPress={handleSignup}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="회원가입 완료"
            >
              <Text style={styles.primaryButtonText}>
                {submitting ? '가입하는 중...' : '회원가입 완료'}
              </Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.footer, pressed && control.pressed]}
              onPress={() => setStep(2)}
              accessibilityRole="button"
              accessibilityLabel="이전 단계로 돌아가기"
            >
              <Text style={styles.footerText}>이전 단계로 돌아가기</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl * 2 },
  backButton: {
    ...control.iconButton,
    marginBottom: spacing.sm,
    alignSelf: 'flex-start' },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: 'center' },
  subtitle: {
    ...typography.body,
    color: colors.subtext,
    textAlign: 'center',
    marginTop: 4 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  stepperItem: {
    flexDirection: 'row',
    alignItems: 'center' },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary },
  stepCircleDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary },
  stepNumber: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.subtext },
  stepNumberActive: {
    color: '#fff' },
  stepLine: {
    width: 40,
    height: 1.5,
    backgroundColor: colors.border,
    marginHorizontal: 4 },
  stepLineDone: {
    backgroundColor: colors.primary },
  sectionLabel: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.sm },
  termsCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
    ...shadow.card,
  },
  termsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm },
  termsRow: {
    gap: spacing.sm,
    minHeight: control.minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs + 2,
  },
  label: {
    ...typography.label,
    color: colors.text,
    marginBottom: spacing.xs },
  help: {
    ...typography.caption,
    color: colors.subtext,
    marginTop: -spacing.xs,
    marginBottom: spacing.md },
  noticeCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  noticeText: {
    ...typography.caption,
    flex: 1,
    color: colors.text,
    },
  noticeAccount: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2 },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: colors.successLight,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  successBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.success },
  primaryButton: {
    ...control.button,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.control,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadow.card,
  },
  primaryButtonText: {
    ...typography.label,
    color: colors.onPrimary,
    },
  footer: {
    justifyContent: 'center',
    minHeight: control.minTarget,
    marginTop: spacing.lg,
    alignItems: 'center' },
  footerText: {
    ...typography.caption,
    color: colors.subtext },
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
  socialButtonBusy: {
    opacity: 0.6 },
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
    marginBottom: spacing.sm,
  },
  naverLogo: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15 },
  naverButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15 },
});
