// Umurongo design tokens: the only place colours are defined.
// Used by tailwind.config.js (as theme values), vite.config.ts (PWA manifest) and the few
// components that need a raw colour (QR code, canvas). Components otherwise use Tailwind classes.
export const colors = {
  navy: { DEFAULT: '#25476E', dark: '#25406D' }, // headings, top bars / sidebar
  green: { DEFAULT: '#4DB282', ink: '#23784F' }, // ticket numbers, Available, progress / green text
  mint: '#E4F5EC', // selected cards, "turn coming soon"
  sky: '#E8F1FA', // info cards, table headers
  orange: '#E8792B', // ONE main action per screen
  ink: '#1D2630', // body text
  muted: '#5F6B78',
  line: '#DCE5EE', // borders
  bg: '#F4F8FC', // page background
  white: '#FFFFFF',
  // Status chips: text on background
  amber: { DEFAULT: '#B9770E', bg: '#FDF1DC' }, // Busy / In consultation / On break
  red: { DEFAULT: '#C9423E', bg: '#FBE9E8' }, // In surgery / Away / Emergency
  grey: { DEFAULT: '#7D8894', bg: '#EEF1F4' }, // Off duty
};
