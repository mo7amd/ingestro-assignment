/**
 * Warm Charcoal: a dark theme with warm surfaces, pale warm text and one orange accent.
 *
 * Mapped onto Chakra's semantic tokens by role, so components keep using `bg`, `fg`,
 * `border` and color palettes:
 *   blue   → the product accent (primary actions, focus, current state): orange in this theme
 *   orange → problems that need a person (amber), kept separate from the accent
 *   teal   → "we'll handle it" (automatic fixes): calm, clearly not a warning
 *   green  → good / success, red → errors, gray → neutral controls
 * Status colors never reuse the accent, so "click this" and "this is the state" don't blur.
 */
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'

const p = {
  canvas: '#282828',
  surface: '#31302e',
  surfaceRaised: '#3a3935',
  surfaceActive: '#45423c',
  surfaceSelected: '#4a4740',
  border: '#45423c',
  borderSoft: '#3f3d38',
  borderStrong: '#59564c',

  text: '#ede1bb',
  textSecondary: '#cdc1a2',
  textMuted: '#aa9e8a',
  iconMuted: '#968f7a',

  action: '#ec8743',
  onAction: '#1a1814',
  actionWash: '#4a3a2e',
  actionWashText: '#f3c8a4',

  errorSignal: '#d0392a',
  errorText: '#f87171',
  errorWash: '#3d2a26',
  onErrorWash: '#f5e9d6',
  warningSignal: '#d9a441',
  warningWash: '#3f3627',
  // The theme defines no success or info color; accessible ones that sit with the warm palette.
  info: '#7fb2c4',
  infoText: '#a9cfdc',
  infoWash: '#2c3638',
  success: '#6cc08a',
  successText: '#93d4a8',
  successWash: '#2b3a2f',
}

/** Same value in light and dark: the app is always Warm Charcoal. */
const v = (value: string) => ({ value: { _light: value, _dark: value } })

const palette = (c: { contrast: string; fg: string; subtle: string; muted: string; emphasized: string; solid: string; focusRing: string }) =>
  Object.fromEntries(Object.entries(c).map(([k, value]) => [k, v(value)]))

const config = defineConfig({
  globalCss: {
    html: { colorScheme: 'dark' },
    body: { bg: 'bg', color: 'fg' },
    '::selection': { bg: 'blue.subtle' },
  },
  theme: {
    semanticTokens: {
      colors: {
        bg: {
          DEFAULT: v(p.canvas),
          subtle: v(p.surface),
          muted: v(p.surfaceRaised),
          emphasized: v(p.surfaceActive),
          panel: v(p.surface),
          inverted: v(p.text),
          error: v(p.errorWash),
          warning: v(p.warningWash),
          success: v(p.successWash),
          info: v(p.actionWash),
        },
        fg: {
          DEFAULT: v(p.text),
          muted: v(p.textMuted),
          subtle: v(p.iconMuted),
          inverted: v(p.onAction),
          error: v(p.errorText),
          warning: v(p.warningSignal),
          success: v(p.successText),
          info: v(p.actionWashText),
        },
        border: {
          DEFAULT: v(p.border),
          muted: v(p.borderSoft),
          subtle: v(p.borderSoft),
          emphasized: v(p.borderStrong),
          inverted: v(p.text),
          error: v(p.errorSignal),
          warning: v(p.warningSignal),
          success: v(p.success),
          info: v(p.action),
        },
        gray: palette({
          contrast: p.onAction,
          fg: p.text,
          subtle: p.surfaceRaised,
          muted: p.surfaceActive,
          emphasized: p.surfaceSelected,
          solid: p.textSecondary,
          focusRing: p.action,
        }),
        blue: palette({
          contrast: p.onAction,
          fg: p.actionWashText,
          subtle: p.actionWash,
          muted: '#5a4636',
          emphasized: '#6a5240',
          solid: p.action,
          focusRing: p.action,
        }),
        orange: palette({
          contrast: p.onAction,
          fg: p.warningSignal,
          subtle: p.warningWash,
          muted: '#4d4230',
          emphasized: '#5b4e38',
          solid: p.warningSignal,
          focusRing: p.warningSignal,
        }),
        teal: palette({
          contrast: p.onAction,
          fg: p.infoText,
          subtle: p.infoWash,
          muted: '#34413f',
          emphasized: '#3d4b49',
          solid: p.info,
          focusRing: p.info,
        }),
        green: palette({
          contrast: p.onAction,
          fg: p.successText,
          subtle: p.successWash,
          muted: '#34473a',
          emphasized: '#3d5444',
          solid: p.success,
          focusRing: p.success,
        }),
        red: palette({
          contrast: p.onErrorWash,
          fg: p.errorText,
          subtle: p.errorWash,
          muted: '#4a322d',
          emphasized: '#573a34',
          solid: p.errorSignal,
          focusRing: p.errorSignal,
        }),
      },
    },
  },
})

export const system = createSystem(defaultConfig, config)
