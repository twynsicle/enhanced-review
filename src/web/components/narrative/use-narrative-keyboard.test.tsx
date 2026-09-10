import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RISK_SECTION_ID, SUMMARY_SECTION_ID } from '@/domain/review/narrative';
import { fireEvent, render } from '@/web/test/render';
import type { ReaderSection } from './sections';
import { useNarrativeKeyboard } from './use-narrative-keyboard';

function chapter(id: string, label: string, chapterNumber: number): ReaderSection {
  return { id, kind: 'chapter', label, chapterNumber, hasDiagram: false };
}

const sections: ReaderSection[] = [
  {
    id: SUMMARY_SECTION_ID,
    kind: 'summary',
    label: 'Summary',
    chapterNumber: null,
    hasDiagram: false,
  },
  chapter('ch1', 'One', 1),
  chapter('ch2', 'Two', 2),
  chapter('ch3', 'Three', 3),
];

const withRisk: ReaderSection[] = [
  sections[0] as ReaderSection,
  { id: RISK_SECTION_ID, kind: 'risk', label: 'Risk', chapterNumber: null, hasDiagram: false },
  ...sections.slice(1),
];

function Harness({
  activeId,
  onSelect,
  list = sections,
}: {
  activeId: string;
  onSelect: (id: string) => void;
  list?: readonly ReaderSection[];
}) {
  useNarrativeKeyboard({ sections: list, activeId, onSelect });
  return null;
}

let onSelect: ReturnType<typeof vi.fn<(id: string) => void>>;

beforeEach(() => {
  onSelect = vi.fn<(id: string) => void>();
});

describe('useNarrativeKeyboard', () => {
  it('ArrowRight moves to the next chapter', () => {
    render(<Harness activeId="ch1" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('ArrowRight on the last section stops there', () => {
    render(<Harness activeId="ch3" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ArrowRight on the summary moves forward, not nowhere', () => {
    // The summary used to sit last in this cycle while sitting first in the
    // sidebar, which left this key doing nothing on the opening section.
    render(<Harness activeId={SUMMARY_SECTION_ID} onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('ch1');
  });

  it('walks through risk when the review has one', () => {
    render(<Harness activeId={SUMMARY_SECTION_ID} onSelect={onSelect} list={withRisk} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith(RISK_SECTION_ID);
  });

  it('ArrowLeft moves to the previous chapter', () => {
    render(<Harness activeId="ch2" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith('ch1');
  });

  it('ArrowLeft on the summary stops there', () => {
    render(<Harness activeId={SUMMARY_SECTION_ID} onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Home jumps to the first section', () => {
    render(<Harness activeId="ch3" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'Home' });
    expect(onSelect).toHaveBeenCalledWith(SUMMARY_SECTION_ID);
  });

  it('End jumps to the last section', () => {
    render(<Harness activeId="ch1" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'End' });
    expect(onSelect).toHaveBeenCalledWith('ch3');
  });

  it('1–9 counts chapters, not sections', () => {
    // With risk in the list, chapter two is the fourth section; the digit
    // has to mean what the sidebar prints beside the row.
    render(<Harness activeId={SUMMARY_SECTION_ID} onSelect={onSelect} list={withRisk} />);
    fireEvent.keyDown(document, { key: '2' });
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('1–9 jumps to the chapter at that index', () => {
    render(<Harness activeId={SUMMARY_SECTION_ID} onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: '2' });
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('Space (without Shift) acts like ArrowRight', () => {
    render(<Harness activeId="ch1" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('Shift+Space acts like ArrowLeft', () => {
    render(<Harness activeId="ch2" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: ' ', shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith('ch1');
  });

  it('ignores keys when focus is in an input', () => {
    render(
      <>
        <Harness activeId="ch1" onSelect={onSelect} />
        <input data-testid="x" />
      </>,
    );
    const input = document.querySelector('input');
    if (!input) throw new Error('input not rendered');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves Space to a focused button so it can activate', () => {
    render(
      <>
        <Harness activeId="ch1" onSelect={onSelect} />
        <button type="button">
          <span data-testid="label">Re-run</span>
        </button>
      </>,
    );
    const button = document.querySelector('button');
    if (!button) throw new Error('button not rendered');

    const onButton = fireEvent.keyDown(button, { key: ' ', bubbles: true, cancelable: true });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onButton).toBe(true); // not preventDefault()ed

    // Shift+Space is the "previous chapter" half of the same binding.
    fireEvent.keyDown(button, { key: ' ', shiftKey: true, bubbles: true });
    expect(onSelect).not.toHaveBeenCalled();

    // A child of the button counts too — icons and labels are the usual target.
    const label = document.querySelector('[data-testid="label"]');
    if (!label) throw new Error('label not rendered');
    fireEvent.keyDown(label, { key: ' ', bubbles: true });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still moves with the arrow keys from a focused button', () => {
    render(
      <>
        <Harness activeId="ch1" onSelect={onSelect} />
        <button type="button">Re-run</button>
      </>,
    );
    const button = document.querySelector('button');
    if (!button) throw new Error('button not rendered');
    fireEvent.keyDown(button, { key: 'ArrowRight', bubbles: true });
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('ignores Cmd/Ctrl-modified keys (browser shortcuts win)', () => {
    render(<Harness activeId="ch1" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
