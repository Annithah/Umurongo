import { colors } from './src/theme/tokens.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      fontFamily: {
        heading: ['Nunito', 'system-ui', 'sans-serif'],
        sans: ['"Nunito Sans"', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        base: ['15px', '1.5'],
        // Ticket numbers: 48-64px on phones, 120px+ on the TV.
        'ticket-sm': ['3rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'ticket-md': ['4rem', { lineHeight: '1', letterSpacing: '-0.02em' }],
        'ticket-tv': ['10rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
      },
      borderRadius: { card: '16px' },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
      keyframes: {
        fadein: { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        callflash: {
          '0%, 40%, 80%': { backgroundColor: colors.green.DEFAULT, color: colors.white },
          '20%, 60%, 100%': { backgroundColor: colors.white },
        },
        ring: { '0%': { transform: 'scale(1)', opacity: '0.6' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
      },
      animation: {
        fadein: 'fadein 200ms ease-out',
        callflash: 'callflash 2.4s ease-in-out',
        ring: 'ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
};
