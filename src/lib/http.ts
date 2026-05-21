/** Разбор ответа API; если пришёл HTML (404 Vite / сервер не запущен) — понятная ошибка. */
export async function parseApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (trimmed.startsWith('<')) {
    throw new Error(
      'API недоступен. Запустите `npm run dev` (нужны и фронт, и сервер на порту 8787). ' +
        'Если ошибка остаётся — закройте старый процесс на порту 8787 и перезапустите.',
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(trimmed.slice(0, 120) || 'Некорректный ответ сервера');
  }
}
