import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../display/Text';
import { FieldInput } from './FieldInput';
import { colors, radius, spacing } from '../../design_system';

export const EMAIL_DOMAINS = ['gmail.com', 'naver.com', 'daum.net', 'kakao.com', 'nate.com', 'icloud.com', 'outlook.com'];

export function buildEmail(local: string, domain: string, customDomain: string): string {
  const d = domain === 'custom' ? customDomain.trim() : domain;
  return `${local.trim()}@${d}`;
}

/** 전체 이메일 문자열을 아이디/도메인 칩 상태로 되돌린다(예: 로그인 화면 prefill). */
export function parseEmail(email: string): { local: string; domain: string; customDomain: string } {
  const at = email.lastIndexOf('@');
  if (at === -1) return { local: email, domain: EMAIL_DOMAINS[0], customDomain: '' };
  const local = email.slice(0, at);
  const domainPart = email.slice(at + 1);
  if (EMAIL_DOMAINS.includes(domainPart)) return { local, domain: domainPart, customDomain: '' };
  return { local, domain: 'custom', customDomain: domainPart };
}

interface EmailDomainFieldProps {
  local: string;
  onLocalChange: (v: string) => void;
  domain: string; // EMAIL_DOMAINS 중 하나 또는 'custom'
  onDomainChange: (v: string) => void;
  customDomain: string;
  onCustomDomainChange: (v: string) => void;
  localPlaceholder?: string;
  /** 아이디 + 선택한 도메인을 합친 최종 이메일을 아래에 미리 보여준다(회원가입 화면). */
  showPreview?: boolean;
}

/** '아이디' 입력 + 도메인 칩(gmail.com 등) + 직접입력을 묶은 이메일 입력 UI. 로그인/회원가입에서 공용으로 쓴다. */
export function EmailDomainField({
  local,
  onLocalChange,
  domain,
  onDomainChange,
  customDomain,
  onCustomDomainChange,
  localPlaceholder = '아이디',
  showPreview = false,
}: EmailDomainFieldProps) {
  const resolvedDomain = domain === 'custom' ? customDomain.trim() : domain;
  const previewEmail = local.trim() && resolvedDomain ? `${local.trim()}@${resolvedDomain}` : null;
  return (
    <View>
      <FieldInput
        icon="mail-outline"
        placeholder={localPlaceholder}
        autoCapitalize="none"
        keyboardType="email-address"
        value={local}
        onChangeText={onLocalChange}
      />
      {showPreview && previewEmail && (
        <Text style={styles.previewText} numberOfLines={1}>
          {previewEmail}
        </Text>
      )}
      <View style={styles.domainChipsRow}>
        {EMAIL_DOMAINS.map((d) => (
          <Pressable
            key={d}
            style={[styles.domainChip, domain === d && styles.domainChipActive]}
            onPress={() => onDomainChange(d)}
            accessibilityRole="button"
            accessibilityLabel={`도메인 @${d} 선택`}
          >
            <Text style={[styles.domainChipText, domain === d && styles.domainChipTextActive]}>@{d}</Text>
          </Pressable>
        ))}
        <Pressable
          style={[styles.domainChip, domain === 'custom' && styles.domainChipActive]}
          onPress={() => onDomainChange('custom')}
          accessibilityRole="button"
          accessibilityLabel="도메인 직접 입력 선택"
        >
          <Text style={[styles.domainChipText, domain === 'custom' && styles.domainChipTextActive]}>
            직접입력
          </Text>
        </Pressable>
      </View>
      {domain === 'custom' && (
        <FieldInput
          icon="globe-outline"
          placeholder="도메인 입력 (예: mycompany.co.kr)"
          autoCapitalize="none"
          value={customDomain}
          onChangeText={onCustomDomainChange}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  previewText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primaryDark,
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
  },
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
});
