import { Appearance } from 'react-native';
import { primitives } from './primitives';
import { semanticDark } from './semantic.dark';

// Layer 2 — Semantic tokens: purpose aliases over primitives.
// Consumed directly by screens via the flat `colors` export in theme/index.ts,
// and by Layer 3 (component tokens) for per-component overrides.
//
// 팔레트 shape. 값을 string으로 넓혀 라이트/다크가 같은 타입을 갖게 한다(primitives가 as const라
// 명시 타입이 없으면 literal 타입으로 좁혀져 다크 값 대입이 막힌다).
export interface SemanticColors {
  primary: string;
  primaryHover: string;
  primaryDark: string;
  primaryLight: string;
  secondary: string;
  accent: string;
  accentLight: string;
  destructive: string;
  destructiveLight: string;
  success: string;
  successLight: string;
  background: string;
  card: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  ring: string;
  onPrimary: string;
  onSecondary: string;
  onAccent: string;
  onDestructive: string;
}

// 라이트 팔레트.
export const semanticLight: SemanticColors = {
  primary: primitives.teal600,
  primaryHover: primitives.teal700,
  primaryDark: primitives.teal700,
  primaryLight: primitives.teal100,
  secondary: primitives.teal500,

  accent: primitives.orange600,
  accentLight: primitives.orange100,

  destructive: primitives.red600,
  destructiveLight: primitives.red100,
  success: primitives.teal600,
  successLight: primitives.teal100,

  background: primitives.teal50,
  card: primitives.white,
  foreground: primitives.teal900,
  muted: primitives.slate50,
  mutedForeground: primitives.slate500,
  border: primitives.teal200,
  ring: primitives.teal600,

  onPrimary: primitives.white,
  onSecondary: primitives.white,
  onAccent: primitives.white,
  onDestructive: primitives.white,
};

// 앱 시작 시점의 시스템 색상 설정(라이트/다크)에 따라 팔레트를 확정한다. StyleSheet가 모듈
// 로드 때 색을 스냅샷하므로 실시간 토글은 아니고 '시스템 설정을 따르는' 다크 모드다.
// 시스템 테마를 바꾸면 앱을 다시 시작할 때 반영된다.
export const semantic = Appearance.getColorScheme() === 'dark' ? semanticDark : semanticLight;
