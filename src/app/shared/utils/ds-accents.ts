/** Shared accent presets + family derivation for the dev design-system
 *  pages (/dev/ds gallery, /dev/ds-elements zoo) — one source for
 *  "what an accent means" so both previews theme specimens identically.
 *
 *  The derivation mirrors the shipped token layer: dark keeps the raw
 *  accent (bright on near-black); light deepens it so accent surfaces
 *  and accent-text stay legible on white. */
export const ACCENTS = [
  { id: 'cyan', label: 'Cyan', hex: '#22d3ee' },
  { id: 'mint', label: 'Mint', hex: '#00ff9d' },
  { id: 'acid', label: 'Acid', hex: '#7cff00' },
  { id: 'blue', label: 'Blue', hex: '#4f9fff' },
  { id: 'violet', label: 'Violet', hex: '#b18bff' },
  { id: 'magenta', label: 'Magenta', hex: '#ff5fd0' },
  { id: 'amber', label: 'Amber', hex: '#ffc24d' },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'] | 'current' | 'custom';

const mix = (hex: string, pct: number, base: string) =>
  `color-mix(in srgb, ${hex} ${pct}%, ${base})`;

export interface AccentFamily {
  accent: string;
  onAccent: string;
  accentContainer: string;
  onAccentContainer: string;
  accentBorder: string;
  accentGlow: string;
  /** Text-role accent — deepened so accent-colored text meets AA. */
  accentText: string;
}

/** Full --ds-accent-* family for a picked hex in the given theme. */
export function deriveAccentFamily(hex: string, dark: boolean): AccentFamily {
  return dark
    ? {
        accent: hex,
        onAccent: '#0a0f14',
        accentContainer: mix(hex, 22, '#14171c'),
        onAccentContainer: mix(hex, 80, '#ffffff'),
        accentBorder: hex,
        accentGlow: mix(hex, 40, 'transparent'),
        accentText: hex,
      }
    : {
        accent: mix(hex, 55, '#001018'),
        onAccent: '#ffffff',
        accentContainer: mix(hex, 18, '#eef1f3'),
        onAccentContainer: mix(hex, 45, '#0a1216'),
        accentBorder: mix(hex, 55, '#001018'),
        accentGlow: mix(hex, 30, 'transparent'),
        accentText: mix(hex, 40, '#001018'),
      };
}
