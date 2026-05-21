import { Link } from 'react-router-dom';

export default function Landing() {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="border-b border-line px-6 py-4 flex justify-between items-center">
        <span className="font-serif text-xl text-ink">Guestroll</span>
        <Link to="/dashboard/login" className="text-xs uppercase tracking-[0.2em] text-muted hover:text-ink">
          Кабинет
        </Link>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center max-w-lg mx-auto">
        <h1 className="font-serif text-4xl md:text-5xl text-ink mb-4">Живая лента для мероприятий</h1>
        <p className="text-muted text-sm leading-relaxed mb-10">
          QR на столах — гости снимают с телефона — все фото в одной галерее в реальном времени. Свадьбы,
          дни рождения, корпоративы.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <Link
            to="/dashboard/login"
            className="flex-1 bg-ink text-paper py-3 text-xs font-semibold uppercase tracking-[0.2em]"
          >
            Создать мероприятие
          </Link>
          <Link
            to="/e/main"
            className="flex-1 border border-ink py-3 text-xs font-semibold uppercase tracking-[0.2em] text-ink"
          >
            Демо-лента
          </Link>
        </div>
        <section className="mt-16 grid gap-6 text-left w-full text-sm text-muted">
          <div>
            <p className="text-ink font-medium mb-1">Для организаторов</p>
            <p>Уникальная ссылка, PIN для гостей, QR для печати, модерация, архив ZIP.</p>
          </div>
          <div>
            <p className="text-ink font-medium mb-1">Тарифы</p>
            <p>Lite от 1 990 ₽ · Party 4 990 ₽ · Premium 9 990 ₽ за мероприятие.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
