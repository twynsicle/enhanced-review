import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Diagram } from '@/domain/review/diagram';
import { REAL_ARCHITECTURE, REAL_SEQUENCE, REAL_STATE } from '@/web/test/diagram-fixtures';
import { render } from '@/web/test/render';
import { DiagramFigure } from './diagram-figure';

describe('DiagramFigure', () => {
  it('names the figure by its title and caption, for anyone who cannot see it', () => {
    render(<DiagramFigure diagram={REAL_ARCHITECTURE} />);
    expect(
      screen.getByRole('img', {
        name: `${REAL_ARCHITECTURE.title}. ${REAL_ARCHITECTURE.caption}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(REAL_ARCHITECTURE.caption)).toBeInTheDocument();
  });

  it('shows a legend of only the marks the diagram actually uses', () => {
    render(<DiagramFigure diagram={REAL_ARCHITECTURE} />);
    expect(screen.getByText('added')).toBeInTheDocument();
    expect(screen.getByText('modified')).toBeInTheDocument();
    expect(screen.getByText('unchanged')).toBeInTheDocument();
    // Nothing in this diagram was removed, so the legend does not claim so.
    expect(screen.queryByText('removed')).not.toBeInTheDocument();
  });

  it('shows no legend when every node carries the same mark', () => {
    // A wholly new subsystem is drawn flat: a one-entry legend explains nothing.
    render(<DiagramFigure diagram={REAL_STATE} />);
    expect(screen.queryByText('added')).not.toBeInTheDocument();
  });

  it('opens the file behind a grounded node, and offers nothing on one without', () => {
    const onSelectFile = vi.fn();
    render(<DiagramFigure diagram={REAL_ARCHITECTURE} onSelectFile={onSelectFile} />);

    const buttons = screen.getAllByRole('button');
    const grounded = REAL_ARCHITECTURE.kind === 'sequence' ? [] : REAL_ARCHITECTURE.nodes;
    const groundedCount = grounded.filter((node) => node.filename !== undefined).length;
    // The expand control is a button too.
    expect(buttons.length).toBe(groundedCount + 1);
  });

  it('calls back with the node file when a grounded node is activated', async () => {
    const onSelectFile = vi.fn();
    render(<DiagramFigure diagram={REAL_ARCHITECTURE} onSelectFile={onSelectFile} />);
    const node = screen.getAllByRole('button').find((el) => el.tagName.toLowerCase() === 'g');
    expect(node).toBeDefined();
    await userEvent.click(node as Element);
    expect(onSelectFile).toHaveBeenCalledTimes(1);
    expect(String(onSelectFile.mock.calls[0]?.[0])).toMatch(/\.(ts|tsx)$/);
  });

  it('makes nothing clickable when the reader has nowhere to send them', () => {
    render(<DiagramFigure diagram={REAL_ARCHITECTURE} />);
    // Only the expand control.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('lists a mark that only a line carries', () => {
    // A rewiring between unchanged components is drawn in its edges alone.
    const rewired: Diagram = {
      ...REAL_ARCHITECTURE,
      kind: 'architecture',
      direction: 'down',
      nodes: [
        { id: 'a', label: 'A', kind: 'code', change: 'unchanged' },
        { id: 'b', label: 'B', kind: 'code', change: 'unchanged' },
      ],
      edges: [
        { from: 'a', to: 'b', change: 'removed' },
        { from: 'b', to: 'a', change: 'added' },
      ],
    };
    render(<DiagramFigure diagram={rewired} />);
    expect(screen.getByText('added')).toBeInTheDocument();
    expect(screen.getByText('removed')).toBeInTheDocument();
  });

  it('loses the picture, not the page, when a diagram cannot be laid out', () => {
    const broken = { ...REAL_ARCHITECTURE, nodes: undefined } as unknown as Diagram;
    const { container } = render(<DiagramFigure diagram={broken} />);
    expect(container.querySelector('figure')).toBeNull();
  });

  it('opens a grounded node from the expanded view, and gets out of the way', async () => {
    /*
     * A browser retargets the click after a captured press to the capturing
     * element, so the pan handler taking capture on a node swallowed the
     * click. happy-dom does not retarget, so what is asserted is the cause:
     * a press on a node must not take capture, and a press on the ground must.
     */
    const capture = vi.fn();
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'setPointerCapture');
    Object.defineProperty(Element.prototype, 'setPointerCapture', {
      value: capture,
      configurable: true,
    });
    try {
      const onSelectFile = vi.fn();
      render(<DiagramFigure diagram={REAL_ARCHITECTURE} onSelectFile={onSelectFile} />);
      await userEvent.click(screen.getByRole('button', { name: /expand diagram/i }));
      const dialog = await screen.findByRole('dialog');

      await userEvent.click(within(dialog).getByRole('img'));
      expect(capture).toHaveBeenCalledTimes(1);

      const node = within(dialog)
        .getAllByRole('button')
        .find((el) => el.tagName.toLowerCase() === 'g');
      expect(node).toBeDefined();
      await userEvent.click(node as Element);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(onSelectFile).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      // Closing it from a node leaves it free to open again.
      await userEvent.click(screen.getByRole('button', { name: /expand diagram/i }));
      expect(await screen.findByRole('dialog')).toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(Element.prototype, 'setPointerCapture', original);
      else Reflect.deleteProperty(Element.prototype, 'setPointerCapture');
    }
  });

  it('renders a sequence diagram with its branch labels', () => {
    render(<DiagramFigure diagram={REAL_SEQUENCE} />);
    expect(screen.getByText('[launched]')).toBeInTheDocument();
    expect(screen.getByText('[threw]')).toBeInTheDocument();
  });
});
