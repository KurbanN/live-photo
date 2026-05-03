import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Grid3x3,
  ImagePlus,
  Download,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  ApiRequestError,
  clearStoredPin,
  deletePhoto,
  downloadPhotoFile,
  fetchPhotos,
  getStoredPin,
  setStoredPin,
  uploadPhoto,
  type PhotoEntry,
} from '@/lib/api';

/** Фон экрана входа: `public/login-bg.jpg` (копия пригласительного кадра). */
const LOGIN_BG_URL = '/login-bg.jpg';

type Tab = 'shoot' | 'feed';

export default function App() {
  const [pin, setPin] = useState<string | null>(() => getStoredPin());
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);

  const [tab, setTab] = useState<Tab>('shoot');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [feedError, setFeedError] = useState('');
  const [shootError, setShootError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [author, setAuthor] = useState('');
  const [lightbox, setLightbox] = useState<PhotoEntry | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);

  const loadFeed = useCallback(async () => {
    if (!pin) return;
    try {
      setFeedError('');
      const list = await fetchPhotos(pin);
      setPhotos(list);
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : 'Ошибка ленты');
    }
  }, [pin]);

  useEffect(() => {
    if (!pin) return;
    loadFeed();
    const t = window.setInterval(loadFeed, 4500);
    return () => window.clearInterval(t);
  }, [pin, loadFeed]);

  useEffect(() => {
    if (tab !== 'shoot' || !pin) return;

    let cancelled = false;
    (async () => {
      setCameraBlocked(false);
      setCameraReady(false);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          await el.play().catch(() => {});
          setCameraReady(true);
        }
      } catch {
        setCameraBlocked(true);
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
      const el = videoRef.current;
      if (el) el.srcObject = null;
      setCameraReady(false);
    };
  }, [tab, pin]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    const p = pinInput.trim();
    if (!p) {
      setPinError('Введите код со столика');
      return;
    }
    setPinLoading(true);
    try {
      await fetchPhotos(p);
      setStoredPin(p);
      setPin(p);
      setPinInput('');
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        setPinError('Код не подходит. Спросите у организаторов.');
      } else if (e instanceof Error) {
        setPinError(e.message);
      } else {
        setPinError('Ошибка входа. Проверьте, что запущен сервер и настроен Supabase.');
      }
    } finally {
      setPinLoading(false);
    }
  };

  const logout = () => {
    clearStoredPin();
    setPin(null);
    setPhotos([]);
    setLightbox(null);
  };

  const captureAndUpload = async () => {
    if (!pin || !videoRef.current) return;
    const video = videoRef.current;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) {
      setShootError('Камера ещё не готова');
      return;
    }
    setShootError('');
    setUploading(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Нет canvas');
      ctx.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Снимок не создан'))),
          'image/jpeg',
          1,
        );
      });
      await uploadPhoto(pin, blob, author || undefined);
      setAuthor('');
      await loadFeed();
      setTab('feed');
    } catch (e) {
      setShootError(e instanceof Error ? e.message : 'Не удалось отправить');
    } finally {
      setUploading(false);
    }
  };

  const pickFromGallery = async () => {
    if (!pin) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setShootError('');
      setUploading(true);
      try {
        await uploadPhoto(pin, file, author || undefined);
        setAuthor('');
        await loadFeed();
        setTab('feed');
      } catch (e) {
        setShootError(e instanceof Error ? e.message : 'Ошибка загрузки');
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const handleDelete = async (id: string) => {
    if (!pin || !confirm('Удалить это фото из общей ленты?')) return;
    try {
      await deletePhoto(pin, id);
      setLightbox(null);
      await loadFeed();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось удалить');
    }
  };

  const handleDownload = async (p: PhotoEntry) => {
    if (!pin) return;
    setDownloadBusy(true);
    try {
      const blob = await downloadPhotoFile(pin, p.id);
      const pathExt = new URL(p.url, window.location.origin).pathname;
      const ext = pathExt.includes('.') ? pathExt.slice(pathExt.lastIndexOf('.')) : '.jpg';
      const name = `kurban-fatima-${p.id.slice(0, 12)}${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Не удалось скачать');
    } finally {
      setDownloadBusy(false);
    }
  };

  if (!pin) {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-16">
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${LOGIN_BG_URL})` }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-paper/88 via-paper/78 to-paper/90 backdrop-blur-[2px]"
          aria-hidden
        />
        <div className="relative z-10 flex w-full max-w-xs flex-col items-center">
          <p className="mb-2 text-center font-serif text-3xl text-ink md:text-4xl">Живая лента</p>
          <p className="mb-10 max-w-sm text-center text-sm leading-relaxed text-muted">
            Kurban & Fatima · введите код с карточки на столе, затем снимайте и смотрите фото гостей.
          </p>
          <form onSubmit={handlePinSubmit} className="w-full space-y-4">
            <label className="block text-[11px] uppercase tracking-[0.2em] text-muted">
              Код мероприятия
            </label>
            <input
              type="password"
              autoComplete="one-time-code"
              inputMode="numeric"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="••••"
              className="w-full border border-line/90 bg-white/95 px-4 py-3 text-center text-lg tracking-[0.3em] shadow-sm outline-none backdrop-blur-sm focus:border-ink"
            />
            {pinError && <p className="text-center text-sm text-red-700">{pinError}</p>}
            <button
              type="submit"
              disabled={pinLoading}
              className="flex w-full items-center justify-center gap-2 bg-ink py-3 text-xs font-semibold uppercase tracking-[0.25em] text-paper disabled:opacity-60"
            >
              {pinLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Войти
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col bg-paper pb-[max(1rem,env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-sm px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="font-serif text-lg text-ink leading-tight">Живая лента</p>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted">Kurban & Fatima</p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="p-2 text-muted hover:text-ink border border-transparent hover:border-line"
          aria-label="Выйти"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      <nav className="flex border-b border-line">
        <button
          type="button"
          onClick={() => setTab('shoot')}
          className={`flex-1 py-3 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] ${
            tab === 'shoot' ? 'bg-ink text-paper' : 'text-muted'
          }`}
        >
          <Camera className="w-4 h-4" />
          Снять
        </button>
        <button
          type="button"
          onClick={() => setTab('feed')}
          className={`flex-1 py-3 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] ${
            tab === 'feed' ? 'bg-ink text-paper' : 'text-muted'
          }`}
        >
          <Grid3x3 className="w-4 h-4" />
          Лента
        </button>
      </nav>

      <main className="flex-1">
        {tab === 'shoot' && (
          <div className="p-4 max-w-lg mx-auto space-y-4">
            <div className="relative aspect-[3/4] bg-black overflow-hidden border border-line">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />
              {!cameraReady && !cameraBlocked && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-paper text-sm">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              )}
              {cameraBlocked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-paper p-6 text-center text-sm leading-relaxed">
                  Не удалось открыть камеру. Разрешите доступ в настройках браузера или загрузите фото из
                  галереи.
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-[0.15em] text-muted">Подпись (необязательно)</label>
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Ваше имя"
                className="w-full border border-line px-3 py-2 text-base outline-none focus:border-ink bg-white"
                maxLength={80}
              />
            </div>

            {shootError && <p className="text-sm text-red-700">{shootError}</p>}

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled={uploading || cameraBlocked || !cameraReady}
                onClick={captureAndUpload}
                className="flex-1 bg-ink text-paper py-4 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                Отправить в ленту
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={pickFromGallery}
                className="flex-1 border border-ink py-4 flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] font-semibold text-ink disabled:opacity-50"
              >
                <ImagePlus className="w-5 h-5" />
                Из галереи
              </button>
            </div>
            <p className="text-[11px] text-muted leading-relaxed text-center">
              После нажатия «Отправить» фото появится у всех на вкладке «Лента». Удалить снимок может любой, у кого
              есть код (на случай случайного кадра).
            </p>
          </div>
        )}

        {tab === 'feed' && (
          <div className="p-4 max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted">{photos.length} фото</p>
              <button
                type="button"
                onClick={() => loadFeed()}
                className="flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-ink border border-line px-3 py-2 hover:bg-white"
              >
                <RefreshCw className="w-4 h-4" />
                Обновить
              </button>
            </div>
            {feedError && <p className="text-sm text-red-700 mb-3">{feedError}</p>}
            {photos.length === 0 && !feedError && (
              <p className="text-center text-muted py-16 text-sm">Пока нет снимков — сделайте первый.</p>
            )}
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {photos.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setLightbox(p)}
                    className="block w-full aspect-square overflow-hidden border border-line bg-black/5"
                  >
                    <img
                      src={p.url}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                  {p.author && (
                    <p className="text-[10px] text-muted mt-1 truncate px-0.5">{p.author}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/92 flex flex-col p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <div className="flex justify-end mb-2">
            <button
              type="button"
              className="p-2 text-paper/90"
              onClick={() => setLightbox(null)}
              aria-label="Закрыть"
            >
              <X className="w-7 h-7" />
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center min-h-0" onClick={(e) => e.stopPropagation()}>
            <img
              src={lightbox.url}
              alt=""
              className="max-w-full max-h-[75dvh] object-contain"
            />
          </div>
          <div className="mt-4 text-center text-paper/80 text-sm space-y-1">
            {lightbox.author && <p>{lightbox.author}</p>}
            <p className="text-xs text-paper/50">
              {new Date(lightbox.createdAt).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                disabled={downloadBusy}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownload(lightbox);
                }}
                className="inline-flex items-center gap-2 text-paper text-xs uppercase tracking-[0.15em] disabled:opacity-50"
              >
                {downloadBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Скачать
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(lightbox.id);
                }}
                className="inline-flex items-center gap-2 text-red-300 text-xs uppercase tracking-[0.15em]"
              >
                <Trash2 className="w-4 h-4" />
                Удалить из ленты
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
