import { semantic } from './semantic';

// Layer 3 — Component tokens: per-component state specs built from semantic tokens.
// Screens that need more than the flat `colors` export (e.g. a pressed/disabled
// button state) should read from here instead of hardcoding a shade.
export const componentTokens = {
  buttonPrimary: {
    background: semantic.primary,
    backgroundPressed: semantic.primaryHover,
    backgroundDisabled: semantic.muted,
    text: semantic.onPrimary,
    textDisabled: semantic.mutedForeground,
  },
  buttonDestructive: {
    background: semantic.destructive,
    text: semantic.onDestructive,
  },
  input: {
    background: semantic.card,
    border: semantic.border,
    borderFocus: semantic.ring,
    placeholder: semantic.mutedForeground,
    text: semantic.foreground,
  },
  tabBar: {
    background: semantic.card,
    active: semantic.primaryDark,
    inactive: semantic.mutedForeground,
  },
  card: {
    background: semantic.card,
    border: semantic.border,
  },
} as const;
