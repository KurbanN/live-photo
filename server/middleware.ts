import rateLimit from 'express-rate-limit';

const windowMs = 15 * 60 * 1000;

export const pinAttemptLimiter = rateLimit({
  windowMs,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Подождите 15 минут.' },
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Лимит загрузок с этого устройства. Попробуйте позже.' },
});

export function corsOrigins(): string[] | boolean {
  const raw = process.env.ALLOWED_ORIGINS?.trim();
  if (!raw) return true;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
