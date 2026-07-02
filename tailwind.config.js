import { themeTokens, themeCssVars } from './src/ui/theme.js';

const rgb = (varName) => `rgb(var(${varName}) / <alpha-value>)`;

function themeVarsPlugin({ addBase }) {
  addBase({
    ':root': themeCssVars('light'),
    '.dark': themeCssVars('dark'),
  });
}

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      backgroundColor: {
        'theme-page': rgb('--theme-bg-page'),
        'theme-surface': rgb('--theme-bg-surface'),
        'theme-muted': rgb('--theme-bg-muted'),
        'theme-subtle': rgb('--theme-bg-subtle'),
        'theme-input': rgb('--theme-bg-input'),
        'theme-control': rgb('--theme-bg-control'),
        'theme-control-hover': rgb('--theme-bg-control-hover'),
        'theme-accent': rgb('--theme-accent'),
        'theme-accent-hover': rgb('--theme-accent-hover'),
        'theme-accent-subtle': rgb('--theme-accent-subtle'),
        'theme-danger-bg': rgb('--theme-danger-bg'),
        'theme-danger-hover': rgb('--theme-danger-hover'),
      },
      textColor: {
        'theme-heading': rgb('--theme-text-heading'),
        'theme-body': rgb('--theme-text-body'),
        'theme-muted': rgb('--theme-text-muted'),
        'theme-faint': rgb('--theme-text-faint'),
        'theme-accent': rgb('--theme-accent'),
        'theme-accent-text': rgb('--theme-accent-text'),
        'theme-on-accent': rgb('--theme-on-accent'),
        'theme-adorn': rgb('--theme-adorn'),
        'theme-success': rgb('--theme-success'),
        'theme-danger': rgb('--theme-danger'),
        'theme-info': rgb('--theme-info'),
        'theme-p5': rgb('--theme-p5'),
        'theme-p10': rgb('--theme-p10'),
        'theme-p20': rgb('--theme-p20'),
        'theme-p30': rgb('--theme-p30'),
        'theme-p40': rgb('--theme-p40'),
        'theme-p50': rgb('--theme-p50'),
        'theme-p60': rgb('--theme-p60'),
      },
      borderColor: {
        'theme-border': rgb('--theme-border-default'),
        'theme-input': rgb('--theme-border-input'),
        'theme-accent': rgb('--theme-accent'),
      },
      ringColor: {
        'theme-accent': rgb('--theme-ring-accent'),
      },
      ringOffsetColor: {
        'theme-ring-offset': rgb('--theme-ring-offset'),
      },
      accentColor: {
        'theme-accent': rgb('--theme-accent'),
      },
    },
  },
  plugins: [themeVarsPlugin],
};

// Reference themeTokens so tree-shaking keeps the import meaningful in Node
void themeTokens;
