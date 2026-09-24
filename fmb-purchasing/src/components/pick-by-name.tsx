"use client";

import { useId, useState } from "react";

/**
 * A dropdown you can type into (#24).
 *
 * A plain select of eighty-odd pricelist items is a long scroll to find
 * "Roghni Naan". This is a text field that suggests as you type, and posts
 * the chosen record's id under `name` exactly as the select it replaces did,
 * so the server actions behind it don't change. Text that matches nothing is
 * refused by the browser's own validation rather than posted as a blank.
 */
export function PickByName({
  name,
  options,
  placeholder,
  required,
  className = "input",
}: {
  name: string;
  options: { id: string; name: string }[];
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  const listId = useId();
  const [id, setId] = useState("");

  return (
    <>
      <input
        list={listId}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className={className}
        onChange={(e) => {
          const typed = e.target.value.trim().toLowerCase();
          const match = options.find((o) => o.name.toLowerCase() === typed);
          setId(match?.id ?? "");
          e.target.setCustomValidity(match || typed === "" ? "" : "Pick one from the list");
        }}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.id} value={o.name} />
        ))}
      </datalist>
      <input type="hidden" name={name} value={id} />
    </>
  );
}
