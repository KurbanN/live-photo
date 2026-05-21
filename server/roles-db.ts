import { getSupabase } from './supabase.js';

export type OrganizerRole = 'admin' | 'organizer' | 'pending';

export type OrganizerProfile = {
  id: string;
  email: string | null;
  role: OrganizerRole;
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getPlatformAdminEmails(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS?.trim() || 'dunga309@gmail.com';
  return new Set(
    raw
      .split(',')
      .map((e) => normalizeEmail(e))
      .filter(Boolean),
  );
}

export function isPlatformAdminEmail(email: string | undefined): boolean {
  if (!email) return false;
  return getPlatformAdminEmails().has(normalizeEmail(email));
}

export async function resolveOrganizerProfile(
  userId: string,
  email?: string,
): Promise<OrganizerProfile> {
  const supabase = getSupabase();
  const normalized = email ? normalizeEmail(email) : null;

  if (normalized && isPlatformAdminEmail(normalized)) {
    const { data, error } = await supabase
      .from('organizers')
      .upsert({ id: userId, email: normalized, role: 'admin' }, { onConflict: 'id' })
      .select('id, email, role')
      .single();
    if (error) throw error;
    return data as OrganizerProfile;
  }

  const { data: existing } = await supabase
    .from('organizers')
    .select('id, email, role')
    .eq('id', userId)
    .maybeSingle();

  if (existing && (existing as OrganizerProfile).role !== 'pending') {
    return existing as OrganizerProfile;
  }

  let role: OrganizerRole = 'pending';
  if (normalized) {
    const { data: invite } = await supabase
      .from('organizer_invites')
      .select('id')
      .eq('email', normalized)
      .maybeSingle();
    if (invite) role = 'organizer';
  }

  const { data, error } = await supabase
    .from('organizers')
    .upsert(
      { id: userId, email: normalized ?? existing?.email ?? null, role },
      { onConflict: 'id' },
    )
    .select('id, email, role')
    .single();
  if (error) throw error;

  if (role === 'organizer' && normalized) {
    await supabase.from('organizer_invites').delete().eq('email', normalized);
  }

  return data as OrganizerProfile;
}

export function canManageEvents(role: OrganizerRole): boolean {
  return role === 'admin' || role === 'organizer';
}

export async function grantOrganizerByEmail(
  adminId: string,
  email: string,
): Promise<{ ok: true; status: 'invited' | 'promoted' }> {
  const supabase = getSupabase();
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('INVALID_EMAIL');
  if (isPlatformAdminEmail(normalized)) {
    throw new Error('CANNOT_GRANT_ADMIN');
  }

  const { data: authList, error: authErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authErr) throw authErr;

  const authUser = authList.users.find((u) => u.email && normalizeEmail(u.email) === normalized);

  if (authUser) {
    const { error } = await supabase.from('organizers').upsert(
      { id: authUser.id, email: normalized, role: 'organizer' },
      { onConflict: 'id' },
    );
    if (error) throw error;
    await supabase.from('organizer_invites').delete().eq('email', normalized);
    return { ok: true, status: 'promoted' };
  }

  const { error: invErr } = await supabase.from('organizer_invites').upsert(
    { email: normalized, granted_by: adminId },
    { onConflict: 'email' },
  );
  if (invErr) throw invErr;
  return { ok: true, status: 'invited' };
}

export async function revokeOrganizerAccess(email: string): Promise<void> {
  const supabase = getSupabase();
  const normalized = normalizeEmail(email);
  if (isPlatformAdminEmail(normalized)) {
    throw new Error('CANNOT_REVOKE_ADMIN');
  }

  await supabase.from('organizer_invites').delete().eq('email', normalized);

  const { data: authList } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUser = authList?.users.find(
    (u) => u.email && normalizeEmail(u.email) === normalized,
  );
  if (authUser) {
    await supabase
      .from('organizers')
      .update({ role: 'pending' })
      .eq('id', authUser.id);
  }
}

export type OrganizerListItem = {
  id: string;
  email: string | null;
  role: OrganizerRole;
  created_at: string;
};

export type PendingInvite = {
  id: string;
  email: string;
  created_at: string;
};

export async function listOrganizersAndInvites(): Promise<{
  organizers: OrganizerListItem[];
  invites: PendingInvite[];
}> {
  const supabase = getSupabase();
  const { data: orgs, error: oErr } = await supabase
    .from('organizers')
    .select('id, email, role, created_at')
    .order('created_at', { ascending: false });
  if (oErr) throw oErr;

  const { data: invites, error: iErr } = await supabase
    .from('organizer_invites')
    .select('id, email, created_at')
    .order('created_at', { ascending: false });
  if (iErr) throw iErr;

  return {
    organizers: (orgs ?? []) as OrganizerListItem[],
    invites: (invites ?? []) as PendingInvite[],
  };
}
