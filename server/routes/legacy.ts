import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { ensureLegacyEvent, verifyEventPin, eventIsUploadAllowed } from '../events-db.js';
import { pinAttemptLimiter, uploadLimiter } from '../middleware.js';
import {
  deletePhotoForEvent,
  downloadPhotoBuffer,
  listPhotosForGuest,
  uploadPhotoForEvent,
} from '../photos.js';

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

/** Backward-compatible /api/photos for existing wedding deploy */
export function legacyRouter(): Router {
  const router = Router();

  async function legacyEvent() {
    const ev = await ensureLegacyEvent();
    if (!ev) throw new Error('LEGACY_NOT_CONFIGURED');
    return ev;
  }

  router.get('/photos', pinAttemptLimiter, async (req, res) => {
    const pin = req.header('x-event-pin');
    try {
      const event = await legacyEvent();
      if (!(await verifyEventPin(event, pin))) {
        res.status(401).json({ error: 'Нужен код мероприятия' });
        return;
      }
      const photos = await listPhotosForGuest(event);
      res.json({ photos });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Не удалось загрузить ленту' });
    }
  });

  router.post(
    '/upload',
    uploadLimiter,
    (req, res, next) => {
      upload.single('photo')(req, res, (err: unknown) => {
        if (err) {
          res.status(400).json({ error: err instanceof Error ? err.message : 'Ошибка' });
          return;
        }
        next();
      });
    },
    async (req, res) => {
      const pin = req.header('x-event-pin');
      try {
        const event = await legacyEvent();
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
        res.status(201).json({ photo });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Не удалось сохранить' });
      }
    },
  );

  router.get('/photos/:id/download', pinAttemptLimiter, async (req, res) => {
    const pin = req.header('x-event-pin');
    try {
      const event = await legacyEvent();
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
        `attachment; filename="${downloadName}"`,
      );
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ error: 'Ошибка' });
    }
  });

  router.delete('/photos/:id', pinAttemptLimiter, async (req, res) => {
    const pin = req.header('x-event-pin');
    try {
      const event = await legacyEvent();
      if (!(await verifyEventPin(event, pin))) {
        res.status(401).json({ error: 'Неверный код' });
        return;
      }
      await deletePhotoForEvent(event.id, req.params.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Не удалось удалить' });
    }
  });

  return router;
}
