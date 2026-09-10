import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

  it('renders a sequence diagram with its branch labels', () => {
    render(<DiagramFigure diagram={REAL_SEQUENCE} />);
    expect(screen.getByText('[launched]')).toBeInTheDocument();
    expect(screen.getByText('[threw]')).toBeInTheDocument();
  });
});
