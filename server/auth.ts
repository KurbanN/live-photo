import type { Request, Response, NextFunction } from 'express';
import { getSupabase } from './supabase.js';
import { resolveOrganizerProfile, canManageEvents, type OrganizerProfile } from './roles-db.js';

export type AuthUser = OrganizerProfile;

async function loadProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Сессия недействительна' });
    return;
  }
  try {
    const profile = await resolveOrganizerProfile(data.user.id, data.user.email);
    (req as Request & { organizer: AuthUser }).organizer = profile;
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка профиля' });
  }
}

export const requireOrganizer = loadProfile;

export async function requireEventManager(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await loadProfile(req, res, () => {
    const org = getOrganizer(req);
    if (!canManageEvents(org.role)) {
      res.status(403).json({
        error: 'Нет доступа организатора',
        hint: 'Попросите администратора выдать роль организатора на ваш email.',
        role: org.role,
      });
      return;
    }
    next();
  });
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await loadProfile(req, res, () => {
    if (getOrganizer(req).role !== 'admin') {
      res.status(403).json({ error: 'Только для администратора платформы' });
      return;
    }
    next();
  });
}

export function getOrganizer(req: Request): AuthUser {
  return (req as Request & { organizer: AuthUser }).organizer;
}
