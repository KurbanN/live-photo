export async function applyMaxVideoConstraints(track: MediaStreamTrack): Promise<void> {
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

type VideoTrackCaps = MediaTrackCapabilities & { focusMode?: string[] };

export function tryEnableContinuousFocus(track: MediaStreamTrack): void {
  const caps = track.getCapabilities?.() as VideoTrackCaps | undefined;
  const modes = caps?.focusMode;
  if (!Array.isArray(modes)) return;
  for (const m of ['continuous', 'single-shot'] as const) {
    if (modes.includes(m)) {
      track
        .applyConstraints({ advanced: [{ focusMode: m }] } as unknown as MediaTrackConstraints)
        .catch(() => {});
      return;
    }
  }
}

export async function tryFocusAtNormalizedPoint(
  track: MediaStreamTrack,
  nx: number,
  ny: number,
): Promise<void> {
  const x = Math.max(0, Math.min(1, nx));
  const y = Math.max(0, Math.min(1, ny));
  try {
    await track.applyConstraints({
      advanced: [{ pointsOfInterest: [{ x, y }] }],
    } as unknown as MediaTrackConstraints);
  } catch {
    /* unsupported */
  }
}

export async function flipBlobHorizontally(blob: Blob): Promise<Blob> {
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
    const quality = mime === 'image/jpeg' || mime === 'image/webp' ? 1 : undefined;
    return await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сохранить снимок'))), mime, quality);
    });
  } catch {
    return blob;
  }
}

export async function captureStillFromVideo(
  video: HTMLVideoElement,
  isSelfie: boolean,
): Promise<Blob> {
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
      /* fallback */
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

export function isProbablyImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?)$/i.test(file.name?.trim() ?? '');
}
