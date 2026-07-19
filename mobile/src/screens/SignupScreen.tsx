import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../components/Text';
import { FieldInput } from '../components/FieldInput';
import { EmailDomainField, EMAIL_DOMAINS, buildEmail } from '../components/EmailDomainField';
import { Checkbox } from '../components/Checkbox';
import { Ionicons } from '@expo/vector-icons';
import { GoogleLogo } from '../components/GoogleLogo';
import { Alert } from '../alert';
import type { RootScreenProps } from '../navigation/types';
import { clearAllData, getAccount, saveAccount } from '../storage';
import { colors, fonts, radius, shadow, spacing } from '../theme';
import { SOCIAL_LOGIN, SOCIAL_LABEL, loginWithNaver, type SocialLoginResult } from '../auth/socialLogin';
import type { AuthProvider } from '../types';

type Props = RootScreenProps<'Signup'>;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,16}$/;

const STEP_META: Record<number, { title: string; subtitle: string }> = {
  1: { title: '회원가입 (1/3)', subtitle: '약관에 동의하고 계정 정보를 입력해주세요.' },
  2: { title: '회원가입 (2/3)', subtitle: '계정 정보를 입력해주세요.' },
  3: { title: '회원가입 (3/3)', subtitle: '마지막 정보를 입력하면 가입이 완료돼요.' },
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
  const [step, setStep] = useState(1);

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
  } | null>(null);

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
      Alert.alert(`${SOCIAL_LABEL[provider]} 회원가입 실패`, result.message);
      return;
    }
    setSocialProfile({
      email: result.profile.email,
      name: result.profile.name,
      provider: result.profile.provider,
      providerId: result.profile.providerId,
    });
    setName(result.profile.name);
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
    if (!name.trim()) {
      Alert.alert('이름 또는 닉네임을 입력해주세요.');
      return;
    }
    if (!finalAgree) {
      Alert.alert('필수 약관 및 개인정보 수집·이용에 동의해주세요.');
      return;
    }
    // 소셜 로그인은 provider가 신규/기존을 직접 구분해주지 않는다 — 브리지
    // 백엔드는 프로필만 돌려줄 뿐 계정 관리를 하지 않으므로, "회원가입" 버튼을
    // 눌렀어도 이미 같은 소셜 계정(provider + providerId)이 이 기기에 저장돼
    // 있으면 데이터를 지우지 않고 로그인으로 안내한다.
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
    }

    const signupEmail = socialProfile ? socialProfile.email : getFinalEmail();
    await clearAllData();
    await saveAccount({
      email: signupEmail,
      password: socialProfile ? undefined : password,
      name: name.trim(),
      createdAt: new Date().toISOString(),
      provider: socialProfile?.provider,
      providerId: socialProfile?.providerId,
    });

    if (socialProfile) {
      Alert.alert(
        '회원가입 완료',
        `${SOCIAL_LABEL[socialProfile.provider as 'google' | 'kakao' | 'naver']} 계정으로 가입했어요. 같은 방법으로 로그인해주세요.`
      );
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    } else {
      Alert.alert('회원가입 완료', '가입하신 이메일과 비밀번호로 로그인해주세요.');
      navigation.reset({ index: 0, routes: [{ name: 'Login', params: { prefillEmail: signupEmail } }] });
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
          style={styles.backButton}
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
                style={styles.termsRow}
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
                style={styles.termsRow}
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
                style={styles.termsRow}
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
              style={styles.primaryButton}
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
              style={[styles.kakaoButton, socialLoading === 'kakao' && styles.socialButtonBusy]}
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
              style={[styles.googleButton, socialLoading === 'google' && styles.socialButtonBusy]}
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
              style={[styles.naverButton, socialLoading === 'naver' && styles.socialButtonBusy]}
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
              style={styles.footer}
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
              style={styles.primaryButton}
              onPress={handleNextFromStep2}
              accessibilityRole="button"
              accessibilityLabel="다음으로"
            >
              <Text style={styles.primaryButtonText}>다음으로</Text>
            </Pressable>
            <Pressable
              style={styles.footer}
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
            {socialProfile && (
              <View style={styles.noticeCard}>
                <Ionicons name="link" size={20} color={colors.primaryDark} />
                <Text style={styles.noticeText}>
                  {SOCIAL_LABEL[socialProfile.provider as 'google' | 'kakao' | 'naver']} 계정
                  {socialProfile.email ? `(${socialProfile.email})` : ''}으로 가입을 완료해요. 닉네임만
                  확인해주세요.
                </Text>
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
              style={styles.termsRow}
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
              style={styles.primaryButton}
              onPress={handleSignup}
              accessibilityRole="button"
              accessibilityLabel="회원가입 완료"
            >
              <Text style={styles.primaryButtonText}>회원가입 완료</Text>
            </Pressable>
            <Pressable
              style={styles.footer}
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
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl * 2 },
  backButton: { marginBottom: spacing.sm, alignSelf: 'flex-start' },
  title: { fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.subtext, textAlign: 'center', marginTop: 4 },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  stepperItem: { flexDirection: 'row', alignItems: 'center' },
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
  stepCircleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepCircleDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNumber: { fontSize: 13, fontWeight: '700', color: colors.subtext },
  stepNumberActive: { color: '#fff' },
  stepLine: { width: 40, height: 1.5, backgroundColor: colors.border, marginHorizontal: 4 },
  stepLineDone: { backgroundColor: colors.primary },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  termsCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
    ...shadow.card,
  },
  termsDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs + 2,
  },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  help: { fontSize: 12, color: colors.subtext, marginTop: -spacing.xs, marginBottom: spacing.md },
  noticeCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: 12, color: colors.text, lineHeight: 18 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 6,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadow.card,
  },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  footer: { marginTop: spacing.lg, alignItems: 'center' },
  footerText: { fontSize: 13, color: colors.subtext },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.lg, gap: spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.subtext, fontSize: 12 },
  socialButtonBusy: { opacity: 0.6 },
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
    marginBottom: spacing.sm,
  },
  naverLogo: { color: '#fff', fontWeight: '900', fontSize: 15 },
  naverButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
