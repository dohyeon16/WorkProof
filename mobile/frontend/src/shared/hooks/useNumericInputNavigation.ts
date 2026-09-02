import { createRef, useId, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  type ReturnKeyTypeOptions,
  type TextInput as RNTextInput,
} from 'react-native';

/**
 * iOS의 number-pad/numeric/decimal-pad 키보드에는 기본 return 키가 없어
 * '다음'/'완료' 버튼을 쓸 수 없다. 그래서 화면 루트에 InputAccessoryView(툴바)를
 * 한 번만 두고, 여러 숫자 입력 필드가 같은 nativeID로 이 툴바를 공유한다.
 *
 * 이 훅은 그 로직(현재 포커스 추적, 다음/완료 라벨 결정, 다음 필드 focus,
 * 마지막 필드에서 키보드 닫기)을 화면들이 재사용하도록 한곳에 모은다.
 * Android/웹에서는 returnKeyType + onSubmitEditing으로 같은 순서를 재현한다.
 *
 * 사용 예:
 *   const nav = useNumericInputNavigation(['wage', 'payDay', 'break'] as const);
 *   <FieldInput {...nav.getFieldProps('wage')} ... />
 *   <InputAccessoryToolbar nativeID={nav.accessoryViewID} label={nav.accessoryLabel} onPress={nav.onAccessoryPress} />
 *
 * 주의: fields 배열은 렌더마다 동일해야 한다(컴포넌트 밖 상수로 선언 권장).
 */
export interface NumericFieldProps {
  ref: React.RefObject<RNTextInput | null>;
  onFocus: () => void;
  returnKeyType: ReturnKeyTypeOptions;
  onSubmitEditing: () => void;
  blurOnSubmit?: boolean;
  inputAccessoryViewID?: string;
}

export interface NumericInputNavigation<K extends string> {
  /** 이 화면 전용 InputAccessoryView nativeID (화면 인스턴스마다 유일 → 충돌 방지). */
  accessoryViewID: string;
  /** 현재 포커스 기준 툴바 라벨('다음' 또는 '완료'). */
  accessoryLabel: string;
  /** 툴바 버튼 동작(다음 필드 focus 또는 Keyboard.dismiss). */
  onAccessoryPress: () => void;
  /** 입력 컴포넌트(FieldInput/TextInput)에 스프레드할 props. */
  getFieldProps: (key: K) => NumericFieldProps;
  /** 특정 필드의 ref만 필요할 때. */
  getRef: (key: K) => React.RefObject<RNTextInput | null>;
}

export function useNumericInputNavigation<K extends string>(
  fields: readonly K[]
): NumericInputNavigation<K> {
  // useId로 화면 인스턴스마다 유일한 nativeID를 만들어 여러 화면이 동시에
  // 마운트돼도 InputAccessoryView ID가 충돌하지 않게 한다.
  const generatedId = useId();
  const accessoryViewID = `numericAccessory-${generatedId}`;

  // fields는 안정적(상수)이라는 전제 하에, 최초 1회만 필드별 ref를 만든다.
  const refsRef = useRef<Record<string, React.RefObject<RNTextInput | null>> | null>(null);
  if (refsRef.current === null) {
    const map: Record<string, React.RefObject<RNTextInput | null>> = {};
    for (const f of fields) map[f] = createRef<RNTextInput>();
    refsRef.current = map;
  }
  const refs = refsRef.current;

  const [focused, setFocused] = useState<K | null>(null);

  const focusNext = (key: K) => {
    const i = fields.indexOf(key);
    if (i >= 0 && i < fields.length - 1) {
      refs[fields[i + 1]].current?.focus();
    } else {
      Keyboard.dismiss();
    }
  };

  const isLast = focused != null && fields.indexOf(focused) === fields.length - 1;
  const accessoryLabel = isLast || focused == null ? '완료' : '다음';
  const onAccessoryPress = () => {
    if (focused == null) {
      Keyboard.dismiss();
      return;
    }
    focusNext(focused);
  };

  const getRef = (key: K) => refs[key];

  const getFieldProps = (key: K): NumericFieldProps => {
    const i = fields.indexOf(key);
    const last = i === fields.length - 1;
    return {
      ref: refs[key],
      onFocus: () => setFocused(key),
      returnKeyType: last ? 'done' : 'next',
      onSubmitEditing: () => focusNext(key),
      // 네이티브에서 다음 필드로 넘어가는 필드는 blurOnSubmit=false여야
      // 키보드가 순간적으로 닫혔다 다시 열리지 않는다. 마지막 필드/웹은 기본값.
      blurOnSubmit: !last && Platform.OS !== 'web' ? false : undefined,
      // number-pad류에는 iOS에서만 툴바를 붙인다(Android/웹은 미사용).
      inputAccessoryViewID: Platform.OS === 'ios' ? accessoryViewID : undefined,
    };
  };

  return useMemo(
    () => ({ accessoryViewID, accessoryLabel, onAccessoryPress, getFieldProps, getRef }),
    // focused가 바뀌면 라벨/동작이 갱신돼야 하므로 의존성에 포함.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focused, accessoryViewID]
  );
}
