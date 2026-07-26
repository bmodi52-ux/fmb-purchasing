export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-serif text-3xl font-semibold text-ink">{title}</h1>
      <p className="max-w-xl text-ink/70">
        {note ?? "This page is scaffolded and permission-gated, but the feature isn't built yet."}
      </p>
    </div>
  );
}
