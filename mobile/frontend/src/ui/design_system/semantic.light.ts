import { primitives } from './primitives';
import type { SemanticColors } from './semantic';

export const semanticLight: SemanticColors = {
  primary: primitives.teal700,
  primaryHover: primitives.teal900,
  primaryDark: primitives.teal700,
  primaryLight: '#E4F3EF',
  secondary: primitives.teal700,
  accent: primitives.orange700,
  accentLight: primitives.orange100,
  destructive: primitives.red700,
  destructiveLight: primitives.red100,
  success: primitives.teal700,
  successLight: '#E4F3EF',
  background: primitives.canvas,
  card: primitives.white,
  foreground: primitives.ink,
  muted: primitives.surfaceMuted,
  mutedForeground: primitives.inkMuted,
  border: primitives.divider,
  ring: primitives.teal700,
  onPrimary: primitives.white,
  onSecondary: primitives.white,
  onAccent: primitives.white,
  onDestructive: primitives.white,
};
