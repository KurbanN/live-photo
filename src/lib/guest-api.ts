import { ApiRequestError } from './api';

function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
  const prefix = raw.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${prefix}${p}`;
}

export type EventPublic = {
  slug: string;
  title: string;
  status: string;
  pinRequired: boolean;
  uploadsOpen: boolean;
  uploadsClosedReason?: string;
  moderationEnabled: boolean;
  settings: {
    welcomeTitle: string;
    welcomeSubtitle?: string;
    loginBgUrl?: string;
    headerSubtitle?: string;
  };
};

export type PhotoEntry = {
  id: string;
  url: string;
  createdAt: string;
  author?: string;
  status?: string;
};

function pinKey(slug: string) {
  return `live-photo-pin-${slug}`;
}

export function getStoredPin(slug: string): string | null {
  try {
    return sessionStorage.getItem(pinKey(slug));
  } catch {
    return null;
  }
}

export function setStoredPin(slug: string, pin: string) {
  sessionStorage.setItem(pinKey(slug), pin);
}

export function clearStoredPin(slug: string) {
  sessionStorage.removeItem(pinKey(slug));
}

export function apiHeaders(pin: string): HeadersInit {
  return { 'X-Event-Pin': pin };
}

export async function fetchEventPublic(slug: string): Promise<EventPublic> {
  const res = await fetch(apiUrl(`/api/v1/e/${encodeURIComponent(slug)}/public`));
  const body = (await res.json().catch(() => ({}))) as EventPublic & { error?: string };
  if (!res.ok) throw new ApiRequestError(body.error || 'Мероприятие не найдено', res.status);
  return body;
}

export async function fetchPhotos(slug: string, pin: string): Promise<PhotoEntry[]> {
  const res = await fetch(apiUrl(`/api/v1/e/${encodeURIComponent(slug)}/photos`), {
    headers: apiHeaders(pin),
  });
  const body = (await res.json().catch(() => ({}))) as {
    photos?: PhotoEntry[];
    error?: string;
    hint?: string;
  };
  if (!res.ok) {
    const msg = [body.error, body.hint].filter(Boolean).join(' ') || 'Не удалось загрузить ленту';
    throw new ApiRequestError(msg, res.status);
  }
  if (!body.photos) throw new ApiRequestError('Некорректный ответ', res.status);
  return body.photos;
}

function uploadFilename(blob: Blob): string {
  if (blob instanceof File && blob.name?.trim()) {
    const n = blob.name.trim();
    if (/\.(jpe?g|png|webp|heic|heif|gif)$/i.test(n)) return n;
  }
  if (blob.type === 'image/png') return 'photo.png';
  if (blob.type === 'image/webp') return 'photo.webp';
  if (blob.type === 'image/heic' || blob.type === 'image/heif') return 'photo.heic';
  return 'photo.jpg';
}

export async function uploadPhoto(
  slug: string,
  pin: string,
  blob: Blob,
  author?: string,
): Promise<{ photo: PhotoEntry; pendingModeration?: boolean }> {
  const form = new FormData();
  form.append('photo', blob, uploadFilename(blob));
  if (author?.trim()) form.append('author', author.trim());
  const res = await fetch(apiUrl(`/api/v1/e/${encodeURIComponent(slug)}/upload`), {
    method: 'POST',
    headers: apiHeaders(pin),
    body: form,
  });
  const body = (await res.json().catch(() => ({}))) as {
    photo?: PhotoEntry;
    error?: string;
    pendingModeration?: boolean;
  };
  if (!res.ok) throw new Error(body.error || 'Ошибка загрузки');
  if (!body.photo) throw new Error('Некорректный ответ');
  return { photo: body.photo, pendingModeration: body.pendingModeration };
}

export async function downloadPhotoFile(slug: string, pin: string, photoId: string): Promise<Blob> {
  const res = await fetch(
    apiUrl(`/api/v1/e/${encodeURIComponent(slug)}/photos/${encodeURIComponent(photoId)}/download`),
    { headers: apiHeaders(pin) },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Не удалось скачать');
  }
  return res.blob();
}

export function resolveBgUrl(url?: string): string {
  if (!url) return `${import.meta.env.BASE_URL}login-bg.jpg`;
  if (url.startsWith('http')) return url;
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${base}${path}`;
}
