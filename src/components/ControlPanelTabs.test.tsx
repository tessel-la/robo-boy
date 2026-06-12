import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React, { createRef } from 'react';
import ControlPanelTabs from './ControlPanelTabs';
import type { ActivePanel } from './MainControlView';
import { GamepadType } from './gamepads/GamepadInterface';

describe('ControlPanelTabs', () => {
    const createMockPanels = (): ActivePanel[] => [
        { id: 'panel-1', type: GamepadType.Custom, name: 'Arm Control', layoutId: 'custom-arm' },
        { id: 'panel-2', type: GamepadType.Custom, name: 'Drive Control', layoutId: 'custom-drive' },
    ];

    const mockOnSelectPanel = vi.fn();
    const mockOnAddPanelToggle = vi.fn();
    const mockOnRemovePanel = vi.fn();
    const mockAddButtonRef = createRef<HTMLButtonElement>();

    const defaultProps = {
        panels: createMockPanels(),
        selectedPanelId: 'panel-1',
        onSelectPanel: mockOnSelectPanel,
        onAddPanelToggle: mockOnAddPanelToggle,
        onRemovePanel: mockOnRemovePanel,
        addButtonRef: mockAddButtonRef,
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('rendering', () => {
        it('should render tabs container', () => {
            const { container } = render(<ControlPanelTabs {...defaultProps} />);

            expect(container.querySelector('.control-panel-tabs-container')).toBeInTheDocument();
        });

        it('should render all panel tabs', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            expect(screen.getByText('Arm Control')).toBeInTheDocument();
            expect(screen.getByText('Drive Control')).toBeInTheDocument();
        });

        it('should render add button', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            expect(screen.getByLabelText('Add Panel')).toBeInTheDocument();
        });

        it('should render remove buttons for each panel when multiple panels', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            expect(screen.getByLabelText('Remove Arm Control')).toBeInTheDocument();
            expect(screen.getByLabelText('Remove Drive Control')).toBeInTheDocument();
        });

        it('should allow removing the last panel', () => {
            const singlePanel = [{ id: 'panel-1', type: GamepadType.Custom, name: 'Arm Control', layoutId: 'custom-arm' }];
            render(<ControlPanelTabs {...defaultProps} panels={singlePanel} />);

            expect(screen.getByLabelText('Remove Arm Control')).toBeInTheDocument();
        });
    });

    describe('active state', () => {
        it('should mark selected panel as active', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            const activeTab = screen.getByText('Arm Control').closest('.tab-button');
            expect(activeTab).toHaveClass('active');
        });

        it('should set correct aria-selected', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            const camera1Tab = screen.getByText('Arm Control').closest('[role="tab"]');
            const gamepadTab = screen.getByText('Drive Control').closest('[role="tab"]');

            expect(camera1Tab).toHaveAttribute('aria-selected', 'true');
            expect(gamepadTab).toHaveAttribute('aria-selected', 'false');
        });

        it('should set correct tabIndex', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            const camera1Tab = screen.getByText('Arm Control').closest('[role="tab"]');
            const gamepadTab = screen.getByText('Drive Control').closest('[role="tab"]');

            expect(camera1Tab).toHaveAttribute('tabIndex', '0');
            expect(gamepadTab).toHaveAttribute('tabIndex', '-1');
        });
    });

    describe('click handling', () => {
        it('should call onSelectPanel when tab clicked', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            const gamepadTab = screen.getByText('Drive Control').closest('[role="tab"]');
            fireEvent.click(gamepadTab!);

            expect(mockOnSelectPanel).toHaveBeenCalledWith('panel-2');
        });

        it('should call onAddPanelToggle when add button clicked', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            fireEvent.click(screen.getByLabelText('Add Panel'));

            expect(mockOnAddPanelToggle).toHaveBeenCalled();
        });

        it('should call onRemovePanel when remove button clicked', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            fireEvent.click(screen.getByLabelText('Remove Drive Control'));

            expect(mockOnRemovePanel).toHaveBeenCalledWith('panel-2');
        });

        it('should stop propagation when remove clicked', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            fireEvent.click(screen.getByLabelText('Remove Drive Control'));

            // Should not have selected the panel
            expect(mockOnSelectPanel).not.toHaveBeenCalledWith('panel-2');
        });
    });

    describe('ref handling', () => {
        it('should attach ref to add button', () => {
            const ref = createRef<HTMLButtonElement>();
            render(<ControlPanelTabs {...defaultProps} addButtonRef={ref} />);

            expect(ref.current).toBeInstanceOf(HTMLButtonElement);
            expect(ref.current).toHaveAttribute('aria-label', 'Add Panel');
        });
    });

    describe('accessibility', () => {
        it('should have role=tab on each tab', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            const tabs = screen.getAllByRole('tab');
            expect(tabs).toHaveLength(2);
        });

        it('should have title attribute on tabs', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            const camera1Tab = screen.getByText('Arm Control').closest('[role="tab"]');
            expect(camera1Tab).toHaveAttribute('title', 'Arm Control');
        });

        it('should have title on add button', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            expect(screen.getByLabelText('Add Panel')).toHaveAttribute('title', 'Add Panel');
        });

        it('should have title on remove buttons', () => {
            render(<ControlPanelTabs {...defaultProps} />);

            expect(screen.getByLabelText('Remove Arm Control')).toHaveAttribute('title', 'Remove Panel');
        });
    });
});
