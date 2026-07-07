import { primitives } from './primitives';

// Layer 2 — Semantic tokens: purpose aliases over primitives.
// Consumed directly by screens via the flat `colors` export in theme/index.ts,
// and by Layer 3 (component tokens) for per-component overrides.
export const semantic = {
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
} as const;
