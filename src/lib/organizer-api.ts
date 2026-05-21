import { createClient } from './supabase/client';
import { parseApiJson } from './http';

function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
  const prefix = raw.replace(/\/+$/, '');
  return `${prefix}${path.startsWith('/') ? path : `/${path}`}`;
}

async function authHeaders(): Promise<HeadersInit> {
  const supabase = createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Нужен вход');
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export type OrganizerRole = 'admin' | 'organizer' | 'pending';

export type OrganizerProfile = {
  id: string;
  email: string | null;
  role: OrganizerRole;
};

export async function fetchMe(): Promise<OrganizerProfile> {
  const res = await fetch(apiUrl('/api/v1/organizer/me'), { headers: await authHeaders() });
  const body = await parseApiJson<{ profile?: OrganizerProfile; error?: string }>(res);
  if (!res.ok) throw new Error(body.error || 'Ошибка');
  if (!body.profile) throw new Error('Нет профиля');
  return body.profile;
}

export type EventRow = {
  id: string;
  slug: string;
  title: string;
  status: string;
  plan: string;
  photo_limit: number;
  moderation_enabled: boolean;
  ends_at: string | null;
  settings: Record<string, unknown>;
};

export async function listEvents(): Promise<EventRow[]> {
  const res = await fetch(apiUrl('/api/v1/organizer/events'), { headers: await authHeaders() });
  const body = await parseApiJson<{ events?: EventRow[]; error?: string }>(res);
  if (!res.ok) throw new Error(body.error || 'Ошибка');
  return body.events ?? [];
}

export async function createEvent(payload: {
  title: string;
  slug?: string;
  plan?: string;
  endsAt?: string;
  moderationEnabled?: boolean;
}): Promise<{ event: EventRow; pin: string; guestUrl: string }> {
  const res = await fetch(apiUrl('/api/v1/organizer/events'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Ошибка создания');
  return body;
}

export async function getEvent(id: string): Promise<{ event: EventRow; guestUrl: string }> {
  const res = await fetch(apiUrl(`/api/v1/organizer/events/${id}`), {
    headers: await authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Ошибка');
  return body;
}

export async function endEvent(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/organizer/events/${id}/end`), {
    method: 'POST',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Ошибка');
  }
}

export type OrgPhoto = {
  id: string;
  url: string;
  createdAt: string;
  author?: string;
  status?: string;
};

export async function listEventPhotos(id: string): Promise<OrgPhoto[]> {
  const res = await fetch(apiUrl(`/api/v1/organizer/events/${id}/photos`), {
    headers: await authHeaders(),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Ошибка');
  return body.photos ?? [];
}

export async function moderatePhoto(
  eventId: string,
  photoId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/organizer/events/${eventId}/photos/${photoId}`), {
    method: 'PATCH',
    headers: await authHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Ошибка');
  }
}

export async function deleteOrgPhoto(eventId: string, photoId: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/v1/organizer/events/${eventId}/photos/${photoId}`), {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(body.error || 'Ошибка');
  }
}

export function qrUrl(eventId: string): string {
  return apiUrl(`/api/v1/organizer/events/${eventId}/qr`);
}

export function exportZipUrl(eventId: string): string {
  return apiUrl(`/api/v1/organizer/events/${eventId}/export.zip`);
}

export type AdminOrganizerRow = {
  id: string;
  email: string | null;
  role: OrganizerRole;
  created_at: string;
};

export type AdminInviteRow = {
  id: string;
  email: string;
  created_at: string;
};

export async function listAdminOrganizers(): Promise<{
  organizers: AdminOrganizerRow[];
  invites: AdminInviteRow[];
}> {
  const res = await fetch(apiUrl('/api/v1/admin/organizers'), { headers: await authHeaders() });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Ошибка');
  return body;
}

export async function grantOrganizer(email: string): Promise<string> {
  const res = await fetch(apiUrl('/api/v1/admin/organizers/grant'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ email }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Ошибка');
  return (body as { message?: string }).message || 'Готово';
}

export async function revokeOrganizer(email: string): Promise<void> {
  const res = await fetch(apiUrl('/api/v1/admin/organizers/revoke'), {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ email }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'Ошибка');
}

export async function downloadQr(eventId: string, slug: string): Promise<void> {
  const res = await fetch(qrUrl(eventId), { headers: await authHeaders() });
  if (!res.ok) throw new Error('QR');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qr-${slug}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
