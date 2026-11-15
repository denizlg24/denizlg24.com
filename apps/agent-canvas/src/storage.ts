export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(
  key: string,
  value: unknown,
  onError: (error: string) => void,
): boolean {
  try {
    localStorage.setItem(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    return true;
  } catch (error) {
    onError(`Could not save ${key}: ${error}`);
    return false;
  }
}
