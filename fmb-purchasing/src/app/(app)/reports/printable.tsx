"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

export type PrintableEntry = { id: string; label: string; ref: RefObject<HTMLDivElement | null> };

type Registry = {
  register: (entry: PrintableEntry) => void;
  unregister: (id: string) => void;
  entries: PrintableEntry[];
};

const PrintRegistryContext = createContext<Registry | null>(null);

/**
 * Tracks whichever chart/table blocks are actually rendered right now, so
 * the print picker always matches the page — a filter that removes a
 * vendor's unit-cost block, for instance, removes it from the picker too
 * without either side needing to know about the other.
 */
export function PrintRegistryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<PrintableEntry[]>([]);

  function register(entry: PrintableEntry) {
    setEntries((prev) => (prev.some((e) => e.id === entry.id) ? prev : [...prev, entry]));
  }
  function unregister(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const value = useMemo(() => ({ register, unregister, entries }), [entries]);

  return <PrintRegistryContext.Provider value={value}>{children}</PrintRegistryContext.Provider>;
}

export function usePrintRegistry(): Registry {
  const ctx = useContext(PrintRegistryContext);
  if (!ctx) throw new Error("usePrintRegistry must be used within a PrintRegistryProvider");
  return ctx;
}

/** Marks one chart/table block as a selectable unit in the print picker. */
export function Printable({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { register, unregister } = usePrintRegistry();

  useEffect(() => {
    register({ id, label, ref });
    return () => unregister(id);
    // register/unregister close over stable state setters; only id/label
    // identify a genuinely different entry worth re-registering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, label]);

  return <div ref={ref}>{children}</div>;
}
