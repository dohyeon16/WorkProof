import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../display/Text';
import { colors, control, spacing, surface, typography } from '../../design_system';

export interface AlertButtonSpec {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButtonSpec[];
}

const EMPTY_STATE: AlertState = { visible: false, title: '', message: undefined, buttons: [] };

let currentState: AlertState = EMPTY_STATE;
let listener: ((state: AlertState) => void) | null = null;

function emit(state: AlertState) {
  currentState = state;
  listener?.(state);
}

/**
 * 모든 플랫폼에서 동일한 WorkProof 디자인 시스템 다이얼로그를 띄운다.
 *
 * 이전에는 네이티브에서만 OS 의 Alert.alert 로 위임했다(웹은 react-native-web 의
 * Alert.alert 가 no-op 이라 커스텀 모달이 필요했다). 그 결과 실기기에서는 로그인 완료·
 * AI 로그인 안내 등 앱의 모든 다이얼로그가 앱 디자인과 무관한 OS 기본 알림으로 떴다.
 * 호출부(16개 화면, 100여 곳)는 그대로 두고 이 한 곳에서 렌더링을 통일한다.
 */
function alertImpl(title: string, message?: string, buttons?: AlertButtonSpec[]): void {
  emit({
    visible: true,
    title,
    message,
    buttons: buttons && buttons.length > 0 ? buttons : [{ text: '확인' }],
  });
}

export const Alert = { alert: alertImpl };

export function AlertHost() {
  const [state, setState] = useState<AlertState>(EMPTY_STATE);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    listener = setState;
    return () => {
      listener = null;
    };
  }, []);

  const close = () => emit({ ...currentState, visible: false });

  return (
    <Modal
      visible={state.visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View
        style={[
          styles.backdrop,
          // 모달도 안전영역을 지킨다 — 작은 화면/큰 글씨에서 카드가 노치나
          // 홈 인디케이터에 물리지 않도록 inset 을 여백으로 더한다.
          { paddingTop: spacing.lg + insets.top, paddingBottom: spacing.lg + insets.bottom },
        ]}
      >
        <View style={styles.card} accessibilityViewIsModal onAccessibilityEscape={close}>
          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.copy}>
              <Text style={styles.title} accessibilityRole="header">{state.title}</Text>
              {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
            </View>
            <View style={styles.buttonList}>
              {state.buttons.map((b, i) => (
                <Pressable
                  key={i}
                  style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                  accessibilityRole="button"
                  accessibilityLabel={b.text}
                  onPress={() => {
                    close();
                    b.onPress?.();
                  }}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      b.style === 'cancel' && styles.buttonTextCancel,
                      b.style === 'destructive' && styles.buttonTextDestructive,
                    ]}
                  >
                    {b.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: surface.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    ...surface.modal,
    width: '100%',
    maxWidth: 360,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  scroll: { flexGrow: 0 },
  copy: { paddingTop: spacing.lg, paddingHorizontal: spacing.lg },
  title: { ...typography.section, color: colors.text, textAlign: 'center' },
  message: {
    ...typography.body,
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  buttonList: { marginTop: spacing.lg },
  button: {
    minHeight: control.minTarget,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  buttonPressed: { backgroundColor: colors.muted },
  buttonText: { ...typography.label, color: colors.primaryDark, textAlign: 'center' },
  buttonTextCancel: { color: colors.subtext, fontWeight: '600' },
  buttonTextDestructive: { color: colors.danger },
});
