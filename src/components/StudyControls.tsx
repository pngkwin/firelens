import { useState } from "react";
import { RotateCcw, SlidersHorizontal, X } from "lucide-react";
import { useStudy } from "../state/StudyContext";
import { emptyFilters } from "../data/types";
import { validateBounds } from "../data/analytics";
export function StudyControls() {
  const { filters, updateFilters, setFilters, extent } = useStudy();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  return (
    <section className="study-controls" aria-label="Shared study filters">
      <div className="filter-row">
        <div className="filter-field region-field">
          <span className="field-label">Study area</span>
          <button
            className="region-button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <SlidersHorizontal size={15} />
            {filters.bounds
              ? `${filters.bounds.west.toFixed(2)}, ${filters.bounds.south.toFixed(2)} → ${filters.bounds.east.toFixed(2)}, ${filters.bounds.north.toFixed(2)}`
              : "All loaded locations"}
          </button>
        </div>
        <label className="filter-field">
          From
          <input
            aria-label="Start date"
            type="date"
            min="1900-01-01"
            max={filters.end || "2100-12-31"}
            value={filters.start}
            onChange={(e) =>
              updateFilters({ start: e.target.value, month: null })
            }
          />
        </label>
        <label className="filter-field">
          To
          <input
            aria-label="End date"
            type="date"
            min={filters.start || "1900-01-01"}
            max="2100-12-31"
            value={filters.end}
            onChange={(e) =>
              updateFilters({ end: e.target.value, month: null })
            }
          />
        </label>
        <label className="filter-field">
          Observations
          <select
            aria-label="Sensor filter"
            value={filters.sensor}
            onChange={(e) =>
              updateFilters({
                sensor: e.target.value as typeof filters.sensor,
                month: null,
              })
            }
          >
            <option value="all">Both instruments</option>
            <option value="MODIS">MODIS only</option>
            <option value="VIIRS">VIIRS only</option>
          </select>
        </label>
        <button
          className="button quiet reset-button"
          onClick={() => {
            setFilters(emptyFilters);
            setError("");
          }}
        >
          <RotateCcw size={14} />
          Reset
        </button>
      </div>
      {filters.start && filters.end && filters.start > filters.end && (
        <p role="alert" className="error-text">
          Start date must precede end date.
        </p>
      )}
      {open && (
        <form
          className="region-editor"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const keys = ["west", "south", "east", "north"] as const;
            if (keys.some((k) => !String(form.get(k)).trim())) {
              setError("Enter all four coordinates.");
              return;
            }
            const b = {
              west: Number(form.get("west")),
              south: Number(form.get("south")),
              east: Number(form.get("east")),
              north: Number(form.get("north")),
            };
            const problem = validateBounds(b);
            if (problem) {
              setError(problem);
              return;
            }
            updateFilters({ bounds: b });
            setError("");
            setOpen(false);
          }}
        >
          <div>
            <strong>Region coordinates</strong>
            <p>
              Decimal degrees. West greater than east crosses the antimeridian.
            </p>
          </div>
          {(["west", "south", "east", "north"] as const).map((key) => (
            <label key={key}>
              {key}
              <input
                name={key}
                aria-label={`${key} coordinate`}
                type="number"
                step="any"
                required
                defaultValue={filters.bounds?.[key]}
              />
            </label>
          ))}
          <button className="button primary" type="submit">
            Apply region
          </button>
          <button
            className="button quiet"
            type="button"
            onClick={() => {
              updateFilters({ bounds: null });
              setError("");
              setOpen(false);
            }}
          >
            Clear region
          </button>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </form>
      )}
      <div className="scope-line">
        <span>
          Dates in UTC ·{" "}
          {extent.start
            ? `Loaded records span ${extent.start} to ${extent.end}`
            : "Import records to establish the available dates"}
        </span>
        {filters.bounds && (
          <button
            onClick={() => updateFilters({ bounds: null })}
            className="text-button"
          >
            Clear region <X size={12} />
          </button>
        )}
        {filters.month && (
          <button
            onClick={() => updateFilters({ month: null })}
            className="selection-chip"
          >
            Focused on {filters.month} <X size={13} />
          </button>
        )}
      </div>
    </section>
  );
}
