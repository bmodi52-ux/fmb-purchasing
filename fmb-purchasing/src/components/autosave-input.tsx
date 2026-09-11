"use client";

import { useRef } from "react";

/**
 * A field that saves its form when you leave it, if it changed — for columns
 * of values typed one after another, where a save button per row is how a row
 * gets forgotten. Enter saves too. (The same interaction as a budget figure.)
 */
export function AutosaveInput({
  defaultValue,
  ...rest
}: Omit<React.ComponentProps<"input">, "defaultValue" | "onBlur" | "onKeyDown"> & { defaultValue: string }) {
  const lastSaved = useRef(defaultValue);

  function commit(el: HTMLInputElement) {
    if (el.value === lastSaved.current) return;
    lastSaved.current = el.value;
    el.form?.requestSubmit();
  }

  return (
    <input
      {...rest}
      defaultValue={defaultValue}
      onBlur={(e) => commit(e.currentTarget)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        commit(e.currentTarget);
      }}
    />
  );
}
