"use client";

import { useMemo, useState } from "react";
import { inputClass } from "@/lib/styles";

type ComboboxProps = {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (value: string) => void;
};

export function Combobox({ label, value, options, placeholder, onChange }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
    return list.slice(0, 80);
  }, [options, query]);

  const display = value || query;

  return (
    <div className="relative">
      <label className="block text-sm font-semibold text-[var(--primary-blue)] mb-2">{label}</label>
      <input
        className={inputClass}
        value={open ? query : display}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQuery(value);
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
            ทั้งหมด
          </button>
          {filtered.map((option) => (
            <button
              type="button"
              key={option}
              className="block w-full text-left px-4 py-2 text-sm text-gray-800 hover:bg-blue-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(option);
                setQuery(option);
                setOpen(false);
              }}
            >
              {option}
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
