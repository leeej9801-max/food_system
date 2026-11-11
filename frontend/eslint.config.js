import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    // shortcut: 기존 3곳(MenuFormModal, RecipeEditorModal, HomePage)이 effect 안에서 폼 상태를 채운다.
    // 화면 동작을 브라우저로 확인하며 고쳐야 해서 경고로 둔다. 고친 뒤 이 블록을 지운다.
    rules: { "react-hooks/set-state-in-effect": "warn" },
  },
);
