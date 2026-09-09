import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUMMARY_SECTION_ID, type NarrativeChapter } from '@/domain/review/narrative';
import { fireEvent, render } from '@/web/test/render';
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
