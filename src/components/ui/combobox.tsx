'use client';

import { ChevronsUpDown } from 'lucide-react';
import * as React from 'react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface ComboboxProps<T> {
  items: T[] | null;
  value: T | null;
  onChange: (item: T) => void;
  getKey: (item: T) => string;
  /** Plain string used by cmdk's built-in fuzzy filter. */
  getSearchValue: (item: T) => string;
  /** What renders inside each row. */
  renderItem: (item: T, selected: boolean) => React.ReactNode;
  /** What renders inside the trigger when an item is selected. Falls back to getSearchValue. */
  renderTrigger?: (item: T) => React.ReactNode;
  placeholder: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
  /** Width of the popover. Defaults to matching the trigger. */
  popoverClassName?: string;
}

export function Combobox<T>({
  items,
  value,
  onChange,
  getKey,
  getSearchValue,
  renderItem,
  renderTrigger,
  placeholder,
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches.',
  disabled,
  className,
  popoverClassName,
}: ComboboxProps<T>) {
  const [open, setOpen] = React.useState(false);
  const loading = items === null;

  const selectedLabel = value
    ? renderTrigger
      ? renderTrigger(value)
      : getSearchValue(value)
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        disabled={disabled || loading}
        aria-busy={loading}
        className={cn(
          'flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input/60 bg-input/20 px-3 text-left text-sm outline-none transition-colors',
          'hover:bg-input/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-60',
          'aria-expanded:border-ring aria-expanded:bg-input/40',
          className,
        )}
      >
        <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
          {loading ? 'Loading…' : (selectedLabel ?? placeholder)}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className={cn(
          'w-(--radix-popover-trigger-width) p-0 max-h-(--radix-popover-content-available-height) overflow-hidden',
          popoverClassName,
        )}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {items?.map((item) => {
              const key = getKey(item);
              const isSelected = value !== null && getKey(value) === key;
              return (
                <CommandItem
                  key={key}
                  value={getSearchValue(item)}
                  data-checked={isSelected}
                  onSelect={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                >
                  {renderItem(item, isSelected)}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
