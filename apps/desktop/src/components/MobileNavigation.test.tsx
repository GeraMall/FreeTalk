// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MobileNavigation } from './MobileNavigation';

describe('MobileNavigation', () => {
  it('renders at the document level so iOS standalone mode uses the real viewport', () => {
    const onNavigate = vi.fn();
    const { container } = render(
      <div data-testid="application-grid">
        <MobileNavigation activePage="home" onNavigate={onNavigate} />
      </div>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Основная навигация' });
    expect(navigation.parentElement).toBe(document.body);
    expect(container.querySelector('.mobile-bottom-navigation')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Чаты' }));
    expect(onNavigate).toHaveBeenCalledWith('chats');
  });
});
