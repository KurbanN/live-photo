import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { getBucket, getSupabase } from './supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8787;
const EVENT_PIN = process.env.EVENT_PIN?.trim() ?? '';
const MAX_FILE_MB = Number(process.env.MAX_FILE_MB) || 40;

export type PhotoEntry = {
  id: string;
  url: string;
  createdAt: string;
  author?: string;
};

function pinOk(headerPin: string | undefined): boolean {
  if (!EVENT_PIN) return true;
  return !!headerPin && headerPin === EVENT_PIN;
}

function mimeFromFilename(filename: string): string {
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

function publicUrlForPath(storagePath: string): string {
  const supabase = getSupabase();
  const bucket = getBucket();
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Только изображения'));
  },
});

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_req, res) => {
    const hasSb = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    res.json({ ok: true, pinConfigured: Boolean(EVENT_PIN), supabaseConfigured: hasSb });
  });

  app.get('/api/photos', async (_req, res) => {
    const pin = _req.header('x-event-pin');
    if (!pinOk(pin)) {
      res.status(401).json({ error: 'Нужен код мероприятия' });
      return;
    }
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('photos')
        .select('id, storage_path, created_at, author')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = data ?? [];
      const photos: PhotoEntry[] = rows.map((row) => ({
        id: row.id,
        url: publicUrlForPath(row.storage_path),
        createdAt: row.created_at,
        ...(row.author ? { author: row.author } : {}),
      }));
      res.json({ photos });
    } catch (e: unknown) {
      console.error('[api/photos]', e);
      const pg = e as { message?: string; details?: string; hint?: string; code?: string };
      const raw = [pg.message, pg.details].filter(Boolean).join(' — ');
      let hint =
        'Проверьте .env: SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY (секрет service_role), перезапустите сервер.';
      if (/relation|does not exist|42P01/i.test(raw)) {
        hint = 'В Supabase SQL Editor выполните скрипт из файла supabase/schema.sql (таблица public.photos).';
      } else if (/permission denied|42501|JWT|invalid/i.test(raw)) {
        hint =
          'Доступ отклонён: часто в SUPABASE_SERVICE_ROLE_KEY ошибочно вставлен ключ **anon** вместо **service_role**. Dashboard → Settings → API → скопируйте секрет service_role.';
      }
      const debug =
        process.env.NODE_ENV !== 'production' && raw ? ` ${raw}` : '';
      res.status(500).json({
        error: 'Не удалось загрузить ленту с сервера.',
        hint: `${hint}${debug}`.trim(),
      });
    }
  });

  app.get('/api/photos/:id/download', async (req, res) => {
    const pin = req.header('x-event-pin');
    if (!pinOk(pin)) {
      res.status(401).json({ error: 'Нужен код мероприятия' });
      return;
    }
    const id = req.params.id;
    try {
      const supabase = getSupabase();
      const bucket = getBucket();
      const { data: row, error: fetchErr } = await supabase
        .from('photos')
        .select('storage_path')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!row?.storage_path) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      const { data: fileData, error: dlErr } = await supabase.storage.from(bucket).download(row.storage_path);
      if (dlErr || !fileData) {
        res.status(404).json({ error: 'Файл отсутствует' });
        return;
      }
      const base = path.basename(row.storage_path);
      const ext = path.extname(base) || '.jpg';
      const downloadName = `photo-${id.slice(0, 12)}${ext}`;
      const buf = Buffer.from(await fileData.arrayBuffer());
      res.setHeader('Content-Type', mimeFromFilename(base));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      );
      res.send(buf);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Ошибка скачивания' });
    }
  });

  app.post(
    '/api/upload',
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
      if (!pinOk(pin)) {
        res.status(401).json({ error: 'Неверный код' });
        return;
      }
      if (!req.file?.buffer) {
        res.status(400).json({ error: 'Нет файла' });
        return;
      }
      const authorRaw = typeof req.body?.author === 'string' ? req.body.author.trim().slice(0, 80) : '';
      const author = authorRaw || undefined;
      const ext = path.extname(req.file.originalname) || '.jpg';
      const id = randomUUID();
      const storagePath = `live/${id}${ext}`;
      try {
        const supabase = getSupabase();
        const bucket = getBucket();
        const { error: upErr } = await supabase.storage.from(bucket).upload(storagePath, req.file.buffer, {
          contentType: req.file.mimetype || mimeFromFilename(ext),
          upsert: false,
        });
        if (upErr) throw upErr;

        const { data: inserted, error: insErr } = await supabase
          .from('photos')
          .insert({
            id,
            storage_path: storagePath,
            ...(author ? { author } : {}),
          })
          .select('id, storage_path, created_at, author')
          .single();
        if (insErr) {
          await supabase.storage.from(bucket).remove([storagePath]).catch(() => {});
          throw insErr;
        }

        const photo: PhotoEntry = {
          id: inserted.id,
          url: publicUrlForPath(inserted.storage_path),
          createdAt: inserted.created_at,
          ...(inserted.author ? { author: inserted.author } : {}),
        };
        res.status(201).json({ photo });
      } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Не удалось сохранить фото' });
      }
    },
  );

  app.delete('/api/photos/:id', async (req, res) => {
    const pin = req.header('x-event-pin');
    if (!pinOk(pin)) {
      res.status(401).json({ error: 'Неверный код' });
      return;
    }
    const id = req.params.id;
    try {
      const supabase = getSupabase();
      const bucket = getBucket();
      const { data: row, error: fetchErr } = await supabase
        .from('photos')
        .select('storage_path')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!row?.storage_path) {
        res.status(404).json({ error: 'Не найдено' });
        return;
      }
      const pathToRemove = row.storage_path;
      const { error: delErr } = await supabase.from('photos').delete().eq('id', id);
      if (delErr) throw delErr;
      await supabase.storage.from(bucket).remove([pathToRemove]).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Не удалось удалить' });
    }
  });

  const distPath = path.join(ROOT, 'dist');
  if (existsSync(distPath)) {
    app.use(express.static(distPath, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) next(err);
      });
    });
  }

  return app;
}

async function main() {
  getSupabase();
  if (!EVENT_PIN && process.env.NODE_ENV === 'production') {
    console.warn('[wedding-live-photos] WARNING: EVENT_PIN is empty in production.');
  }
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`[wedding-live-photos] API + static on http://127.0.0.1:${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
