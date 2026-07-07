// Three-layer design token architecture: primitive → semantic → component.
// `colors` stays flat for backward compatibility with existing screens;
// new code should prefer `semanticColors` / `componentTokens` for anything
// beyond the handful of aliases below.
import { primitives } from './primitives';
import { semantic } from './semantic';
import { componentTokens } from './components';

export const colors = {
  primary: semantic.primary,
  primaryDark: semantic.primaryDark,
  primaryLight: semantic.primaryLight,
  secondary: semantic.secondary,
  accent: semantic.accent,
  accentLight: semantic.accentLight,
  danger: semantic.destructive,
  dangerLight: semantic.destructiveLight,
  success: semantic.success,
  successLight: semantic.successLight,
  text: semantic.foreground,
  subtext: semantic.mutedForeground,
  muted: semantic.muted,
  border: semantic.border,
  background: semantic.background,
  card: semantic.card,
  ring: semantic.ring,
  onPrimary: semantic.onPrimary,
  onSecondary: semantic.onSecondary,
  onAccent: semantic.onAccent,
  onDestructive: semantic.onDestructive,
};

export { primitives, semantic as semanticColors, componentTokens };

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

// Elevation presets — boxShadow (iOS/Android/web) + elevation (Android fallback)
export const shadow = {
  card: {
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.06)',
    elevation: 2,
  },
  raised: {
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)',
    elevation: 4,
  },
} as const;

// Noto Sans KR ("Korean Modern" pairing) — loaded via @expo-google-fonts/noto-sans-kr
export const fonts = {
  regular: 'NotoSansKR_400Regular',
  medium: 'NotoSansKR_500Medium',
  bold: 'NotoSansKR_700Bold',
};
