let memoryToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

export function notifyUnauthorized(): void {
  memoryToken = null;
  unauthorizedListeners.forEach((fn) => fn());
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }
  return headers;
}
