import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@enhanced-review/review-types';
import { useNarrativeKeyboard } from './use-narrative-keyboard';

const chapters: NarrativeChapter[] = [
  { id: 'ch1', title: 'One', insights: [], diffChunks: [] },
  { id: 'ch2', title: 'Two', insights: [], diffChunks: [] },
  { id: 'ch3', title: 'Three', insights: [], diffChunks: [] },
];

function Harness({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  useNarrativeKeyboard({ chapters, activeId, onSelect });
  return null;
}

let onSelect: ReturnType<typeof vi.fn<(id: string) => void>>;

beforeEach(() => {
  onSelect = vi.fn<(id: string) => void>();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useNarrativeKeyboard', () => {
  it('ArrowRight moves to the next chapter', () => {
    render(<Harness activeId="ch1" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('ch2');
  });

  it('ArrowRight on the last chapter jumps to the summary', () => {
    render(<Harness activeId="ch3" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith(SUMMARY_SECTION_ID);
  });

  it('ArrowRight on the summary is a no-op', () => {
    render(<Harness activeId={SUMMARY_SECTION_ID} onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ArrowLeft moves to the previous chapter', () => {
    render(<Harness activeId="ch2" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith('ch1');
  });

  it('ArrowLeft on the summary jumps to the last chapter', () => {
    render(<Harness activeId={SUMMARY_SECTION_ID} onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenCalledWith('ch3');
  });

  it('Home jumps to the first chapter', () => {
    render(<Harness activeId="ch3" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'Home' });
    expect(onSelect).toHaveBeenCalledWith('ch1');
  });

  it('End jumps to the summary', () => {
    render(<Harness activeId="ch1" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'End' });
    expect(onSelect).toHaveBeenCalledWith(SUMMARY_SECTION_ID);
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

  it('ignores Cmd/Ctrl-modified keys (browser shortcuts win)', () => {
    render(<Harness activeId="ch1" onSelect={onSelect} />);
    fireEvent.keyDown(document, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(document, { key: 'ArrowRight', ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
  });
});
