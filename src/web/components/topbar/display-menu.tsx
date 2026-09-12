import { ActionIcon, Menu, Text, useMantineColorScheme } from '@mantine/core';
import {
  IconLayoutColumns,
  IconLayoutRows,
  IconMoon,
  IconSettings,
  IconSun,
  IconTextWrap,
  IconTextWrapDisabled,
  IconViewportNarrow,
  IconViewportWide,
} from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import { useHydrated } from '@/web/lib/use-hydrated';
import {
  bindDiffView,
  selectSpaceLimited,
  useDiffView,
  useReaderColumn,
} from '@/web/stores/diff-view';
import { bindDiffWrap, useDiffWrap } from '@/web/stores/diff-wrap';
import { bindLayoutWidth, useLayoutWidth } from '@/web/stores/layout-width';

const ICON = 16;

/**
 * One display setting: what it is on the left, what it is currently set to on
 * the right.
 *
 * The value is the reason this is a menu rather than the row of bare icon
 * buttons it replaces. A glyph can carry a state only to someone who already
 * knows the glyph, so reading four of them meant hovering four tooltips one at
 * a time; spelling the value costs nothing here and answers the question the
 * reader actually has, which is what the setting is now rather than what the
 * button will do.
 *
 * `closeMenuOnClick={false}` because these are settings, not commands: someone
 * who has opened this to stack the diffs is quite likely to want them narrower
 * too, and a menu that shuts on every click makes them open it again to find
 * out whether the first click worked.
 */
function SettingItem({
  icon,
  name,
  value,
  disabled,
  hint,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  value: string;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <Menu.Item
      leftSection={icon}
      rightSection={
        <Text component="span" fz="xs" c="dimmed" ml="lg">
          {value}
        </Text>
      }
      closeMenuOnClick={false}
      disabled={disabled}
      title={hint}
      // The value belongs in the name, not only on screen: a row that reads
      // "Diffs" alone tells a screen reader what the setting is and nothing
      // about how it is set. A row that is refused says why in the same breath,
      // since the reason is the whole content of a control that cannot be used.
      aria-label={hint ? `${name}: ${value} — ${hint}` : `${name}: ${value}`}
      onClick={onClick}
    >
      {name}
    </Menu.Item>
  );
}

/**
 * Every display preference the page has, in one menu.
 *
 * `reader` rather than `useIsReader()`: the local report *is* the reader but
 * carries no route handle to say so, and it used to hand-assemble the same
 * controls for itself. Passing it in leaves one component with two callers
 * instead of two arrangements that have to be kept in step.
 *
 * The three stores are rehydrated **here**, on the menu, not down in the rows.
 * A dropdown does not mount its contents until it is opened, so a bind in a row
 * would not run until someone went looking — long after the first diff has
 * mounted and read the store, and the reader would paint side by side before
 * flipping to whatever was stored. This component is always mounted, and its
 * effects run before the page's, so the stored values are in place by the time
 * `useHydrated` flips.
 */
export function DisplayMenu({ reader }: { reader: boolean }) {
  const view = useDiffView((s) => s.view);
  const toggleView = useDiffView((s) => s.toggle);
  const wrap = useDiffWrap((s) => s.wrap);
  const toggleWrap = useDiffWrap((s) => s.toggle);
  const width = useLayoutWidth((s) => s.width);
  const toggleWidth = useLayoutWidth((s) => s.toggle);
  const spaceLimited = useReaderColumn(selectSpaceLimited);
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const hydrated = useHydrated();

  useEffect(() => {
    bindDiffView();
    bindDiffWrap();
    bindLayoutWidth();
  }, []);

  // Matches the toggle it replaces: the stored scheme is only known in the
  // browser, so the server and the hydrating render both say dark.
  const dark = hydrated ? colorScheme !== 'light' : true;
  // Below the threshold every diff is stacked whatever is stored, so the row
  // reports what is drawn rather than what is kept, and refuses a click that
  // would change nothing visible.
  const split = !spaceLimited && view === 'split';

  return (
    <Menu position="bottom-end" shadow="md" width={260} withinPortal>
      <Menu.Target>
        <ActionIcon variant="subtle" color="gray" size="lg" aria-label="Display settings">
          <IconSettings size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>Display settings</Menu.Label>
        {reader && (
          <>
            <SettingItem
              icon={split ? <IconLayoutColumns size={ICON} /> : <IconLayoutRows size={ICON} />}
              name="Diffs"
              value={split ? 'Side by side' : 'Stacked'}
              disabled={spaceLimited}
              hint={
                spaceLimited
                  ? 'The reading column is too narrow for two panes — widen the window or drag the sidebar in'
                  : undefined
              }
              onClick={toggleView}
            />
            <SettingItem
              icon={
                wrap === 'on' ? <IconTextWrap size={ICON} /> : <IconTextWrapDisabled size={ICON} />
              }
              name="Long lines"
              value={wrap === 'on' ? 'Wrapped' : 'Not wrapped'}
              onClick={toggleWrap}
            />
            <SettingItem
              icon={
                width === 'full' ? (
                  <IconViewportWide size={ICON} />
                ) : (
                  <IconViewportNarrow size={ICON} />
                )
              }
              name="Layout"
              value={width === 'full' ? 'Full width' : 'Narrower'}
              onClick={toggleWidth}
            />
          </>
        )}
        <SettingItem
          icon={dark ? <IconMoon size={ICON} /> : <IconSun size={ICON} />}
          name="Theme"
          value={dark ? 'Dark' : 'Light'}
          onClick={() => setColorScheme(dark ? 'light' : 'dark')}
        />
      </Menu.Dropdown>
    </Menu>
  );
}
