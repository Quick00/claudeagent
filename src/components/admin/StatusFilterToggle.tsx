'use client';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

/**
 * The count-badged status filter above the flags and feedback lists.
 *
 * Both panels had the same wrapper, the same `value && setFilter(...)` guard
 * (`ToggleGroup` emits `''` when the active item is clicked again, which must
 * not clear the filter) and the same count-pill markup, differing only in
 * their labels — so the options are data here rather than repeated JSX.
 */
export function StatusFilterToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string; count: number }[];
}) {
  return (
    <div className="flex justify-end">
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        onValueChange={(next) => next && onChange(next as T)}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.label} <span className="ml-1.5 text-muted-foreground">{option.count}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
