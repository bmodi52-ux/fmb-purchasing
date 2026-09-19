"use client";

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type MenuColumn = { key: string; label: string };

/**
 * Which columns a table shows, and in what order (#56).
 *
 * Rows drag to reorder, and have up and down arrows as well, because dragging
 * inside a small scrolling popover on a phone is the kind of thing that
 * scrolls the page instead.
 */
export function ColumnsMenu({
  columns,
  visible,
  onToggle,
  onMove,
  onReset,
}: {
  /** Every column, in the table's current order. */
  columns: MenuColumn[];
  visible: Set<string>;
  onToggle: (key: string) => void;
  onMove: (key: string, toIndex: number) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    onMove(String(active.id), columns.findIndex((c) => c.key === over.id));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md border border-ink/15 px-3 py-1 text-xs text-ink/70 hover:border-ink/30"
      >
        Columns
      </button>
      {open && (
        <div className="absolute top-full right-0 z-10 mt-1 flex max-h-80 w-64 flex-col rounded-md border border-ink/15 bg-white text-sm shadow-md">
          <p className="border-b border-ink/10 px-3 py-2 text-xs text-ink/50">Tick to show. Drag or use the arrows to reorder.</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={columns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col overflow-y-auto p-1">
                {columns.map((c, index) => (
                  <ColumnRow
                    key={c.key}
                    column={c}
                    checked={visible.has(c.key)}
                    first={index === 0}
                    last={index === columns.length - 1}
                    onToggle={() => onToggle(c.key)}
                    onUp={() => onMove(c.key, index - 1)}
                    onDown={() => onMove(c.key, index + 1)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
          <div className="border-t border-ink/10 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onReset();
                setOpen(false);
              }}
              className="text-xs text-ink/60 underline hover:text-ink"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ColumnRow({
  column,
  checked,
  first,
  last,
  onToggle,
  onUp,
  onDown,
}: {
  column: MenuColumn;
  checked: boolean;
  first: boolean;
  last: boolean;
  onToggle: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key });
  const label = column.label || "(no heading)";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-1 rounded px-1 py-0.5 ${isDragging ? "relative z-10 bg-cream shadow" : "hover:bg-ink/[0.03]"}`}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`Drag to move ${label}`}
        className="cursor-grab touch-none px-1 text-ink/30 select-none hover:text-ink/60"
      >
        ⠿
      </span>
      <label className="flex min-w-0 flex-1 items-center gap-2 py-1">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="truncate">{label}</span>
      </label>
      <button
        type="button"
        onClick={onUp}
        disabled={first}
        aria-label={`Move ${label} up`}
        className="rounded px-1.5 py-0.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink disabled:opacity-25"
      >
        ▲
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={last}
        aria-label={`Move ${label} down`}
        className="rounded px-1.5 py-0.5 text-xs text-ink/50 hover:bg-ink/5 hover:text-ink disabled:opacity-25"
      >
        ▼
      </button>
    </li>
  );
}
