// Expo's flat ESLint config (React, React Native, hooks, TypeScript, import
// rules), tuned for this app. CI runs `eslint .`: errors fail the build,
// warnings are reported only.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['node_modules/**', '.expo/**', 'dist/**', 'android/**', 'ios/**'],
  },
  {
    rules: {
      // Native modules are loaded lazily via require() behind Expo Go guards.
      '@typescript-eslint/no-require-imports': 'off',
      // Plain apostrophes in JSX prose ("you're") render fine in React Native;
      // escaping them as &apos; only hurts readability.
      'react/no-unescaped-entities': 'off',
      // React Compiler rules. `refs` fires on the standard RN pattern of an
      // Animated.Value kept in useRef and read in render — a false positive
      // here. The others point at real (if minor) issues: keep them visible as
      // warnings so new code is nudged, without blocking on legacy screens.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    // Node/CommonJS scripts, not app code.
    files: ['*.config.js', 'start.js', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        __dirname: 'readonly', module: 'writable', require: 'readonly',
        process: 'readonly', console: 'readonly', Buffer: 'readonly',
      },
    },
  },
]);
