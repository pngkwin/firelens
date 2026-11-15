import { useId, type ReactNode } from "react";

/**
 * A select with an explicit label association. Wrapping a <select> in its
 * <label> lets the option text leak into the accessible name ("State" would
 * also match "Region: United States"); htmlFor/id keeps the name exact.
 */
export function SelectField({ label, value, onChange, children, className = "", disabled }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={`fc-field ${className}`}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {children}
      </select>
    </div>
  );
}
