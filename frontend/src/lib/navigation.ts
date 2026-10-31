export function withStore(to: string, currentSearch: string): string {
  const store = new URLSearchParams(currentSearch).get("store");
  const url = new URL(to, "https://food.invalid");
  if (store && !url.searchParams.has("store")) url.searchParams.set("store", store);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readQueryValue<T extends string>(
  search: string,
  key: string,
  fallback: T,
  allowed?: readonly T[],
): T {
  const value = new URLSearchParams(search).get(key) as T | null;
  return value !== null && (!allowed || allowed.includes(value)) ? value : fallback;
}
