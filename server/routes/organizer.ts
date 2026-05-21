import { Router } from 'express';
import { createRequire } from 'module';
import QRCode from 'qrcode';

const require = createRequire(import.meta.url);
const archiver = require('archiver') as typeof import('archiver');
import { getOrganizer, requireOrganizer, requireEventManager } from '../auth.js';
import type { AuthUser } from '../auth.js';
import {
  createEvent,
  getEventById,
  listEventsForProfile,
  slugify,
  updateEvent,
} from '../events-db.js';
import type { EventRow } from '../types.js';

function canAccessEvent(event: EventRow, org: AuthUser): boolean {
  return org.role === 'admin' || event.organizer_id === org.id;
}
import {
  deletePhotoForEvent,
  downloadPhotoBuffer,
  listPhotosForOrganizer,
  moderatePhoto,
} from '../photos.js';
import { generatePin } from '../pin.js';
import type { EventPlan, EventSettings } from '../types.js';

function guestBaseUrl(): string {
  const app = process.env.APP_PUBLIC_URL?.trim();
  if (app) return app.replace(/\/+$/, '');
  return 'http://localhost:5174';
}

export function organizerRouter(): Router {
  const router = Router();

  router.get('/me', requireOrganizer, async (req, res) => {
    res.json({ profile: getOrganizer(req) });
  });

  router.use(requireEventManager);

  router.get('/events', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const events = await listEventsForProfile(org);
      res.json({ events });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка списка' });
    }
  });

  router.post('/events', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const body = req.body as {
        title?: string;
        slug?: string;
        pin?: string;
        plan?: EventPlan;
        moderationEnabled?: boolean;
        startsAt?: string;
        endsAt?: string;
        settings?: EventSettings;
      };
      const title = (body.title || 'Мероприятие').trim();
      const slug = slugify(body.slug || title);
      const pin = body.pin?.trim() || generatePin();
      const event = await createEvent({
        slug,
        title,
        pin,
        plan: body.plan,
        moderationEnabled: body.moderationEnabled,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
        settings: body.settings,
        organizerId: org.id,
        organizerEmail: org.email ?? undefined,
      });
      res.status(201).json({ event, pin, guestUrl: `${guestBaseUrl()}/e/${event.slug}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '';
      if (/duplicate|unique/i.test(msg)) {
        res.status(409).json({ error: 'Такой адрес (slug) уже занят' });
        return;
      }
      console.error(e);
      res.status(500).json({ error: 'Не удалось создать мероприятие' });
    }
  });

  router.get('/events/:id', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const event = await getEventById(req.params.id);
      if (!event || !canAccessEvent(event, org)) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      res.json({
        event,
        guestUrl: `${guestBaseUrl()}/e/${event.slug}`,
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка' });
    }
  });

  router.patch('/events/:id', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const body = req.body as {
        title?: string;
        status?: 'draft' | 'active' | 'ended' | 'archived';
        endsAt?: string | null;
        moderationEnabled?: boolean;
        settings?: EventSettings;
        pin?: string;
      };
      const event = await updateEvent(req.params.id, org.id, {
        title: body.title,
        status: body.status,
        ends_at: body.endsAt,
        moderation_enabled: body.moderationEnabled,
        settings: body.settings,
        pin: body.pin,
      });
      res.json({ event });
    } catch (e) {
      if (e instanceof Error && e.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      console.error(e);
      res.status(500).json({ error: 'Ошибка обновления' });
    }
  });

  router.get('/events/:id/photos', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const event = await getEventById(req.params.id);
      if (!event || !canAccessEvent(event, org)) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      const photos = await listPhotosForOrganizer(event.id);
      res.json({ photos });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка' });
    }
  });

  router.patch('/events/:id/photos/:photoId', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const event = await getEventById(req.params.id);
      if (!event || !canAccessEvent(event, org)) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      const status = (req.body as { status?: string }).status;
      if (status !== 'approved' && status !== 'rejected') {
        res.status(400).json({ error: 'status: approved | rejected' });
        return;
      }
      await moderatePhoto(event.id, req.params.photoId, status);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка модерации' });
    }
  });

  router.delete('/events/:id/photos/:photoId', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const event = await getEventById(req.params.id);
      if (!event || !canAccessEvent(event, org)) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      await deletePhotoForEvent(event.id, req.params.photoId);
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Не удалось удалить' });
    }
  });

  router.get('/events/:id/qr', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const event = await getEventById(req.params.id);
      if (!event || !canAccessEvent(event, org)) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      const url = `${guestBaseUrl()}/e/${event.slug}`;
      const png = await QRCode.toBuffer(url, { width: 512, margin: 2 });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="qr-${event.slug}.png"`);
      res.send(png);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'QR ошибка' });
    }
  });

  router.get('/events/:id/export.zip', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const event = await getEventById(req.params.id);
      if (!event || !canAccessEvent(event, org)) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      const photos = await listPhotosForOrganizer(event.id);
      const approved = photos.filter((p) => p.status !== 'rejected');
      if (approved.length > 500) {
        res.status(400).json({ error: 'Слишком много фото для синхронного архива (max 500). Свяжитесь с поддержкой.' });
        return;
      }
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${event.slug}-photos.zip"`,
      );
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.on('error', (err) => {
        console.error(err);
        if (!res.headersSent) res.status(500).end();
      });
      archive.pipe(res);
      for (const p of approved) {
        const { buffer, filename } = await downloadPhotoBuffer(event.id, p.id);
        archive.append(buffer, { name: filename });
      }
      await archive.finalize();
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Ошибка архива' });
    }
  });

  router.post('/events/:id/end', async (req, res) => {
    try {
      const org = getOrganizer(req);
      const event = await updateEvent(req.params.id, org.id, {
        status: 'ended',
        ends_at: new Date().toISOString(),
      });
      res.json({ event });
    } catch (e) {
      if (e instanceof Error && e.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      res.status(500).json({ error: 'Ошибка' });
    }
  });

  return router;
}
