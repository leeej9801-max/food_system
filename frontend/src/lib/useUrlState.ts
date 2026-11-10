import { useSearchParams } from "react-router-dom";
import { readQueryValue } from "./navigation";

export function useUrlState<T extends string>(key: string, fallback: T, allowed?: readonly T[]) {
  const [params, setParams] = useSearchParams();
  const value = readQueryValue(params.toString(), key, fallback, allowed);
  function setValue(next: T) {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next === fallback) updated.delete(key);
      else updated.set(key, next);
      return updated;
    }, { replace: true });
  }
  return [value, setValue] as const;
}
