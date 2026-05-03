import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  FileImage,
  Grid3x3,
  ImagePlus,
  Download,
  Loader2,
  LogOut,
  RefreshCw,
  Send,
  SwitchCamera,
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

/** Фон экрана входа: `public/login-bg.jpg` (копия пригласительного кадра). Учитывает `base` Vite (GitHub Pages: `/repo/`). */
const LOGIN_BG_URL = `${import.meta.env.BASE_URL}login-bg.jpg`;

/** Поднять разрешение видеопотока до максимума, который отдаёт камера (до кадра с canvas). */
async function applyMaxVideoConstraints(track: MediaStreamTrack): Promise<void> {
  const caps = track.getCapabilities?.();
  if (!caps?.width || !caps.height) return;
  const wMax = typeof caps.width.max === 'number' ? caps.width.max : undefined;
  const hMax = typeof caps.height.max === 'number' ? caps.height.max : undefined;
  if (!wMax || !hMax) return;
  await track
    .applyConstraints({
      width: { ideal: Math.min(wMax, 8192) },
      height: { ideal: Math.min(hMax, 8192) },
    })
    .catch(() => {});
}

type VideoTrackCaps = MediaTrackCapabilities & {
  focusMode?: string[];
};

/** Непрерывный или одиночный автофокус, если драйвер камеры это отдаёт. */
function tryEnableContinuousFocus(track: MediaStreamTrack): void {
  const caps = track.getCapabilities?.() as VideoTrackCaps | undefined;
  const modes = caps?.focusMode;
  if (!Array.isArray(modes)) return;
  const prefer: Array<'continuous' | 'single-shot'> = ['continuous', 'single-shot'];
  for (const m of prefer) {
    if (modes.includes(m)) {
      track
        .applyConstraints({ advanced: [{ focusMode: m }] } as unknown as MediaTrackConstraints)
        .catch(() => {});
      return;
    }
  }
}

/** Точка фокуса (0…1) в координатах кадра; на части Android срабатывает `pointsOfInterest`. */
async function tryFocusAtNormalizedPoint(track: MediaStreamTrack, nx: number, ny: number): Promise<void> {
  const x = Math.max(0, Math.min(1, nx));
  const y = Math.max(0, Math.min(1, ny));
  try {
    await track.applyConstraints({
      advanced: [{ pointsOfInterest: [{ x, y }] }],
    } as unknown as MediaTrackConstraints);
  } catch {
    /* не поддерживается */
  }
  const caps = track.getCapabilities?.() as VideoTrackCaps | undefined;
  const modes = caps?.focusMode;
  if (Array.isArray(modes) && modes.includes('single-shot')) {
    await track
      .applyConstraints({ advanced: [{ focusMode: 'single-shot' }] } as unknown as MediaTrackConstraints)
      .catch(() => {});
  }
}

/** Селфи с фронтальной камеры часто отдаются «как в зеркале» — переворачиваем файл, чтобы в ленте было без зеркала. */
async function flipBlobHorizontally(blob: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return blob;
    }
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const mime =
      blob.type === 'image/png' ? 'image/png' : blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    /** Максимальное качество при повторном кодировании (селфи после отражения). */
    const quality = mime === 'image/jpeg' || mime === 'image/webp' ? 1 : undefined;
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сохранить снимок'))), mime, quality);
    });
  } catch {
    return blob;
  }
}

/**
 * Полноразмерный кадр с камеры, если браузер умеет `ImageCapture.takePhoto()`;
 * иначе — JPEG с текущего превью (размер = размеру потока после constraints).
 */
async function captureStillFromVideo(video: HTMLVideoElement, isSelfie: boolean): Promise<Blob> {
  const src = video.srcObject;
  if (!(src instanceof MediaStream)) throw new Error('Нет камеры');

  const track = src.getVideoTracks()[0];
  if (!track) throw new Error('Нет видеодорожки');

  let blob: Blob | null = null;

  const ImageCaptureCtor = (
    globalThis as typeof globalThis & {
      ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> };
    }
  ).ImageCapture;
  if (ImageCaptureCtor) {
    try {
      const ic = new ImageCaptureCtor(track);
      const b = await ic.takePhoto();
      if (b.size > 0) blob = b;
    } catch {
      /* ниже — кадр с video */
    }
  }

  if (!blob) {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Камера ещё не готова');

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Нет canvas');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(video, 0, 0);

    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Снимок не создан'))),
        'image/jpeg',
        1,
      );
    });
  }

  if (isSelfie) return flipBlobHorizontally(blob);
  return blob;
}

type Tab = 'shoot' | 'feed';

