import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

function formatAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('email rate limit') || m.includes('rate limit exceeded')) {
    return (
      'Supabase временно ограничил отправку писем на этот адрес (обычно 2–4 письма в час на бесплатном тарифе). ' +
      'Подождите 30–60 минут, проверьте папку «Спам» — возможно, ссылка уже пришла раньше. ' +
      'Для продакшена настройте свой SMTP в Supabase → Project Settings → Authentication → SMTP.'
    );
  }
  if (m.includes('signup disabled') || m.includes('signups not allowed')) {
    return 'Регистрация по email отключена в Supabase. Включите провайдер Email в Authentication → Providers.';
  }
  return message;
}

export default function OrganizerLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'magic' | 'password'>('magic');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate('/dashboard', { replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate('/dashboard', { replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = createClient();
      const trimmed = email.trim();
      if (mode === 'password') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: trimmed,
          password,
        });
        if (err) throw err;
        return;
      }
      const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}dashboard`.replace(
        /\/+/g,
        '/',
      );
      const { error: err } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo },
      });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Ошибка';
      setError(formatAuthError(raw));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-ink">
          ← На главную
        </Link>
        <h1 className="font-serif text-3xl mt-6 mb-2">Кабинет организатора</h1>
        <p className="text-sm text-muted mb-4">
          {mode === 'magic'
            ? 'Вход по ссылке из письма (magic link).'
            : 'Вход по паролю (нужен пароль в Supabase Auth).'}
        </p>
        <div className="flex gap-2 mb-6 text-[10px] uppercase tracking-[0.15em]">
          <button
            type="button"
            onClick={() => {
              setMode('magic');
              setSent(false);
              setError('');
            }}
            className={mode === 'magic' ? 'text-ink border-b border-ink' : 'text-muted'}
          >
            Ссылка на почту
          </button>
          <span className="text-muted">·</span>
          <button
            type="button"
            onClick={() => {
              setMode('password');
              setSent(false);
              setError('');
            }}
            className={mode === 'password' ? 'text-ink border-b border-ink' : 'text-muted'}
          >
            Пароль
          </button>
        </div>
        {sent && mode === 'magic' ? (
          <p className="text-sm text-ink bg-paper border border-line p-4">
            Проверьте почту <strong>{email}</strong> и перейдите по ссылке. Повторная отправка может
            сработать только через час.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              className="w-full border border-line px-3 py-3"
            />
            {mode === 'password' && (
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
                className="w-full border border-line px-3 py-3"
                autoComplete="current-password"
              />
            )}
            {error && <p className="text-sm text-red-700 leading-relaxed">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-ink text-paper py-3 text-xs uppercase tracking-[0.2em] flex justify-center gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === 'magic' ? 'Отправить ссылку' : 'Войти'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
