import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/themes/*/*.d.ts"] }, // astryx theme build 생성물
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
);
