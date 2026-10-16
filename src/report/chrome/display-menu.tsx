import { ActionIcon, Box, Group, Menu, Slider, Text, useMantineColorScheme } from '@mantine/core';
import {
  IconAlignLeft,
  IconBlur,
  IconBlurOff,
  IconBug,
  IconBugOff,
  IconChevronLeft,
  IconFold,
  IconFoldDown,
  IconLayoutColumns,
  IconLayoutRows,
  IconMoon,
  IconSettings,
  IconSun,
  IconTag,
  IconTagOff,
  IconTextWrap,
  IconTextWrapDisabled,
  IconViewportNarrow,
  IconViewportWide,
} from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import type { OverviewStyle, OverviewStyles } from '@/review/narrative';
import { isOverviewStyle } from '@/review/prompt/overview-styles';
import { selectSpaceLimited, useDiffView, useReaderColumn } from '@/report/stores/diff-view';
import { useDiffWrap } from '@/report/stores/diff-wrap';
import { COMMENT_FADES, previewCommentFade, useCommentFade } from '@/report/stores/comment-fade';
import { useDimComments } from '@/report/stores/dim-comments';
import type { FadeRange } from '@/report/stores/fade';
import { useFileHeaders } from '@/report/stores/file-headers';
import { useHunkDebug } from '@/report/stores/hunk-debug';
import { useLayoutWidth } from '@/report/stores/layout-width';
import { useOverviewStyle, useOverviewStyleChoice } from '@/report/stores/overview-style';
import { previewSkimFade, SKIM_FADES, useSkimFade } from '@/report/stores/skim-fade';
import { useSkimMarks } from '@/report/stores/skim-marks';

const ICON = 16;

/** What each overview style is called in the menu; `tldr` is what it shows rather than its flag. */
const STYLE_NAMES: Record<OverviewStyle, string> = {
  narrative: 'Narrative',
  'before-after': 'Before and after',
  'five-whys': 'Five whys',
  plain: 'Plain',
  simple: 'Simple',
  'pros-cons': 'Pros and cons',
  tldr: 'Headlines only',
};

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
 * How hard a setting above it fades, beneath that setting. Shown only while
 * the setting is on: a strength for a fade that is not drawn would be a
 * control that visibly does nothing. A drag paints each step and stores only
 * where it ends.
 */
