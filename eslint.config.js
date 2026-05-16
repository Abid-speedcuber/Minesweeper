import js from "@eslint/js";

export default [
  {
    ignores: ["node_modules/", "public/"],
  },
  {
    files: ["main/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        // Browser globals
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        Date: "readonly",
        Math: "readonly",
        Set: "readonly",
        Array: "readonly",
        Object: "readonly",
        String: "readonly",
        parseInt: "readonly",
        JSON: "readonly",
        clearInterval: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        setTimeout: "readonly",
        alert: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { args: "none" }],
      "no-undef": "error",
      "no-redeclare": "error",
      "no-func-assign": "error",
      "no-const-assign": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
