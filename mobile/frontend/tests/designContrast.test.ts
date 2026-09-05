import assert from 'node:assert/strict';
import { test } from 'node:test';
import { semanticLight } from '../src/ui/design_system/semantic.light';
import { semanticDark } from '../src/ui/design_system/semantic.dark';

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/.{2}/g)!.map((value) => parseInt(value, 16) / 255);
  const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

for (const [name, palette] of Object.entries({ light: semanticLight, dark: semanticDark })) {
  test(`${name}: body and supporting text stay readable on shared surfaces`, () => {
    for (const foreground of ['foreground', 'mutedForeground'] as const) {
      for (const background of ['background', 'card', 'muted'] as const) {
        const ratio = contrast(palette[foreground], palette[background]);
        assert.ok(ratio >= 4.5, `${foreground}/${background}: ${ratio.toFixed(2)}:1`);
      }
    }
  });

  test(`${name}: action labels and semantic states meet normal-text contrast`, () => {
    const pairs = [
      ['onPrimary', 'primary'], ['onSecondary', 'secondary'],
      ['onAccent', 'accent'], ['onDestructive', 'destructive'],
      ['primaryDark', 'primaryLight'], ['success', 'successLight'],
      ['destructive', 'destructiveLight'],
    ] as const;
    for (const [foreground, background] of pairs) {
      const ratio = contrast(palette[foreground], palette[background]);
      assert.ok(ratio >= 4.5, `${foreground}/${background}: ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${name}: focus ring remains distinguishable from form surfaces`, () => {
    for (const background of ['card', 'background'] as const) {
      assert.ok(contrast(palette.ring, palette[background]) >= 3);
    }
  });
}
