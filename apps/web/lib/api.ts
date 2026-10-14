const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Params = Record<string, string | number | undefined>;

/** `/path?query` for the API; undefined params are left out. */
export function apiPath(path: string, params: Params = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${path}`);
  return (await response.json()) as T;
}
