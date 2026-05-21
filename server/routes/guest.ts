import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import {
  eventIsUploadAllowed,
  getEventBySlug,
  verifyEventPin,
} from '../events-db.js';
import { pinAttemptLimiter, uploadLimiter } from '../middleware.js';
import {
  downloadPhotoBuffer,
  listPhotosForGuest,
  uploadPhotoForEvent,
} from '../photos.js';
import type { EventSettings } from '../types.js';

const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 40;

function looksLikeImageUpload(file: Express.Multer.File): boolean {
  if (file.mimetype.startsWith('image/')) return true;
  const name = (file.originalname || '').toLowerCase();
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/.test(name);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (looksLikeImageUpload(file)) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

export function guestRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get('/:slug/public', async (req, res) => {
    try {
      const event = await getEventBySlug(req.params.slug);
      if (!event) {
        res.status(404).json({ error: 'Мероприятие не найдено' });
        return;
      }
      const settings = (event.settings || {}) as EventSettings;
      const uploadCheck = eventIsUploadAllowed(event);
      res.json({
        slug: event.slug,
        title: event.title,
        status: event.status,
        pinRequired: event.pin_enabled,
        uploadsOpen: uploadCheck.ok,
        uploadsClosedReason: uploadCheck.reason,
        moderationEnabled: event.moderation_enabled,
        settings: {
          welcomeTitle: settings.welcomeTitle ?? event.title,
          welcomeSubtitle: settings.welcomeSubtitle,
          loginBgUrl: settings.loginBgUrl,
          headerSubtitle: settings.headerSubtitle ?? settings.welcomeSubtitle,
        },
      });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  router.get('/:slug/photos', pinAttemptLimiter, async (req, res) => {
    const pin = req.header('x-event-pin');
    try {
      const event = await getEventBySlug(req.params.slug);
      if (!event) {
        res.status(404).json({ error: 'Мероприятие не найдено' });
        return;
      }
      if (!(await verifyEventPin(event, pin))) {
        res.status(401).json({ error: 'Нужен код мероприятия' });
        return;
      }
      const photos = await listPhotosForGuest(event);
      res.json({ photos });
    } catch (e: unknown) {
      console.error('[guest photos]', e);
      res.status(500).json({ error: 'Не удалось загрузить ленту', hint: formatDbHint(e) });
    }
  });

  router.get('/:slug/photos/:id/download', pinAttemptLimiter, async (req, res) => {
    const pin = req.header('x-event-pin');
    try {
      const event = await getEventBySlug(req.params.slug);
      if (!event) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      if (!(await verifyEventPin(event, pin))) {
        res.status(401).json({ error: 'Нужен код' });
        return;
      }
      const { buffer, filename, contentType } = await downloadPhotoBuffer(event.id, req.params.id);
      const ext = path.extname(filename) || '.jpg';
      const downloadName = `photo-${req.params.id.slice(0, 12)}${ext}`;
      res.setHeader('Content-Type', contentType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      );
      res.send(buffer);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка скачивания' });
    }
  });

  router.post(
    '/:slug/upload',
    uploadLimiter,
    pinAttemptLimiter,
    (req, res, next) => {
      upload.single('photo')(req, res, (err: unknown) => {
        if (err) {
          const msg = err instanceof Error ? err.message : 'Ошибка файла';
          res.status(400).json({ error: msg });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      const pin = req.header('x-event-pin');
      try {
        const event = await getEventBySlug(req.params.slug);
        if (!event) {
          res.status(404).json({ error: 'Мероприятие не найдено' });
          return;
        }
        if (!(await verifyEventPin(event, pin))) {
          res.status(401).json({ error: 'Неверный код' });
          return;
        }
        const allowed = eventIsUploadAllowed(event);
        if (!allowed.ok) {
          res.status(403).json({ error: allowed.reason });
          return;
        }
        if (!req.file?.buffer) {
          res.status(400).json({ error: 'Нет файла' });
          return;
        }
        const authorRaw =
          typeof req.body?.author === 'string' ? req.body.author.trim().slice(0, 80) : '';
        const photo = await uploadPhotoForEvent(
          event,
          req.file.buffer,
          req.file.originalname || 'photo.jpg',
          req.file.mimetype,
          authorRaw || undefined,
        );
        res.status(201).json({
          photo,
          pendingModeration: event.moderation_enabled,
        });
      } catch (e) {
        if (e instanceof Error && e.message === 'PHOTO_LIMIT') {
          res.status(403).json({ error: 'Достигнут лимит фото для тарифа' });
          return;
        }
        console.error(e);
        res.status(500).json({ error: 'Не удалось сохранить фото' });
      }
    },
  );

  return router;
}

function formatDbHint(e: unknown): string {
  const chain = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|getaddrinfo/i.test(chain)) {
    return 'DNS не находит Supabase. Проверьте SUPABASE_URL и DNS.';
  }
  if (/relation|does not exist|42P01/i.test(chain)) {
    return 'Выполните supabase/migrations/001_saas_events.sql';
  }
  return '';
}
