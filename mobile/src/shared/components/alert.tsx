import { useEffect, useState } from 'react';
import { Alert as RNAlert, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { colors, spacing } from '../theme';

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
 * react-native-web의 Alert.alert()는 빈 함수(no-op)라서 웹에서는 아무 동작도 하지 않는다.
 * 네이티브에서는 실제 Alert.alert를 그대로 쓰고, 웹에서만 커스텀 모달로 대체한다.
 */
function alertImpl(title: string, message?: string, buttons?: AlertButtonSpec[]): void {
  if (Platform.OS !== 'web') {
    RNAlert.alert(title, message, buttons);
    return;
  }
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

  useEffect(() => {
    listener = setState;
    return () => {
      listener = null;
    };
  }, []);

  if (Platform.OS !== 'web') return null;

  const close = () => emit({ ...currentState, visible: false });

  return (
    <Modal visible={state.visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{state.title}</Text>
          {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
          <View style={styles.buttonList}>
            {state.buttons.map((b, i) => (
              <Pressable
                key={i}
                style={styles.button}
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, textAlign: 'center' },
  message: {
    fontSize: 13,
    color: colors.subtext,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  buttonList: { marginTop: spacing.lg, marginHorizontal: -spacing.lg },
  button: {
    paddingVertical: spacing.sm + 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '700', color: colors.primaryDark },
  buttonTextCancel: { color: colors.subtext, fontWeight: '600' },
  buttonTextDestructive: { color: colors.danger },
});
