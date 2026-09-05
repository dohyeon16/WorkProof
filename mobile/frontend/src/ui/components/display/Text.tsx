import { Text as RNText, StyleSheet, type TextProps } from 'react-native';
import { fonts } from '../../design_system';

/**
 * react-native-web에서 Text.defaultProps로 전역 폰트를 지정하는 트릭은
 * React 19부터 함수 컴포넌트에 적용되지 않는다. 대신 이 래퍼를 통해
 * Noto Sans KR을 앱 전역 기본 폰트로 적용한다.
 * fontWeight가 700 이상이면 자동으로 Bold 폰트 파일을 사용한다.
 */
export function Text({ style, ...props }: TextProps) {
  const flat = StyleSheet.flatten(style) ?? {};
  const weight = flat.fontWeight;
  const bold =
    weight === 'bold' || weight === '700' || weight === '800' || weight === '900' || Number(weight) >= 700;
  const medium = Number(weight) >= 500;
  return <RNText style={[{ fontFamily: bold ? fonts.bold : medium ? fonts.medium : fonts.regular }, style]} {...props} />;
}
