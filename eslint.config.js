import js from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  // Base configuration for all files
  js.configs.recommended,
  prettierConfig,
  {
    plugins: {
      prettier,
    },
    rules: {
      'prettier/prettier': 'warn',
      'no-console': 'warn',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  // Server-specific configuration
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off', // Console is OK in server code
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], // More lenient for server
    },
  },
  // Extension-specific configuration
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module', // Chrome extensions support ES modules
      globals: {
        chrome: 'readonly',
        marked: 'readonly',
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        EventSource: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        MutationObserver: 'readonly',
      },
    },
    rules: {
      'no-console': 'warn', // Console should be limited in extension
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }], // More lenient for extension
    },
  },
  // Scripts configuration (Node.js, ESM)
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      'no-console': 'off', // Console is OK in scripts
    },
  },
  // Ignore patterns
  {
    ignores: [
      'node_modules/**',
      'server/node_modules/**',
      '*.min.js',
      'extension/**/*.min.js',
      'extension/marked.min.js',
      'dist/**',
      'build/**',
      'extension-build/**',
    ],
  },
];
