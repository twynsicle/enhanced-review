import { describe, expect, it } from 'vitest';
import { DisplayMenu } from '@/report/chrome/display-menu';
import { render, screen, userEvent } from '@/report/test/render';

describe('the display menu', () => {
  it('groups its settings under page, code and experimental', async () => {
    render(<DisplayMenu />);
    await userEvent.click(screen.getByRole('button', { name: 'Display settings' }));
    await screen.findByRole('menuitem', { name: /^Layout:/ });

    const dropdown = screen.getByRole('menu');
    const order = [...dropdown.querySelectorAll('.mantine-Menu-label, [role="menuitem"]')].map(
      (element) =>
        element.getAttribute('role') === 'menuitem'
          ? (element.getAttribute('aria-label') ?? '').split(':')[0]
          : `# ${element.textContent}`,
    );
    expect(order).toEqual([
      '# Page',
      'Layout',
      'Theme',
      '# Code',
      'Diffs',
      'Long lines',
      'File headers',
      '# Experimental',
      'Comments',
      'Skim hunks',
      'Hunk debug',
    ]);
  });
});
