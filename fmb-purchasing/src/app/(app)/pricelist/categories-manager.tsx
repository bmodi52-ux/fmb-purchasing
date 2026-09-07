"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  type CategoryFormState,
} from "./actions";
import { CATEGORY_LINE_GROUPS } from "@/lib/categories";

const initialState: CategoryFormState = { error: null, success: false };

/**
 * React resets the <form> element once its action resolves. Controlled text
 * inputs survive that; a controlled <select> does not — the DOM reverts to its
 * default while React state still holds the choice, and with the value prop
 * unchanged there is no re-render to correct it, so the two disagree about
 * what the next submit will send.
 *
 * Writes React's state back onto the DOM after every completed action. The
 * form element is genuinely an external system here: React mutated it outside
 * the render cycle.
 */
function useSelectResync(
  formRef: React.RefObject<HTMLFormElement | null>,
  state: CategoryFormState,
  name: string,
  value: string
) {
  useEffect(() => {
    const field = formRef.current?.elements.namedItem(name);
    if (field instanceof HTMLSelectElement) field.value = value;
  }, [formRef, state, name, value]);
}

export type ManagedCategory = {
  id: string;
  name: string;
  code: string | null;
  parentCategoryId: string | null;
  /** Items filed here, so a category that is doing work reads as such. */
  itemCount: number;
  /** Line kinds this category is offered for first — see migration 0038. */
  appliesTo: string[] | null;
};

function CodeBadge({ code }: { code: string | null }) {
  return code ? (
    <span className="rounded bg-ink/10 px-1.5 py-0.5 font-mono text-[11px] text-ink/70">{code}</span>
  ) : (
    <span
      className="rounded bg-gold/20 px-1.5 py-0.5 font-mono text-[11px] text-ink/50"
      title="No code — items here are numbered I-0000 (or inherit the parent's code)"
    >
      none
    </span>
  );
}

