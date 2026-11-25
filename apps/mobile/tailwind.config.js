/** Pansari tokens (same palette as the web app). */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        bg: '#fbf6ee',
        surface: '#ffffff',
        'surface-2': '#f6eee2',
        ink: '#23140b',
        muted: '#7a6352',
        line: '#eadbc6',
        kum: '#a3122b',
        haldi: '#f2b705',
        leaf: '#2f7a35',
        danger: '#b3261e',
        warn: '#9a6400',
      },
    },
  },
  plugins: [],
};
