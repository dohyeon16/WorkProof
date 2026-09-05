import type { SemanticColors } from './semantic';

// 다크 모드 팔레트. SemanticColors와 키가 1:1로 대응하며, 시스템이 다크일 때 theme가 이 값을 고른다.
// 브랜드 teal은 유지하되 어두운 배경에서 대비가 살도록 표면/텍스트/보더 값을 조정했다.
export const semanticDark: SemanticColors = {
  primary: '#0F766E',
  primaryHover: '#115E59',
  // primaryDark는 밝은 표면(라이트) 위 강조 텍스트로 쓰이던 값. 다크에선 어두운 표면 위에서
  // 읽혀야 하므로 밝은 teal로 뒤집는다.
  primaryDark: '#5EEAD4',
  // primaryLight는 라이트에서 '연한 teal 배경'이었다. 다크에선 어두운 teal 표면으로 대체.
  primaryLight: '#123A34',
  secondary: '#0F766E',

  accent: '#FB923C',
  accentLight: '#3A2A1C',

  destructive: '#F87171',
  destructiveLight: '#3A1E1E',
  success: '#2DD4BF',
  successLight: '#123A34',

  background: '#0B1413',
  card: '#15201E',
  foreground: '#E6F4F1',
  muted: '#1B2624',
  mutedForeground: '#93A8A3',
  border: '#26403B',
  ring: '#5EEAD4',

  onPrimary: '#FFFFFF',
  onSecondary: '#FFFFFF',
  onAccent: '#211408',
  onDestructive: '#240B0B',
};
