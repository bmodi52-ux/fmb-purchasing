import { addUnit } from "./actions";

export function UnitsManager({ units }: { units: { id: string; label: string }[] }) {
  return (
    <details className="rounded-lg border border-ink/10 bg-white/40 p-3 text-sm">
      <summary className="cursor-pointer text-ink/60">Units ({units.length})</summary>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {units.map((u) => (
          <span key={u.id} className="rounded-full bg-ink/5 px-2 py-1 text-xs text-ink/70">
            {u.label}
          </span>
        ))}
        <form action={addUnit} className="flex items-center gap-2">
          <input
            name="code"
            placeholder="New unit (e.g. box)"
            className="input h-8 py-1 text-xs"
          />
          <button type="submit" className="rounded-md border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
            + Add unit
          </button>
        </form>
      </div>
    </details>
  );
}
