import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        NodeJS: "readonly",
        RequestInit: "readonly",
        ErrorEvent: "readonly",
        PromiseRejectionEvent: "readonly",
        HTMLElement: "readonly",
        Buffer: "readonly",
        performance: "readonly",
        WebSocket: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": ts,
      react: react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      ...ts.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",
      
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { "vars": "all", "varsIgnorePattern": "^_", "args": "after-used", "argsIgnorePattern": "^_" }
      ],

      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "off",
      "no-undef": "error",
      "react/display-name": "off",
      "no-case-declarations": "warn",
      "no-empty": "warn",
      "no-useless-catch": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },
  {
    files: ["src/{routes,engine,services}*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",

      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ImportDeclaration[source.value=/^\\.{1,2}\\//]:not([source.value=/\\.(ts|tsx)$/])",
          message: "相对导入必须显式带 .ts/.tsx 后缀。",
        },
        {
          selector:
            "ExportNamedDeclaration[source.value=/^\\.{1,2}\\//]:not([source.value=/\\.(ts|tsx)$/])",
          message: "相对导入必须显式带 .ts/.tsx 后缀。",
        },
        {
          selector:
            "ExportAllDeclaration[source.value=/^\\.{1,2}\\//]:not([source.value=/\\.(ts|tsx)$/])",
          message: "相对导入必须显式带 .ts/.tsx 后缀。",
        },
        {
          selector:
            "CallExpression[callee.type='Import'][arguments.0.type='Literal'][arguments.0.value=/^\\.{1,2}\\//]:not([arguments.0.value=/\\.(ts|tsx)$/])",
          message: "动态相对导入必须显式带 .ts/.tsx 后缀。",
        },
      ],
    },
  },
  prettier,
];
