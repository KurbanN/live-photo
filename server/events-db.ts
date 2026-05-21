import { getSupabase } from './supabase.js';
import { hashPin, verifyPin } from './pin.js';
import type { EventPlan, EventRow, EventSettings } from './types.js';
import { PLAN_LIMITS as limits } from './types.js';

export async function getEventBySlug(slug: string): Promise<EventRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('slug', slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data as EventRow | null;
}

export async function getEventById(id: string): Promise<EventRow | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('events').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as EventRow | null;
}

export function eventIsUploadAllowed(event: EventRow): { ok: boolean; reason?: string } {
  if (event.status === 'ended' || event.status === 'archived') {
    return { ok: false, reason: 'Мероприятие завершено' };
  }
  if (event.status === 'draft') {
    return { ok: false, reason: 'Мероприятие ещё не открыто' };
  }
  const now = Date.now();
  if (event.ends_at && new Date(event.ends_at).getTime() < now) {
    return { ok: false, reason: 'Приём фото закрыт' };
  }
  if (event.starts_at && new Date(event.starts_at).getTime() > now) {
    return { ok: false, reason: 'Мероприятие ещё не началось' };
  }
  return { ok: true };
}

export async function verifyEventPin(event: EventRow, pin: string | undefined): Promise<boolean> {
  if (!event.pin_enabled) return true;
  if (!pin) return false;
  if (event.pin_hash) return verifyPin(pin, event.pin_hash);
  const legacy = process.env.EVENT_PIN?.trim();
  return !!legacy && pin === legacy;
}

export async function countEventPhotos(eventId: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from('photos')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .neq('status', 'rejected');
  if (error) throw error;
  return count ?? 0;
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'event';
}

export type CreateEventInput = {
  slug: string;
  title: string;
  pin?: string;
  plan?: EventPlan;
  moderationEnabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  settings?: EventSettings;
  organizerId: string;
  organizerEmail?: string;
};

export async function ensureOrganizer(id: string, email?: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('organizers').upsert({ id, email: email ?? null }, { onConflict: 'id' });
}

export async function createEvent(input: CreateEventInput): Promise<EventRow> {
  const supabase = getSupabase();
  await ensureOrganizer(input.organizerId, input.organizerEmail);
  const plan = input.plan ?? 'party';
  const planLimits = limits[plan];
  const pin = input.pin?.trim() || undefined;
  const row = {
    slug: input.slug.toLowerCase(),
    organizer_id: input.organizerId,
    title: input.title.trim(),
    pin_hash: pin ? await hashPin(pin) : null,
    pin_enabled: !!pin,
    status: 'active' as const,
    plan,
    photo_limit: planLimits.photoLimit,
    moderation_enabled: input.moderationEnabled ?? planLimits.moderation,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    settings: input.settings ?? {},
  };
  const { data, error } = await supabase.from('events').insert(row).select('*').single();
  if (error) throw error;
  return data as EventRow;
}

export async function listOrganizerEvents(organizerId: string): Promise<EventRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('organizer_id', organizerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as EventRow[];
}

export async function listEventsForProfile(profile: {
  id: string;
  role: string;
}): Promise<EventRow[]> {
  if (profile.role === 'admin') {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as EventRow[];
  }
  return listOrganizerEvents(profile.id);
}

export async function updateEvent(
  eventId: string,
  organizerId: string,
  patch: Partial<{
    title: string;
    status: EventRow['status'];
    ends_at: string | null;
    moderation_enabled: boolean;
    settings: EventSettings;
    pin: string;
  }>,
): Promise<EventRow> {
  const supabase = getSupabase();
  const existing = await getEventById(eventId);
  if (!existing) throw new Error('NOT_FOUND');
  const { data: org } = await getSupabase()
    .from('organizers')
    .select('role')
    .eq('id', organizerId)
    .maybeSingle();
  const isAdmin = org?.role === 'admin';
  if (!isAdmin && existing.organizer_id !== organizerId) {
    throw new Error('NOT_FOUND');
  }
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.status !== undefined) body.status = patch.status;
  if (patch.ends_at !== undefined) body.ends_at = patch.ends_at;
  if (patch.moderation_enabled !== undefined) body.moderation_enabled = patch.moderation_enabled;
  if (patch.settings !== undefined) body.settings = patch.settings;
  if (patch.pin !== undefined) {
    body.pin_hash = patch.pin ? await hashPin(patch.pin) : null;
    body.pin_enabled = !!patch.pin;
  }
  const { data, error } = await supabase
    .from('events')
    .update(body)
    .eq('id', eventId)
    .select('*')
    .single();
  if (error) throw error;
  return data as EventRow;
}

/** Legacy: one event from env for existing wedding deployment */
export async function ensureLegacyEvent(): Promise<EventRow | null> {
  const slug = (process.env.LEGACY_EVENT_SLUG || 'main').trim().toLowerCase();
  const pin = process.env.EVENT_PIN?.trim();
  const title = process.env.LEGACY_EVENT_TITLE || 'Живая лента';
  const supabase = getSupabase();
  const { data: existing } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle();
  if (existing) {
    const ev = existing as EventRow;
    const { count } = await supabase
      .from('photos')
      .select('*', { count: 'exact', head: true })
      .is('event_id', null);
    if (count && count > 0) {
      await supabase.from('photos').update({ event_id: ev.id }).is('event_id', null);
    }
    return ev;
  }
  const settings: EventSettings = {
    welcomeTitle: title,
    welcomeSubtitle: process.env.LEGACY_EVENT_SUBTITLE || undefined,
    loginBgUrl: `${process.env.LEGACY_LOGIN_BG || '/login-bg.jpg'}`,
    headerSubtitle: process.env.LEGACY_EVENT_SUBTITLE || undefined,
  };
  const row = {
    slug,
    organizer_id: null,
    title,
    pin_hash: pin ? await hashPin(pin) : null,
    pin_enabled: !!pin,
    status: 'active' as const,
    plan: 'premium' as const,
    photo_limit: limits.premium.photoLimit,
    moderation_enabled: false,
    settings,
  };
  const { data, error } = await supabase.from('events').insert(row).select('*').single();
  if (error) throw error;
  const ev = data as EventRow;
  await supabase.from('photos').update({ event_id: ev.id }).is('event_id', null);
  return ev;
}
