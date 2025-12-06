import { describe, it, expect } from 'vitest';
import { GamepadType } from './GamepadInterface';

describe('GamepadInterface', () => {
    describe('GamepadType enum', () => {
        it('should have Standard gamepad type', () => {
            expect(GamepadType.Standard).toBe('standardpad');
        });

        it('should have Voice gamepad type', () => {
            expect(GamepadType.Voice).toBe('voicelayout');
        });

        it('should have GameBoy gamepad type', () => {
            expect(GamepadType.GameBoy).toBe('gameboy');
        });

        it('should have Drone gamepad type', () => {
            expect(GamepadType.Drone).toBe('dronepad');
        });

        it('should have Manipulator gamepad type', () => {
            expect(GamepadType.Manipulator).toBe('manipulatorpad');
        });

        it('should have Custom gamepad type', () => {
            expect(GamepadType.Custom).toBe('custom');
        });

        it('should have exactly 6 gamepad types', () => {
            const types = Object.values(GamepadType);
            expect(types).toHaveLength(6);
        });

        it('should be usable as discriminator in switch statements', () => {
            const getLabel = (type: GamepadType): string => {
                switch (type) {
                    case GamepadType.Standard:
                        return 'Standard Gamepad';
                    case GamepadType.Voice:
                        return 'Voice Control';
                    case GamepadType.GameBoy:
                        return 'GameBoy';
                    case GamepadType.Drone:
                        return 'Drone Control';
                    case GamepadType.Manipulator:
                        return 'Manipulator';
                    case GamepadType.Custom:
                        return 'Custom';
                    default:
                        return 'Unknown';
                }
            };

            expect(getLabel(GamepadType.Standard)).toBe('Standard Gamepad');
            expect(getLabel(GamepadType.Voice)).toBe('Voice Control');
            expect(getLabel(GamepadType.Drone)).toBe('Drone Control');
        });

        it('should be usable in object keys', () => {
            const config: Record<GamepadType, number> = {
                [GamepadType.Standard]: 1,
                [GamepadType.Voice]: 2,
                [GamepadType.GameBoy]: 3,
                [GamepadType.Drone]: 4,
                [GamepadType.Manipulator]: 5,
                [GamepadType.Custom]: 6,
            };

            expect(config[GamepadType.Standard]).toBe(1);
            expect(config[GamepadType.Custom]).toBe(6);
        });

        it('should be usable in arrays for iteration', () => {
            const allTypes: GamepadType[] = [
                GamepadType.Standard,
                GamepadType.Voice,
                GamepadType.GameBoy,
                GamepadType.Drone,
                GamepadType.Manipulator,
                GamepadType.Custom,
            ];

            expect(allTypes.includes(GamepadType.Voice)).toBe(true);
            expect(allTypes.includes('invalid' as GamepadType)).toBe(false);
        });

        it('should allow type checking with typeof', () => {
            expect(typeof GamepadType.Standard).toBe('string');
        });
    });
});
