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
  control: 12,
  md: 16,
  page: 20,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
};

// Elevation presets — boxShadow (iOS/Android/web) + elevation (Android fallback)
export const shadow = {
  card: {
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
    elevation: 1,
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

// A small shared scale: paired size/leading keeps Korean copy and headings clear.
export const typography = {
  title: { fontSize: 28, lineHeight: 40, fontWeight: '700', letterSpacing: -0.4 },
  section: { fontSize: 18, lineHeight: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 20 },
} as const;

export const control = {
  minTarget: 48,
  inputHeight: 52,
  button: {
    minHeight: 52,
    paddingVertical: spacing.control,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  pressed: { opacity: 0.72 },
} as const;

export const surface = {
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  modal: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.raised,
  },
  scrim: 'rgba(9, 20, 25, 0.48)',
} as const;
