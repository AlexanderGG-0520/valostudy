import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
export default ts.config(
  { ignores: ["**/node_modules/**", "**/.next/**", "**/dist/**", "**/next-env.d.ts", "packages/db/migrations/**"] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ["**/*.tsx"], plugins: { "react-hooks": hooks }, rules: hooks.configs.recommended.rules },
  { files: ["**/*.{ts,tsx}"], rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } }
);
