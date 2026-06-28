/** Мелкие переиспользуемые контролы. */

interface ToggleProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}

/** Тумблер вкл/выкл. */
export function Toggle({ checked, onChange, label }: ToggleProps) {
  return (
    <button
      type="button"
      className={"toggle" + (checked ? " toggle--on" : "")}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle__track">
        <span className="toggle__knob" />
      </span>
      {label && <span className="toggle__label">{label}</span>}
    </button>
  );
}

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  /** Уменьшенный вариант — для шапок карточек. */
  compact?: boolean;
}

/** Сегментированный переключатель (например, диапазон дат). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  compact,
}: SegmentedProps<T>) {
  return (
    <div className={"segmented" + (compact ? " segmented--sm" : "")}>
      {options.map((o) => (
        <button
          key={o.value}
          className={
            "segmented__item" +
            (o.value === value ? " segmented__item--active" : "")
          }
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
