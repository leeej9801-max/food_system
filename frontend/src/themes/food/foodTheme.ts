import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

const sans =
  'Pretendard, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

// 앱 전체 토큰(src/index.css @theme)과 같은 서체·강조색을 쓴다. 강조색은 주 버튼·선택 상태에만.
export const foodTheme = defineTheme({
  name: "food",
  extends: neutralTheme,
  typography: {
    body: { family: "Pretendard Variable", fallbacks: sans },
    heading: { family: "Pretendard Variable", fallbacks: sans },
  },
  tokens: {
    "--color-accent": ["#2f6bff", "#a9c4ff"],
    "--color-background-body": ["#f1f4f9", "#1b1b1b"],
  },
  components: {
    button: { base: { borderRadius: "9999px" } },
  },
});
