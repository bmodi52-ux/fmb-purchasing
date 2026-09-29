"use client";

import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import type { WidgetData } from "@/lib/reporting/widget-data";
import type { WidgetSpec } from "@/lib/reporting/widgets";
import { removeDashboardWidget, reorderDashboardWidgets } from "./reports/dashboard-widgets-actions";
import { WidgetBody } from "./widget-body";
import { AddWidgetDialog } from "./add-widget-dialog";

export type SavedWidget = {
  id: string;
  title: string;
  /** Which report, which part of it, and its settings (lib/reporting/widgets). */
  spec: WidgetSpec;
  /** Null when the report no longer has that part to show. */
  data: WidgetData | null;
  /** The period and filters in words, resolved on the server against today. */
  summary: string;
  /** The report page it is part of, open on the same settings. */
  href: string;
};

export function HomeDashboard({
  widgets,
  today,
  earliest,
}: {
  widgets: SavedWidget[];
  today: string;
  earliest: string | null;
}) {
  const [order, setOrder] = useState(widgets.map((w) => w.id));
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SavedWidget | null>(null);

  // Adding, removing or editing a widget revalidates the route and the
  // server sends a fresh `widgets` prop down — but `order` was only seeded
  // from it once, on mount, so without this it would keep showing whatever
  // was pinned at first load. Resynced during render (not in an effect,
  // which would cost an extra render pass) whenever the set the server sent
  // actually changes; a same-set reorder from dragging never touches this.
  const idsKey = widgets.map((w) => w.id).join(",");
  const [seenIdsKey, setSeenIdsKey] = useState(idsKey);
  if (idsKey !== seenIdsKey) {
    setSeenIdsKey(idsKey);
    setOrder(widgets.map((w) => w.id));
  }

  const byId = new Map(widgets.map((w) => [w.id, w]));
  const ordered = order.map((id) => byId.get(id)).filter((w): w is SavedWidget => !!w && !removedIds.has(w.id));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Computed from the current `order` directly rather than inside the
    // setOrder updater — a server action dispatches a router transition,
    // and doing that from within a state-updater callback runs it as if it
    // were render-phase code, which React (rightly) rejects.
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    reorderDashboardWidgets(next.filter((id) => !removedIds.has(id)));
  }

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(widget: SavedWidget) {
    setEditing(widget);
    setDialogOpen(true);
  }

  async function handleRemove(id: string) {
    setRemovedIds((prev) => new Set(prev).add(id));
    await removeDashboardWidget(id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title text-ink">Your dashboard</h2>
        <button
          type="button"
          onClick={openAdd}
          className="rounded-full border border-ink/15 px-3.5 py-1.5 text-sm text-ink/65 transition-colors hover:border-ink/30 hover:text-ink"
        >
          + Add widget
        </button>
      </div>

      {ordered.length === 0 ? (
        <p className="card px-4 py-8 text-center text-sm text-ink/55">
          Nothing pinned yet. Add a chart or table to build your own view of Reports.
        </p>
      ) : (
        <DndContext
          id="dashboard-widgets"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={ordered.map((w) => w.id)} strategy={verticalListSortingStrategy}>
            <div className="grid gap-4 md:grid-cols-2">
              {ordered.map((w) => (
                <SortableWidgetCard
                  key={w.id}
                  widget={w}
                  onEdit={() => openEdit(w)}
                  onRemove={() => handleRemove(w.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {dialogOpen && (
        <AddWidgetDialog
          editing={editing}
          today={today}
          earliest={earliest}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  );
}

function SortableWidgetCard({
  widget,
  onEdit,
  onRemove,
}: {
  widget: SavedWidget;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
  });
  const [removing, setRemoving] = useState(false);

  async function handleRemoveClick() {
    setRemoving(true);
    onRemove();
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className="card p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="mt-0.5 shrink-0 cursor-grab touch-none text-ink/30 hover:text-ink/60 active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            ⠿
          </button>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-medium text-ink">{widget.title}</h3>
            <p className="text-xs text-ink/45">{widget.summary}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs">
          <Link
            href={widget.href}
            aria-label={`Open ${widget.title} in its report`}
            className="text-ink/50 underline hover:text-ink"
          >
            Open
          </Link>
          <button
            type="button"
            onClick={onEdit}
            // Announced with the widget it belongs to. Three cards in a row
            // otherwise offer three identical "Edit" controls.
            aria-label={`Edit ${widget.title}`}
            className="text-ink/50 underline hover:text-ink"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={handleRemoveClick}
            disabled={removing}
            aria-label={`Remove ${widget.title}`}
            className="text-ink/50 underline hover:text-danger disabled:opacity-50"
          >
            {removing ? "…" : "Remove"}
          </button>
        </div>
      </div>
      {widget.data ? (
        <WidgetBody data={widget.data} />
      ) : (
        <p className="text-sm text-ink/50">This widget&rsquo;s report no longer shows that. Edit it to choose again.</p>
      )}
    </div>
  );
}