function CategoryRow({
  category,
  parentOptions,
  isParent,
}: {
  category: ManagedCategory;
  parentOptions: ManagedCategory[];
  isParent: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editState, editAction] = useActionState(updateCategory, initialState);
  const [deleteState, deleteAction] = useActionState(deleteCategory, initialState);

  // Controlled, because React resets an uncontrolled form once its action
  // resolves — so a rejected code threw away the name typed alongside it and
  // made the correction a retype.
  const [name, setName] = useState(category.name);
  const [code, setCode] = useState(category.code ?? "");
  const [parentId, setParentId] = useState(category.parentCategoryId ?? "");

  // Collapse once the server confirms the edit landed, so the list returns to
  // being readable rather than leaving an open form behind every save.
  //
  // Adjusted during render rather than in an effect: the trigger is a state
  // change React already knows about, not an external system, so an effect
  // would only add a second render pass after the first one painted.
  const [seenEditState, setSeenEditState] = useState(editState);
  if (seenEditState !== editState) {
    setSeenEditState(editState);
    if (editState.success) setOpen(false);
  }

  const editFormRef = useRef<HTMLFormElement>(null);
  useSelectResync(editFormRef, editState, "parent_category_id", parentId);

  /** Cancelling discards the edit, so the fields go back to what is stored. */
  function toggle() {
    if (open) {
      setName(category.name);
      setCode(category.code ?? "");
      setParentId(category.parentCategoryId ?? "");
    }
    setOpen(!open);
  }

  return (
    <li className={category.parentCategoryId ? "ml-5" : ""}>
      <div className="flex flex-wrap items-center gap-2 py-1">
        <CodeBadge code={category.code} />
        <span className="text-sm text-ink">{category.name}</span>
        {category.itemCount > 0 && (
          <span className="text-xs text-ink/40">
            {category.itemCount} item{category.itemCount === 1 ? "" : "s"}
          </span>
        )}
        <button type="button" onClick={toggle} className="text-xs text-ink/50 hover:text-ink hover:underline">
          {open ? "cancel" : "edit"}
        </button>
      </div>

      {open && (
        <div className="mb-2 ml-2 flex flex-col gap-2 border-l-2 border-ink/10 pl-3">
          <form ref={editFormRef} action={editAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="category_id" value={category.id} />
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Category name"
              className="input h-8 w-48 py-1 text-xs"
            />
            <input
              name="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="CHK"
              aria-label="Category code"
              maxLength={6}
              className="input h-8 w-20 py-1 font-mono text-xs uppercase"
            />
            <select
              name="parent_category_id"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              aria-label="Parent category"
              disabled={isParent}
              title={isParent ? "This category has subcategories, so it cannot sit under another" : undefined}
              className="input h-8 w-44 py-1 text-xs disabled:opacity-50"
            >
              <option value="">— top level —</option>
              {parentOptions
                .filter((c) => c.id !== category.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <LineGroupChecks appliesTo={category.appliesTo} />
            <SubmitButton className="rounded-md border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
              Save
            </SubmitButton>
          </form>

          <form action={deleteAction}>
            <input type="hidden" name="category_id" value={category.id} />
            <SubmitButton className="text-xs text-red-700/70 hover:text-red-700 hover:underline">
              Delete this category
            </SubmitButton>
          </form>

          {(editState.error || deleteState.error) && (
            <p className="text-xs text-red-700">{editState.error ?? deleteState.error}</p>
          )}

          {category.itemCount > 0 && (
            <p className="text-xs text-ink/50">
              Changing the code renumbers {category.itemCount} item
              {category.itemCount === 1 ? "" : "s"}. The old numbers stay searchable.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Categories had no editor at all — the list was seeded once by migration and
 * only ever read. That was survivable while the number meant nothing, but
 * 0024 made a category's code the prefix on every item number under it, so a
 * category added later without one would silently number its items I-0000.
 */
export function CategoriesManager({ categories }: { categories: ManagedCategory[] }) {
  const [addState, addAction] = useActionState(createCategory, initialState);

  // Controlled for the same reason as the edit form above: React clears an
  // uncontrolled form once its action resolves, which on a rejected code
  // meant retyping the name too. Cleared here only on success.
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [parentId, setParentId] = useState("");

  const [seenAddState, setSeenAddState] = useState(addState);
  if (seenAddState !== addState) {
    setSeenAddState(addState);
    if (addState.success) {
      setName("");
      setCode("");
      setParentId("");
    }
  }

  const addFormRef = useRef<HTMLFormElement>(null);
  useSelectResync(addFormRef, addState, "parent_category_id", parentId);

  const parentIds = new Set(
    categories.map((c) => c.parentCategoryId).filter((id): id is string => id !== null)
  );
  const topLevel = categories.filter((c) => c.parentCategoryId === null);
  const childrenOf = (id: string) => categories.filter((c) => c.parentCategoryId === id);

  return (
    <section className="rounded-lg border border-ink/10 bg-white/60 p-5 text-sm">
      <h2 className="mb-3 section-title text-ink">All categories ({categories.length})</h2>

      <ul className="flex flex-col">
        {topLevel.map((parent) => (
          <div key={parent.id}>
            <CategoryRow
              category={parent}
              parentOptions={topLevel}
              isParent={parentIds.has(parent.id)}
            />
            {childrenOf(parent.id).map((child) => (
              <CategoryRow
                key={child.id}
                category={child}
                parentOptions={topLevel}
                isParent={parentIds.has(child.id)}
              />
            ))}
          </div>
        ))}
      </ul>

      <form ref={addFormRef} action={addAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-3">
        <input
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category"
          aria-label="New category name"
          className="input h-8 w-48 py-1 text-xs"
        />
        <input
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Code"
          aria-label="New category code"
          maxLength={6}
          className="input h-8 w-20 py-1 font-mono text-xs uppercase"
        />
        <select
          name="parent_category_id"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
          aria-label="Parent category"
          className="input h-8 w-44 py-1 text-xs"
        >
          <option value="">— top level —</option>
          {topLevel.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {/* Nothing ticked means every kind, which is the right default for a
            category whose use nobody has decided yet. */}
        <LineGroupChecks appliesTo={[]} />
        <SubmitButton className="rounded-md border border-ink/15 px-2 py-1 text-xs hover:border-ink/30">
          + Add category
        </SubmitButton>
        {addState.error && <p className="w-full text-xs text-red-700">{addState.error}</p>}
      </form>
    </section>
  );
}

/**
 * Which kinds of line this category is offered for first.
 *
 * Checkboxes rather than a multi-select because there are three of them and
 * the answer is usually one. Ticking none is the same as ticking all: a
 * category in nobody's list is a category nobody can find, so the action
 * treats an empty selection as "all" rather than saving a dead end.
 */
function LineGroupChecks({ appliesTo }: { appliesTo: string[] | null }) {
  const current = appliesTo ?? [...CATEGORY_LINE_GROUPS];
  return (
    <span className="flex items-center gap-2 text-xs text-ink/60">
      <span className="text-ink/40">shows for</span>
      {CATEGORY_LINE_GROUPS.map((group) => (
        <label key={group} className="flex items-center gap-1">
          <input
            type="checkbox"
            name={`applies_${group}`}
            defaultChecked={current.includes(group)}
            className="h-3 w-3"
          />
          {LINE_GROUP_LABELS[group]}
        </label>
      ))}
    </span>
  );
}

const LINE_GROUP_LABELS: Record<string, string> = {
  goods: "goods",
  service: "services",
  charge: "charges",
};
