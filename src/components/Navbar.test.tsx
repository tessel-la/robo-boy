import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Navbar from './Navbar';

describe('Navbar', () => {
  it('marks the current section as active and reports section changes', () => {
    const setCurrentSection = vi.fn();

    render(<Navbar currentSection="simple" setCurrentSection={setCurrentSection} />);

    expect(screen.getByText('Simple Control')).toHaveClass('active');
    expect(screen.getByText('Entry')).not.toHaveClass('active');

    fireEvent.click(screen.getByText('3D View'));

    expect(setCurrentSection).toHaveBeenCalledWith('3d');
  });

  it('positions the active bubble from the selected item bounds', () => {
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList.contains('navbar')) {
        return { left: 20, top: 0, width: 300, height: 40, right: 320, bottom: 40, x: 20, y: 0, toJSON: () => {} };
      }

      if (this.textContent === 'Entry') {
        return { left: 20, top: 0, width: 60, height: 32, right: 80, bottom: 32, x: 20, y: 0, toJSON: () => {} };
      }

      return { left: 100, top: 0, width: 120, height: 32, right: 220, bottom: 32, x: 100, y: 0, toJSON: () => {} };
    };

    try {
      const { container } = render(<Navbar currentSection="entry" setCurrentSection={vi.fn()} />);

      expect(container.querySelector('.navbar-bubble')).toHaveStyle({
        left: '0px',
        width: '60px',
        height: '32px',
      });
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });
});