/** Для режима «как документ»: тип иногда пустой (iOS), тогда смотрим расширение. */
function isProbablyImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const name = file.name?.trim() ?? '';
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(name);
}

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
  const cameraGeneration = useRef(0);
  const cameraOpeningRef = useRef(false);
  const facingRef = useRef<'environment' | 'user'>('environment');
  const pendingBlobRef = useRef<Blob | null>(null);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [cameraOpening, setCameraOpening] = useState(false);

  const discardPending = useCallback(() => {
    pendingBlobRef.current = null;
    setPendingPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

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

  const stopCamera = useCallback(() => {
    cameraGeneration.current += 1;
    cameraOpeningRef.current = false;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    const el = videoRef.current;
    if (el) el.srcObject = null;
    setCameraReady(false);
    setCameraBlocked(false);
    setCameraOpening(false);
    discardPending();
  }, [discardPending]);

  /** Камера только по явному нажатию (удобнее разрешения на телефоне). */
  const openCamera = useCallback(async () => {
    if (!pin || streamRef.current || cameraOpeningRef.current) return;
    const gen = cameraGeneration.current;
    cameraOpeningRef.current = true;
    setShootError('');
    setCameraBlocked(false);
    setCameraReady(false);
    setCameraOpening(true);
    try {
      const facing = facingRef.current;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing } },
        });
      }
      if (gen !== cameraGeneration.current) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      const vtrack = stream.getVideoTracks()[0];
      if (vtrack) await applyMaxVideoConstraints(vtrack);
      if (vtrack) tryEnableContinuousFocus(vtrack);
      if (gen !== cameraGeneration.current) {
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
    } finally {
      cameraOpeningRef.current = false;
      if (gen === cameraGeneration.current) setCameraOpening(false);
    }
  }, [pin]);

  const flipCamera = useCallback(() => {
    if (pendingPreviewUrl) return;
    const next = facingRef.current === 'environment' ? 'user' : 'environment';
    facingRef.current = next;
    setCameraFacing(next);
    if (!streamRef.current && !cameraOpeningRef.current) return;
    stopCamera();
    queueMicrotask(() => {
      void openCamera();
    });
  }, [pendingPreviewUrl, stopCamera, openCamera]);

  const handleVideoTapFocus = useCallback(
    (e: React.PointerEvent<HTMLVideoElement>) => {
      if (pendingPreviewUrl || !streamRef.current) return;
      const track = streamRef.current.getVideoTracks()[0];
      if (!track?.readyState || track.readyState !== 'live') return;
      const el = videoRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      let nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      if (cameraFacing === 'user') nx = 1 - nx;
      void tryFocusAtNormalizedPoint(track, nx, ny);
    },
    [pendingPreviewUrl, cameraFacing],
  );

  useEffect(() => {
    if (tab !== 'shoot' || !pin) stopCamera();
  }, [tab, pin, stopCamera]);

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
    discardPending();
    clearStoredPin();
    setPin(null);
    setPhotos([]);
    setLightbox(null);
  };

  const takePhoto = async () => {
    if (!videoRef.current || pendingPreviewUrl) return;
    setShootError('');
    try {
      const blob = await captureStillFromVideo(videoRef.current, cameraFacing === 'user');
      pendingBlobRef.current = blob;
      setPendingPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setShootError(e instanceof Error ? e.message : 'Не удалось снять');
    }
  };

  const retakePhoto = () => {
    discardPending();
  };

  const confirmPendingUpload = async () => {
    const blob = pendingBlobRef.current;
    if (!pin || !blob) return;
    setShootError('');
    setUploading(true);
    try {
      await uploadPhoto(pin, blob, author.trim() || undefined);
      discardPending();
      setAuthor('');
      await loadFeed();
      setTab('feed');
    } catch (e) {
      setShootError(e instanceof Error ? e.message : 'Не удалось отправить');
    } finally {
      setUploading(false);
    }
  };

  const triggerImageUpload = (opts: { accept: string; validateAsImage: boolean }) => {
    if (!pin) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.accept;
    // Без `capture`: иначе часть браузеров даёт урезанный снимок вместо файла из галереи в полном размере.
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (opts.validateAsImage && !isProbablyImageFile(file)) {
        setShootError('Нужен файл изображения (например .jpg, .png, .heic).');
        return;
      }
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

  const pickFromGallery = () => triggerImageUpload({ accept: 'image/*', validateAsImage: false });

  /** Как «документ» в мессенджере: любой файл из проводника — оригинальные байты без съёмки через камеру в браузере. */
  const pickImageAsDocument = () => triggerImageUpload({ accept: '*/*', validateAsImage: true });

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
                className={`absolute inset-0 z-[1] h-full w-full object-cover transition-opacity duration-200 ${
                  cameraReady && !pendingPreviewUrl ? 'cursor-pointer opacity-100 touch-manipulation' : 'opacity-0'
                } ${cameraFacing === 'user' ? '[transform:scaleX(-1)]' : ''}`}
                playsInline
                muted
                onPointerDown={cameraReady && !pendingPreviewUrl ? handleVideoTapFocus : undefined}
              />
              {!cameraReady && !pendingPreviewUrl && (
                <div className="absolute inset-0 flex flex-col">
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${LOGIN_BG_URL})` }}
                    aria-hidden
                  />
                  <div
                    className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/65"
                    aria-hidden
                  />
                  <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 p-6 text-center">
                    {cameraOpening ? (
                      <Loader2 className="h-10 w-10 animate-spin text-paper" aria-label="Открываем камеру" />
                    ) : cameraBlocked ? (
                      <>
                        <p className="max-w-xs text-sm leading-relaxed text-paper">
                          Не удалось открыть камеру. Разрешите доступ в настройках браузера или загрузите фото из
                          галереи.
                        </p>
                        <button
                          type="button"
                          onClick={openCamera}
                          className="bg-ink px-6 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-paper"
                        >
                          Попробовать снова
                        </button>
                      </>
                    ) : (
                      <>
                        <Camera className="h-12 w-12 text-paper/90" aria-hidden />
                        <button
                          type="button"
                          onClick={openCamera}
                          className="bg-ink px-8 py-4 text-xs font-semibold uppercase tracking-[0.25em] text-paper shadow-lg"
                        >
                          Открыть камеру
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {pendingPreviewUrl && (
                <div className="absolute inset-0 z-30 flex flex-col bg-black">
                  <img
                    src={pendingPreviewUrl}
                    alt="Предпросмотр снимка"
                    className="min-h-0 w-full flex-1 object-contain"
                  />
                  <div className="flex shrink-0 gap-3 border-t border-white/10 bg-black/90 p-4">
                    <button
                      type="button"
                      onClick={retakePhoto}
                      disabled={uploading}
                      className="flex-1 border border-paper/50 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-paper disabled:opacity-50"
                    >
                      Переснять
                    </button>
                    <button
                      type="button"
                      onClick={() => void confirmPendingUpload()}
                      disabled={uploading}
                      className="flex flex-1 items-center justify-center gap-2 bg-paper py-3 text-xs font-semibold uppercase tracking-[0.18em] text-ink disabled:opacity-50"
                    >
                      {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                      В ленту
                    </button>
                  </div>
                </div>
              )}
              {cameraReady && !pendingPreviewUrl && (
                <>
                  <div
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-black/80 to-transparent"
                    aria-hidden
                  />
                  <button
                    type="button"
                    onClick={flipCamera}
                    disabled={cameraOpening}
                    className="absolute bottom-5 left-4 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-paper/50 bg-black/45 text-paper backdrop-blur-sm disabled:opacity-40"
                    aria-label={
                      cameraFacing === 'environment' ? 'Переключить на фронтальную камеру' : 'Переключить на основную камеру'
                    }
                  >
                    <SwitchCamera className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void takePhoto()}
                    disabled={cameraOpening}
                    className="absolute bottom-5 left-1/2 z-20 flex h-[4.5rem] w-[4.5rem] -translate-x-1/2 items-center justify-center rounded-full border-[4px] border-paper bg-transparent shadow-lg disabled:opacity-40"
                    aria-label="Сфотографировать"
                  >
                    <span className="block h-[3.25rem] w-[3.25rem] rounded-full bg-paper" />
                  </button>
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="absolute bottom-5 right-4 z-20 border border-paper/40 bg-black/50 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-paper backdrop-blur-sm"
                  >
                    Выключить
                  </button>
                </>
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

            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={uploading || pendingPreviewUrl !== null}
                onClick={pickFromGallery}
                className="flex w-full items-center justify-center gap-2 border border-ink py-4 text-xs font-semibold uppercase tracking-[0.2em] text-ink disabled:opacity-50"
              >
                <ImagePlus className="h-5 w-5" />
                Из галереи
              </button>
              <button
                type="button"
                disabled={uploading || pendingPreviewUrl !== null}
                onClick={pickImageAsDocument}
                className="flex w-full flex-col items-center justify-center gap-1 border border-ink bg-white/80 py-4 text-ink disabled:opacity-50"
              >
                <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em]">
                  <FileImage className="h-5 w-5 shrink-0" />
                  Как файл (лучшее качество)
                </span>
                <span className="max-w-[280px] px-2 text-center text-[10px] font-normal normal-case leading-snug tracking-normal text-muted">
                  Оригинал с телефона или из «Файлов», без пересжатия в браузере — как «отправить документом».
                </span>
              </button>
            </div>
            <p className="text-[11px] text-muted leading-relaxed text-center">
              С камеры: круглая кнопка, затем «В ленту» или «Переснять». Для максимального качества — «Как файл».
              Удалить снимок может любой с кодом.
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
