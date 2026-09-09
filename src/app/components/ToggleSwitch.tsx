"use client";

type ToggleSwitchProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id?: string;
};

/** Accessible modern toggle switch (replaces status checkboxes). */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
}: ToggleSwitchProps) {
  const switchId = id || `toggle-${label.replace(/\s+/g, "-").toLowerCase()}`;

  return (
    <div className={`flex items-start justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      <div className="min-w-0">
        <label htmlFor={switchId} className="text-sm font-bold text-gray-800 cursor-pointer">
          {label}
        </label>
        {description && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{description}</p>}
      </div>
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-solid)] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[var(--background)] ${
          checked ? "bg-[var(--primary-solid)]" : "bg-gray-300 dark:bg-slate-600"
        } ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
