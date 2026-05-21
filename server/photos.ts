import path from 'path';
import { randomUUID } from 'crypto';
import { getBucket, getSupabase } from './supabase.js';
import type { EventRow, PhotoEntry, PhotoRow, PhotoStatus } from './types.js';
import { countEventPhotos } from './events-db.js';

export function publicUrlForPath(storagePath: string): string {
  const supabase = getSupabase();
  const bucket = getBucket();
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

export function mimeFromFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
  };
  return map[ext] ?? 'application/octet-stream';
}

function rowToEntry(row: PhotoRow): PhotoEntry {
  return {
    id: row.id,
    url: publicUrlForPath(row.storage_path),
    createdAt: row.created_at,
    ...(row.author ? { author: row.author } : {}),
    status: row.status,
  };
}

export async function listPhotosForGuest(event: EventRow): Promise<PhotoEntry[]> {
  const supabase = getSupabase();
  let q = supabase
    .from('photos')
    .select('id, storage_path, created_at, author, status')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false });
  if (event.moderation_enabled) {
    q = q.eq('status', 'approved');
  } else {
    q = q.neq('status', 'rejected');
  }
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as PhotoRow[]).map(rowToEntry);
}

export async function listPhotosForOrganizer(eventId: string): Promise<PhotoEntry[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('photos')
    .select('id, storage_path, created_at, author, status')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PhotoRow[]).map(rowToEntry);
}

export async function uploadPhotoForEvent(
  event: EventRow,
  buffer: Buffer,
  originalName: string,
  mimetype: string,
  author?: string,
): Promise<PhotoEntry> {
  const count = await countEventPhotos(event.id);
  if (count >= event.photo_limit) {
    throw new Error('PHOTO_LIMIT');
  }
  const ext = path.extname(originalName) || '.jpg';
  const id = randomUUID();
  const storagePath = `events/${event.id}/${id}${ext}`;
  const supabase = getSupabase();
  const bucket = getBucket();
  const contentType = mimetype.startsWith('image/') ? mimetype : mimeFromFilename(ext);
  const status: PhotoStatus = event.moderation_enabled ? 'pending' : 'approved';

  const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
    contentType,
    upsert: false,
  });
  if (upErr) throw upErr;

  const { data: inserted, error: insErr } = await supabase
    .from('photos')
    .insert({
      id,
      event_id: event.id,
      storage_path: storagePath,
      status,
      ...(author ? { author } : {}),
    })
    .select('id, storage_path, created_at, author, status')
    .single();
  if (insErr) {
    await supabase.storage.from(bucket).remove([storagePath]).catch(() => {});
    throw insErr;
  }
  return rowToEntry(inserted as PhotoRow);
}

export async function deletePhotoForEvent(eventId: string, photoId: string): Promise<void> {
  const supabase = getSupabase();
  const bucket = getBucket();
  const { data: row, error: fetchErr } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('id', photoId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row?.storage_path) throw new Error('NOT_FOUND');
  const { error: delErr } = await supabase.from('photos').delete().eq('id', photoId);
  if (delErr) throw delErr;
  await supabase.storage.from(bucket).remove([row.storage_path]).catch(() => {});
}

export async function moderatePhoto(
  eventId: string,
  photoId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('photos')
    .update({ status })
    .eq('id', photoId)
    .eq('event_id', eventId);
  if (error) throw error;
}

export async function downloadPhotoBuffer(
  eventId: string,
  photoId: string,
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const supabase = getSupabase();
  const bucket = getBucket();
  const { data: row, error: fetchErr } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('id', photoId)
    .eq('event_id', eventId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!row?.storage_path) throw new Error('NOT_FOUND');
  const { data: fileData, error: dlErr } = await supabase.storage.from(bucket).download(row.storage_path);
  if (dlErr || !fileData) throw new Error('NOT_FOUND');
  const base = path.basename(row.storage_path);
  const buf = Buffer.from(await fileData.arrayBuffer());
  return { buffer: buf, filename: base, contentType: mimeFromFilename(base) };
}
