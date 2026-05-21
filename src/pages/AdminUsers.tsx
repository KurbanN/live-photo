import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, UserPlus, UserX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  fetchMe,
  grantOrganizer,
  listAdminOrganizers,
  revokeOrganizer,
  type AdminInviteRow,
  type AdminOrganizerRow,
} from '@/lib/organizer-api';

export default function AdminUsers() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [organizers, setOrganizers] = useState<AdminOrganizerRow[]>([]);
  const [invites, setInvites] = useState<AdminInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const me = await fetchMe();
      if (me.role !== 'admin') {
        navigate('/dashboard', { replace: true });
        return;
      }
      const data = await listAdminOrganizers();
      setOrganizers(data.organizers);
      setInvites(data.invites);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) navigate('/dashboard/login', { replace: true });
      else void load();
    });
  }, [navigate]);

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');
    try {
      const msg = await grantOrganizer(email.trim());
      setMessage(msg);
      setEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (targetEmail: string) => {
    if (!confirm(`Отозвать доступ у ${targetEmail}?`)) return;
    try {
      await revokeOrganizer(targetEmail);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line px-6 py-4">
        <Link to="/dashboard" className="text-xs uppercase text-muted">
          ← Кабинет
        </Link>
        <h1 className="font-serif text-2xl mt-2">Организаторы</h1>
        <p className="text-sm text-muted mt-1">
          Выдайте роль организатора по email. После входа пользователь сможет создавать мероприятия.
        </p>
      </header>

      <main className="max-w-2xl mx-auto p-6 space-y-8">
        <form onSubmit={handleGrant} className="flex gap-2 flex-col sm:flex-row">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email организатора"
            className="flex-1 border border-line px-3 py-2"
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center justify-center gap-2 bg-ink text-paper px-4 py-2 text-xs uppercase"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Выдать роль
          </button>
        </form>
        {message && <p className="text-sm text-ink border border-line p-3">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}

        {loading ? (
          <Loader2 className="animate-spin text-muted" />
        ) : (
          <>
            <section>
              <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">Активные</h2>
              <ul className="space-y-2">
                {organizers
                  .filter((o) => o.role === 'organizer' || o.role === 'admin')
                  .map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between border border-line px-4 py-3 text-sm"
                    >
                      <span>
                        {o.email}{' '}
                        <span className="text-muted text-xs uppercase ml-2">{o.role}</span>
                      </span>
                      {o.role === 'organizer' && o.email && (
                        <button
                          type="button"
                          onClick={() => void handleRevoke(o.email!)}
                          className="text-red-700 text-xs uppercase flex items-center gap-1"
                        >
                          <UserX className="h-3 w-3" /> Отозвать
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </section>

            <section>
              <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">
                Ожидают первого входа
              </h2>
              {invites.length === 0 ? (
                <p className="text-sm text-muted">Нет приглашений</p>
              ) : (
                <ul className="space-y-2">
                  {invites.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center justify-between border border-line px-4 py-3 text-sm"
                    >
                      <span>{inv.email}</span>
                      <button
                        type="button"
                        onClick={() => void handleRevoke(inv.email)}
                        className="text-muted text-xs uppercase"
                      >
                        Отменить
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {organizers.filter((o) => o.role === 'pending').length > 0 && (
              <section>
                <h2 className="text-xs uppercase tracking-[0.2em] text-muted mb-3">Без доступа</h2>
                <ul className="space-y-2">
                  {organizers
                    .filter((o) => o.role === 'pending')
                    .map((o) => (
                      <li key={o.id} className="border border-line px-4 py-3 text-sm text-muted">
                        {o.email} — вошли, но роль не выдана
                      </li>
                    ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
