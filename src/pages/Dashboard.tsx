import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Plus, Shield } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { fetchMe, listEvents, type EventRow, type OrganizerProfile } from '@/lib/organizer-api';

export default function Dashboard() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<OrganizerProfile | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const canCreate = profile?.role === 'admin' || profile?.role === 'organizer';

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate('/dashboard/login', { replace: true });
      else void load();
    });
  }, [navigate]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const me = await fetchMe();
      setProfile(me);
      if (me.role === 'admin' || me.role === 'organizer') {
        setEvents(await listEvents());
      } else {
        setEvents([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await createClient().auth.signOut();
    navigate('/dashboard/login');
  };

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line px-6 py-4 flex justify-between items-center gap-4">
        <div>
          <span className="font-serif text-xl">Кабинет</span>
          {profile && (
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted mt-0.5">
              {profile.email} · {profile.role}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          {profile?.role === 'admin' && (
            <Link
              to="/dashboard/admin"
              className="text-xs uppercase tracking-[0.15em] text-ink flex items-center gap-1"
            >
              <Shield className="w-4 h-4" /> Организаторы
            </Link>
          )}
          <button type="button" onClick={logout} className="text-xs uppercase text-muted">
            Выйти
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-6">
        {!loading && profile?.role === 'pending' && (
          <div className="mb-8 border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
            <p className="font-medium">Доступ организатора не выдан</p>
            <p className="mt-1 text-amber-900/80">
              Войдите под email, который передал администратор платформы, или попросите выдать роль
              организатора.
            </p>
          </div>
        )}

        {canCreate && (
          <Link
            to="/dashboard/new"
            className="inline-flex items-center gap-2 bg-ink text-paper px-4 py-3 text-xs uppercase tracking-[0.2em] mb-8"
          >
            <Plus className="h-4 w-4" /> Новое мероприятие
          </Link>
        )}

        {loading && <Loader2 className="animate-spin text-muted" />}
        {error && <p className="text-red-700 text-sm">{error}</p>}

        {canCreate && (
          <>
            <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-4">
              {profile?.role === 'admin' ? 'Все мероприятия' : 'Мои мероприятия'}
            </h2>
            <ul className="space-y-3">
              {events.map((ev) => (
                <li key={ev.id}>
                  <Link
                    to={`/dashboard/events/${ev.id}`}
                    className="block border border-line p-4 hover:bg-white transition-colors"
                  >
                    <p className="font-medium text-ink">{ev.title}</p>
                    <p className="text-xs text-muted mt-1">
                      /e/{ev.slug} · {ev.status} · {ev.plan}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            {!loading && events.length === 0 && (
              <p className="text-muted text-sm">Пока нет мероприятий. Создайте первое.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
