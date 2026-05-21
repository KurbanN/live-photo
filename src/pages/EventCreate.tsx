import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { createEvent } from '@/lib/organizer-api';

export default function EventCreate() {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState<'lite' | 'party' | 'premium'>('party');
  const [endsAt, setEndsAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ pin: string; guestUrl: string; id: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await createEvent({
        title: title.trim(),
        slug: slug.trim() || undefined,
        plan,
        endsAt: endsAt || undefined,
        moderationEnabled: plan !== 'lite',
      });
      setCreated({ pin: res.pin, guestUrl: res.guestUrl, id: res.event.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  if (created) {
    return (
      <div className="min-h-dvh p-6 max-w-md mx-auto">
        <h1 className="font-serif text-2xl mb-4">Мероприятие создано</h1>
        <p className="text-sm text-muted mb-2">Ссылка для гостей:</p>
        <p className="text-sm break-all bg-white border border-line p-3 mb-4">{created.guestUrl}</p>
        <p className="text-sm text-muted mb-2">PIN для гостей (сохраните):</p>
        <p className="text-2xl tracking-[0.3em] font-semibold mb-6">{created.pin}</p>
        <Link
          to={`/dashboard/events/${created.id}`}
          className="block text-center bg-ink text-paper py-3 text-xs uppercase"
        >
          Управление и QR
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-dvh p-6 max-w-md mx-auto">
      <Link to="/dashboard" className="text-xs uppercase text-muted">
        ← Назад
      </Link>
      <h1 className="font-serif text-2xl mt-4 mb-6">Новое мероприятие</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-xs uppercase text-muted">Название</label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border border-line px-3 py-2 mt-1"
          />
        </div>
        <div>
          <label className="text-xs uppercase text-muted">Адрес (slug, необязательно)</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="ivanova-2026"
            className="w-full border border-line px-3 py-2 mt-1"
          />
        </div>
        <div>
          <label className="text-xs uppercase text-muted">Тариф</label>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value as 'lite' | 'party' | 'premium')}
            className="w-full border border-line px-3 py-2 mt-1"
          >
            <option value="lite">Lite — 300 фото</option>
            <option value="party">Party — 2000 фото, модерация</option>
            <option value="premium">Premium — 5000 фото</option>
          </select>
        </div>
        <div>
          <label className="text-xs uppercase text-muted">Окончание приёма фото</label>
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="w-full border border-line px-3 py-2 mt-1"
          />
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-ink text-paper py-3 text-xs uppercase flex justify-center gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Создать
        </button>
      </form>
    </div>
  );
}