function FadeSlider({
  name,
  range,
  value,
  onPreview,
  onCommit,
}: {
  name: string;
  range: FadeRange;
  value: number;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  return (
    <Box px="sm" pb="xs">
      <Text fz="xs" c="dimmed" mb={4}>
        {name} · {shown}%
      </Text>
      <Slider
        thumbLabel={name}
        size="sm"
        min={range.min}
        max={range.max}
        step={range.step}
        value={shown}
        onChange={(next) => {
          setDraft(next);
          onPreview(next);
        }}
        onChangeEnd={(next) => {
          onCommit(next);
          setDraft(null);
        }}
        label={null}
      />
    </Box>
  );
}

/**
 * Which style the overview and chapter bodies are read in, for a review written
 * in several. A submenu of the review's own styles, so a reader comparing two
 * of up to seven goes straight to either rather than round the others.
 */
function OverviewStyleItem({ styles }: { styles: OverviewStyles }) {
  const shown = useOverviewStyle(styles);
  const choose = useOverviewStyleChoice((s) => s.choose);
  return (
    // Leftward: the menu hangs from the header's right edge, so a submenu to its right is off the page.
    <Menu.Sub position="left-start">
      <Menu.Sub.Target>
        <Menu.Sub.Item
          leftSection={<IconAlignLeft size={ICON} />}
          rightSection={
            <Group component="span" gap={4} wrap="nowrap" ml="lg">
              <Text component="span" fz="xs" c="dimmed">
                {STYLE_NAMES[shown]}
              </Text>
              <IconChevronLeft size={ICON} />
            </Group>
          }
          closeMenuOnClick={false}
          aria-label={`Overview style: ${STYLE_NAMES[shown]}`}
        >
          Overview style
        </Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        <Menu.RadioGroup
          value={shown}
          onChange={(value) => isOverviewStyle(value) && choose(value)}
        >
          {styles.map((style) => (
            <Menu.RadioItem key={style} value={style}>
              {STYLE_NAMES[style]}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
}

/**
 * Every display preference the report has, in one menu. `styles` are the
 * review's overview styles, offered only when there is more than one to choose.
 */
export function DisplayMenu({ styles }: { styles?: OverviewStyles }) {
  const view = useDiffView((s) => s.view);
  const toggleView = useDiffView((s) => s.toggle);
  const wrap = useDiffWrap((s) => s.wrap);
  const toggleWrap = useDiffWrap((s) => s.toggle);
  const comments = useDimComments((s) => s.comments);
  const toggleComments = useDimComments((s) => s.toggle);
  const headers = useFileHeaders((s) => s.headers);
  const toggleHeaders = useFileHeaders((s) => s.toggle);
  const marks = useSkimMarks((s) => s.marks);
  const toggleMarks = useSkimMarks((s) => s.toggle);
  const debug = useHunkDebug((s) => s.debug);
  const toggleDebug = useHunkDebug((s) => s.toggle);
  const skimFade = useSkimFade((s) => s.fade);
  const setSkimFade = useSkimFade((s) => s.setFade);
  const commentFade = useCommentFade((s) => s.fade);
  const setCommentFade = useCommentFade((s) => s.setFade);
  const width = useLayoutWidth((s) => s.width);
  const toggleWidth = useLayoutWidth((s) => s.toggle);
  const spaceLimited = useReaderColumn(selectSpaceLimited);
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const dark = colorScheme !== 'light';
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
        {styles && styles.length > 1 && <OverviewStyleItem styles={styles} />}
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
          icon={wrap === 'on' ? <IconTextWrap size={ICON} /> : <IconTextWrapDisabled size={ICON} />}
          name="Long lines"
          value={wrap === 'on' ? 'Wrapped' : 'Not wrapped'}
          onClick={toggleWrap}
        />
        <SettingItem
          icon={comments === 'dimmed' ? <IconBlur size={ICON} /> : <IconBlurOff size={ICON} />}
          name="Comments"
          value={comments === 'dimmed' ? 'Dimmed' : 'Normal'}
          onClick={toggleComments}
        />
        {comments === 'dimmed' && (
          <FadeSlider
            name="Comment fade"
            range={COMMENT_FADES}
            value={commentFade}
            onPreview={previewCommentFade}
            onCommit={setCommentFade}
          />
        )}
        <SettingItem
          icon={headers === 'one-line' ? <IconFold size={ICON} /> : <IconFoldDown size={ICON} />}
          name="File headers"
          value={headers === 'one-line' ? 'One line' : 'Every fact'}
          onClick={toggleHeaders}
        />
        <SettingItem
          icon={marks === 'marked' ? <IconTag size={ICON} /> : <IconTagOff size={ICON} />}
          name="Skim hunks"
          value={marks === 'marked' ? 'Marked' : 'Plain'}
          hint="Marked fades the lines the review says to skim and labels why"
          onClick={toggleMarks}
        />
        {marks === 'marked' && (
          <FadeSlider
            name="Skim fade"
            range={SKIM_FADES}
            value={skimFade}
            onPreview={previewSkimFade}
            onCommit={setSkimFade}
          />
        )}
        <SettingItem
          icon={debug === 'on' ? <IconBug size={ICON} /> : <IconBugOff size={ICON} />}
          name="Hunk debug"
          value={debug === 'on' ? 'On' : 'Off'}
          hint="Labels every hunk with its id, tier and split part"
          onClick={toggleDebug}
        />
        <SettingItem
          icon={
            width === 'full' ? <IconViewportWide size={ICON} /> : <IconViewportNarrow size={ICON} />
          }
          name="Layout"
          value={width === 'full' ? 'Full width' : 'Narrower'}
          onClick={toggleWidth}
        />
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
