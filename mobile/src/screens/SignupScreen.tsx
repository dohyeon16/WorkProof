import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../components/Text';
import { FieldInput } from '../components/FieldInput';
import { Checkbox } from '../components/Checkbox';
import { Ionicons } from '@expo/vector-icons';
import { Alert } from '../alert';
import type { RootScreenProps } from '../navigation/types';
import { saveAccount, setLoggedIn } from '../storage';
import { colors, radius, shadow, spacing } from '../theme';

type Props = RootScreenProps<'Signup'>;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s]).{8,16}$/;
const EMAIL_DOMAINS = ['gmail.com', 'naver.com', 'daum.net', 'kakao.com', 'nate.com', 'icloud.com', 'outlook.com'];

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

export default function SignupScreen({ navigation }: Props) {
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

  const getFinalEmail = () => {
    const domain = emailDomain === 'custom' ? emailCustomDomain.trim() : emailDomain;
    return `${emailLocal.trim()}@${domain}`;
  };

  // Step 3: 프로필
  const [name, setName] = useState('');
  const [finalAgree, setFinalAgree] = useState(false);

  const toggleAll = () => {
    const next = !allAgreed;
    setTermsService(next);
    setTermsPrivacy(next);
    setTermsMarketing(next);
  };

  const handleBack = () => {
    if (step === 1) {
      navigation.goBack();
    } else {
      setStep((s) => s - 1);
    }
  };

  const handleNextFromStep1 = () => {
    if (!termsService || !termsPrivacy) {
      Alert.alert('필수 약관에 동의해주세요.');
      return;
    }
    setStep(2);
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
    await saveAccount({
      email: getFinalEmail(),
      password,
      name: name.trim(),
      createdAt: new Date().toISOString(),
    });
    await setLoggedIn(true);
    navigation.reset({ index: 0, routes: [{ name: 'OnboardingIntro' }] });
  };

  const meta = STEP_META[step];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
            <FieldInput
              icon="mail-outline"
              placeholder="아이디"
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailLocal}
              onChangeText={setEmailLocal}
            />
            <View style={styles.domainChipsRow}>
              {EMAIL_DOMAINS.map((d) => (
                <Pressable
                  key={d}
                  style={[styles.domainChip, emailDomain === d && styles.domainChipActive]}
                  onPress={() => setEmailDomain(d)}
                  accessibilityRole="button"
                  accessibilityLabel={`도메인 @${d} 선택`}
                >
                  <Text style={[styles.domainChipText, emailDomain === d && styles.domainChipTextActive]}>
                    @{d}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                style={[styles.domainChip, emailDomain === 'custom' && styles.domainChipActive]}
                onPress={() => setEmailDomain('custom')}
                accessibilityRole="button"
                accessibilityLabel="도메인 직접 입력 선택"
              >
                <Text style={[styles.domainChipText, emailDomain === 'custom' && styles.domainChipTextActive]}>
                  직접입력
                </Text>
              </Pressable>
            </View>
            {emailDomain === 'custom' && (
              <FieldInput
                icon="globe-outline"
                placeholder="도메인 입력 (예: mycompany.co.kr)"
                autoCapitalize="none"
                value={emailCustomDomain}
                onChangeText={setEmailCustomDomain}
              />
            )}
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
  domainChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm + 2,
  },
  domainChip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  domainChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  domainChipText: { fontSize: 12, color: colors.subtext },
  domainChipTextActive: { color: '#fff', fontWeight: '700' },
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
});
