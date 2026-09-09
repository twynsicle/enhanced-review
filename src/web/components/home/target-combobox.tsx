import { Box, Combobox, Text, UnstyledButton, useCombobox } from '@mantine/core';
import { IconSearch, IconSelector } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { token } from '@/web/theme/tokens';

/**
 * Generic single-select with the search box inside the dropdown, on Mantine's
 * Combobox primitive. `items === null` means the list is still loading.
 * Keyboard handling (arrows, Enter, Escape) comes from the primitive; the
 * search input is focused whenever the dropdown opens.
 */
export interface TargetComboboxProps<T> {
  items: T[] | null;
  value: T | null;
  onChange: (item: T) => void;
  getKey: (item: T) => string;
  /** Lower-cased haystack for the filter. */
  getSearchValue: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  renderTrigger: (item: T) => ReactNode;
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled?: boolean;
}

export function TargetCombobox<T>({
  items,
  value,
  onChange,
  getKey,
  getSearchValue,
  renderItem,
  renderTrigger,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled = false,
}: TargetComboboxProps<T>) {
  const [search, setSearch] = useState('');
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch('');
    },
    onDropdownOpen: () => combobox.focusSearchInput(),
  });

  const needle = search.trim().toLowerCase();
  const filtered = items?.filter((item) => needle === '' || getSearchValue(item).includes(needle));
  const selectedKey = value ? getKey(value) : null;

  let options: ReactNode;
  if (!filtered) {
    options = <Combobox.Empty>Loading…</Combobox.Empty>;
  } else if (filtered.length === 0) {
    options = <Combobox.Empty>{emptyMessage}</Combobox.Empty>;
  } else {
    options = filtered.map((item) => {
      const key = getKey(item);
      return (
        <Combobox.Option key={key} value={key} active={key === selectedKey} py={7} fz={13}>
          {renderItem(item)}
        </Combobox.Option>
      );
    });
  }

  return (
    <Combobox
      store={combobox}
      disabled={disabled}
      position="bottom-start"
      width="target"
      offset={6}
      onOptionSubmit={(key) => {
        const item = items?.find((candidate) => getKey(candidate) === key);
        if (item) onChange(item);
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <UnstyledButton
          type="button"
          disabled={disabled}
          onClick={() => combobox.toggleDropdown()}
          aria-haspopup="listbox"
          w="100%"
          h={40}
          px={12}
          fz={15}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 8,
            border: `1px solid ${token('input')}`,
            background: token('surface-2'),
            color: token('foreground'),
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          <Box miw={0} style={{ flex: 1, overflow: 'hidden' }}>
            {value ? (
              renderTrigger(value)
            ) : (
              <Text component="span" fz={15} c="dimmed" truncate style={{ display: 'block' }}>
                {placeholder}
              </Text>
            )}
          </Box>
          <IconSelector size={16} style={{ flexShrink: 0, opacity: 0.6 }} aria-hidden />
        </UnstyledButton>
      </Combobox.Target>

      <Combobox.Dropdown style={{ borderRadius: 12 }}>
        <Combobox.Search
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={searchPlaceholder}
          leftSection={<IconSearch size={14} />}
        />
        <Combobox.Options mah={288} style={{ overflowY: 'auto' }}>
          {options}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
