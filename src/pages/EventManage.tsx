import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Download, Loader2, Trash2, X } from 'lucide-react';
import {
  deleteOrgPhoto,
  downloadQr,
  endEvent,
  getEvent,
  listEventPhotos,
  moderatePhoto,
  type OrgPhoto,
} from '@/lib/organizer-api';
import { createClient } from '@/lib/supabase/client';

export default function EventManage() {
  const { id = '' } = useParams<{ id: string }>();
  const [guestUrl, setGuestUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('');
  const [photos, setPhotos] = useState<OrgPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { event, guestUrl: url } = await getEvent(id);
      setGuestUrl(url);
      setSlug(event.slug);
      setTitle(event.title);
      setStatus(event.status);
      setPhotos(await listEventPhotos(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadZip = async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const raw = import.meta.env.VITE_API_BASE_URL?.trim() ?? '';
    const prefix = raw.replace(/\/+$/, '');
    const url = `${prefix}/api/v1/organizer/events/${id}/export.zip`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert((body as { error?: string }).error || 'Ошибка архива');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}-photos.zip`;
    a.click();
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-paper pb-12">
      <header className="border-b border-line px-6 py-4">
        <Link to="/dashboard" className="text-xs uppercase text-muted">
          ← Мероприятия
        </Link>
        <h1 className="font-serif text-2xl mt-2">{title}</h1>
        <p className="text-xs text-muted mt-1">
          {status} · <a href={guestUrl} className="underline">{guestUrl}</a>
        </p>
      </header>
      <div className="p-6 max-w-3xl mx-auto flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => downloadQr(id, slug)}
          className="border border-ink px-4 py-2 text-xs uppercase"
        >
          <Download className="inline w-4 h-4 mr-1" />
          QR PNG
        </button>
        <button type="button" onClick={() => void downloadZip()} className="border border-ink px-4 py-2 text-xs uppercase">
          ZIP все фото
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!confirm('Закрыть приём фото?')) return;
            await endEvent(id);
            await load();
          }}
          className="border border-red-800 text-red-800 px-4 py-2 text-xs uppercase"
        >
          Закрыть ленту
        </button>
      </div>
      {error && <p className="px-6 text-red-700 text-sm">{error}</p>}
      <section className="px-6 max-w-3xl mx-auto">
        <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-4">Модерация ({photos.length})</h2>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((p) => (
            <li key={p.id} className="border border-line">
              <img src={p.url} alt="" className="aspect-square object-cover w-full" />
              <div className="p-2 flex gap-1 text-[10px] uppercase">
                {p.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      onClick={async () => {
                        await moderatePhoto(id, p.id, 'approved');
                        await load();
                      }}
                      className="flex-1 bg-ink text-paper py-1 flex justify-center"
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await moderatePhoto(id, p.id, 'rejected');
                        await load();
                      }}
                      className="flex-1 border border-line py-1 flex justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm('Удалить?')) return;
                    await deleteOrgPhoto(id, p.id);
                    await load();
                  }}
                  className="flex-1 text-red-700 py-1 flex justify-center"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {p.status && <p className="px-2 pb-1 text-[10px] text-muted">{p.status}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
