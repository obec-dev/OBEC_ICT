"use client";

import { useMemo, useState } from "react";
import { inputClass } from "@/lib/styles";

export type ComboboxOption = { value: string; label: string };

type ComboboxProps = {
  label?: string;
  value: string;
  options: string[] | ComboboxOption[];
  placeholder?: string;
  allLabel?: string;
  onChange: (value: string) => void;
  onOpen?: () => void;
};

function normalizeOptions(options: string[] | ComboboxOption[]): ComboboxOption[] {
  return options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option
  );
}

export function Combobox({
  label,
  value,
  options,
  placeholder,
  allLabel = "ทั้งหมด",
  onChange,
  onOpen,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const selected = normalized.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? normalized.filter((option) => {
          const labelHit = option.label.toLowerCase().includes(q);
          // Allow finding by id when typing, but labels stay name-only in the UI.
          const valueHit = option.value.toLowerCase().includes(q);
          return labelHit || valueHit;
        })
      : normalized;
    return list.slice(0, 120);
  }, [normalized, query]);

  const display = selected?.label ?? "";

  return (
    <div className="relative">
      {label ? (
        <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">{label}</label>
      ) : null}
      <input
        className={inputClass}
        value={open ? query : display}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery(selected?.label || value);
          onOpen?.();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange("");
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
        }}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          <button
            type="button"
            className="block w-full text-left px-4 py-2 text-sm text-gray-500 hover:bg-gray-50"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}
          >
            {allLabel}
          </button>
          {filtered.map((option) => (
            <button
              type="button"
              key={option.value}
              className="block w-full text-left px-4 py-2 text-sm text-gray-800 hover:bg-blue-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setQuery(option.label);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400">ไม่พบรายการ</div>
          )}
        </div>
      )}
    </div>
  );
}
