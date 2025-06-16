module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2020: true
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module"
  },
  extends: [
    "eslint:recommended",
    "plugin:prettier/recommended"
  ],
  plugins: [
    "prettier"
  ],
  rules: {
    "prettier/prettier": "error",
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "no-console": "off",
    "no-debugger": "warn",
    "eqeqeq": ["error", "always"],
    "semi": ["error", "always"],
    "quotes": ["error", "double"],
    "comma-dangle": ["error", "never"]
  },
  ignorePatterns: [
    "dist/",
    "node_modules/",
    "*.min.js"
  ]
}