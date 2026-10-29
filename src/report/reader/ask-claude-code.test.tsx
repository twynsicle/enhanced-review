import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RISK_SECTION_ID, SUMMARY_SECTION_ID, type NarrativeChapter } from '@/review/narrative';
import { SAMPLE_BUNDLE } from '@/report/sample-bundle';
import { EmbeddedFileSource } from '@/report/reader/file-source';
import { act, fireEvent, render, screen } from '@/report/test/render';
import { askPrompt } from './ask-prompt';
import { CONFIRMATION_MS } from './ask-claude-code';
import { ChapterCard } from './chapter-card';
import { ChapterReader } from './chapter-reader';

vi.mock('@monaco-editor/react', () => ({
  DiffEditor: () => <div data-testid="diff-editor" />,
  Editor: () => <div data-testid="code-editor" />,
  loader: { config: () => {}, init: () => Promise.resolve({ editor: { defineTheme: () => {} } }) },
}));

const CONFIRMATION = 'Copied — paste it into Claude Code in this repository';
const { meta, review } = SAMPLE_BUNDLE;
const [first, second] = review.chapters as [NarrativeChapter, NarrativeChapter];
const reviewFiles = new Map((review.files ?? []).map((file) => [file.filename, file]));
const firstPrompt = askPrompt(meta, first, reviewFiles);

function renderChapter(chapter: NarrativeChapter) {
  const ui = (ch: NarrativeChapter) => (
    <EmbeddedFileSource bundle={SAMPLE_BUNDLE}>
      <ChapterCard
        chapter={ch}
        styles={['narrative']}
        bodyStyle="narrative"
        meta={meta}
        chapterIndex={1}
      />
    </EmbeddedFileSource>
  );
  const result = render(ui(chapter));
  return { ...result, showChapter: (ch: NarrativeChapter) => result.rerender(ui(ch)) };
}

function button(): HTMLElement {
  return screen.getByRole('button', { name: 'Copy a prompt for Claude Code' });
}

async function click(): Promise<void> {
  await act(async () => {
    fireEvent.click(button());
  });
}

const stubbed: [object, PropertyKey, PropertyDescriptor | undefined][] = [];

/** Shadows a property for one test; `restoreStubs` puts back what was there. */
function stub(target: object, key: PropertyKey, value: unknown): void {
  stubbed.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, { value, configurable: true });
}

function restoreStubs(): void {
  for (const [target, key, descriptor] of stubbed.splice(0).toReversed()) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  }
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  stub(navigator, 'clipboard', { writeText: spy });
  return spy;
}

function stubExecCommand(result: boolean | 'throws') {
  const spy = vi.fn((_command: string) => {
    if (result === 'throws') throw new Error('not supported');
    return result;
  });
  stub(document, 'execCommand', spy);
  return spy;
}

const refused = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));

describe('the Ask Claude Code button', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreStubs();
  });

  it('is named for what it does, in the chapter header', () => {
    renderChapter(first);
    expect(button().closest('header')).not.toBeNull();
    expect(button()).toHaveAccessibleName('Copy a prompt for Claude Code');
  });

  it('wears Clawd, so it reads as Claude Code’s at a glance, hidden from assistive tech', () => {
    renderChapter(first);
    const icon = button().querySelector('svg[data-icon="clawd"]');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden');
  });

  it('copies the chapter’s prompt through the clipboard API and confirms it politely', async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const execCommand = stubExecCommand(true);
    renderChapter(first);
    await click();

    expect(writeText).toHaveBeenCalledWith(firstPrompt);
    expect(execCommand).not.toHaveBeenCalled();
    const message = screen.getByText(CONFIRMATION);
    expect(message).toHaveAttribute('aria-live', 'polite');
  });

  it('falls back to a selection copy when the clipboard API refuses', async () => {
    stubClipboard(refused);
    const execCommand = stubExecCommand(true);
    renderChapter(first);
    button().focus();
    await click();

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(button()).toHaveFocus();
    expect(screen.getByText(CONFIRMATION)).toBeInTheDocument();
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('shows the prompt, selected, to copy by hand when neither copy works', async () => {
    stubClipboard(refused);
    stubExecCommand('throws');
    renderChapter(first);
    await click();

    expect(screen.queryByText(CONFIRMATION)).toBeNull();
    expect(screen.getByText(/Couldn’t copy/)).toHaveAttribute('aria-live', 'polite');
    const block = screen.getByRole('textbox', { name: 'Prompt for Claude Code' });
    expect(block).toHaveValue(firstPrompt);
    expect(block).toHaveAttribute('readonly');
    expect(block).toHaveFocus();
    expect(block.closest('[aria-live]')).toHaveAttribute('aria-live', 'off');
    const area = block as HTMLTextAreaElement;
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, area.value.length]);
  });

  it('shows the manual block too when the selection copy reports failure', async () => {
    stubClipboard(refused);
    stubExecCommand(false);
    renderChapter(first);
    await click();
    expect(screen.getByRole('textbox', { name: 'Prompt for Claude Code' })).toBeInTheDocument();
  });

  it('clears the confirmation after a few seconds', async () => {
    stubClipboard(() => Promise.resolve());
    renderChapter(first);
    await click();
    expect(screen.getByText(CONFIRMATION)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(CONFIRMATION_MS - 1);
    });
    expect(screen.getByText(CONFIRMATION)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText(CONFIRMATION)).toBeNull();
  });

  it('clears the confirmation and the manual block when the chapter changes', async () => {
    stubClipboard(() => Promise.resolve());
    const { showChapter } = renderChapter(first);
    await click();
    expect(screen.getByText(CONFIRMATION)).toBeInTheDocument();
    showChapter(second);
    expect(screen.queryByText(CONFIRMATION)).toBeNull();

    stubClipboard(refused);
    stubExecCommand(false);
    await click();
    expect(screen.getByRole('textbox', { name: 'Prompt for Claude Code' })).toBeInTheDocument();
    showChapter(first);
    expect(screen.queryByRole('textbox', { name: 'Prompt for Claude Code' })).toBeNull();
  });
});

describe('where the button is drawn', () => {
  it.each([
    { where: 'the summary', id: SUMMARY_SECTION_ID, count: 0 },
    { where: 'the risk section', id: RISK_SECTION_ID, count: 0 },
    { where: 'a chapter', id: first.id, count: 1 },
  ])('$where has $count', ({ id, count }) => {
    window.location.hash = id === SUMMARY_SECTION_ID ? '#/' : `#/?ch=${id}`;
    render(
      <EmbeddedFileSource bundle={SAMPLE_BUNDLE}>
        <ChapterReader review={review} meta={meta} initialActiveId={id} />
      </EmbeddedFileSource>,
    );
    expect(screen.queryAllByRole('button', { name: 'Copy a prompt for Claude Code' })).toHaveLength(
      count,
    );
  });
});
