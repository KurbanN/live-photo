const PIN_KEY = 'wedding-live-photos-pin';

export function getStoredPin(): string | null {
  try {
    return sessionStorage.getItem(PIN_KEY);
  } catch {
    return null;
  }
}

export function setStoredPin(pin: string) {
  sessionStorage.setItem(PIN_KEY, pin);
}

export function clearStoredPin() {
  sessionStorage.removeItem(PIN_KEY);
}

export function apiHeaders(pin: string): HeadersInit {
  return { 'X-Event-Pin': pin };
}

/** Для статики на GitHub Pages укажите URL бэкенда в `VITE_API_BASE_URL` при сборке. */
function apiUrl(path: string): string {
  const prefix = import.meta.env.VITE_API_BASE_URL ?? '';
  return `${prefix}${path}`;
}

export type PhotoEntry = {
  id: string;
  /** Публичный URL в Supabase Storage (отдаёт API после загрузки). */
  url: string;
  createdAt: string;
  author?: string;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function fetchPhotos(pin: string): Promise<PhotoEntry[]> {
  const res = await fetch(apiUrl('/api/photos'), { headers: apiHeaders(pin) });
  const body = (await res.json().catch(() => ({}))) as {
    photos?: PhotoEntry[];
    error?: string;
    hint?: string;
  };
  if (!res.ok) {
    const msg = [body.error, body.hint].filter(Boolean).join(' ') || 'Не удалось загрузить ленту';
    throw new ApiRequestError(msg, res.status);
  }
  if (!body.photos || !Array.isArray(body.photos)) {
    throw new ApiRequestError('Некорректный ответ сервера', res.status);
  }
  return body.photos;
}

export async function uploadPhoto(pin: string, blob: Blob, author?: string): Promise<PhotoEntry> {
  const form = new FormData();
  form.append('photo', blob, 'photo.jpg');
  if (author?.trim()) form.append('author', author.trim());
  const res = await fetch(apiUrl('/api/upload'), {
    method: 'POST',
    headers: apiHeaders(pin),
    body: form,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Ошибка загрузки');
  }
  const data = (await res.json()) as { photo: PhotoEntry };
  return data.photo;
}

export async function deletePhoto(pin: string, id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/photos/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    headers: apiHeaders(pin),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Не удалось удалить');
  }
}

/** Скачивание одного файла с заголовком attachment (требуется PIN). */
export async function downloadPhotoFile(pin: string, photoId: string): Promise<Blob> {
  const res = await fetch(apiUrl(`/api/photos/${encodeURIComponent(photoId)}/download`), {
    headers: apiHeaders(pin),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Не удалось скачать');
  }
  return res.blob();
}
