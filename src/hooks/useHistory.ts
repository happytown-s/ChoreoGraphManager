import { useState, useCallback, useRef } from 'react';

const MAX_HISTORY_SIZE = 100;

export interface HistoryState<T> {
    past: T[];
    present: T;
    future: T[];
}

export interface HistoryAPI {
    pushState: (state: any) => void;
    undo: () => void;
    redo: () => void;
    canUndo: boolean;
    canRedo: boolean;
    set: (state: any) => void;
}

function shallowEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false;
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
        // Top-level shallow comparison: compare values by reference
        if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) {
            return false;
        }
    }
    return true;
}

export function useHistory<T>(initialState: T) {
    const [state, setState] = useState<HistoryState<T>>({
        past: [],
        present: initialState,
        future: []
    });

    // Track the last pushed state reference to skip redundant pushes cheaply
    const lastPushedRef = useRef<T>(initialState);

    const canUndo = state.past.length > 0;
    const canRedo = state.future.length > 0;

    const undo = useCallback(() => {
        setState(currentState => {
            if (currentState.past.length === 0) return currentState;

            const previous = currentState.past[currentState.past.length - 1];
            const newPast = currentState.past.slice(0, currentState.past.length - 1);

            return {
                past: newPast,
                present: previous,
                future: [currentState.present, ...currentState.future]
            };
        });
    }, []);

    const redo = useCallback(() => {
        setState(currentState => {
            if (currentState.future.length === 0) return currentState;

            const next = currentState.future[0];
            const newFuture = currentState.future.slice(1);

            return {
                past: [...currentState.past, currentState.present],
                present: next,
                future: newFuture
            };
        });
    }, []);

    const pushState = useCallback((newState: T) => {
        setState(currentState => {
            // Fast path: same reference means no change at all
            if (newState === currentState.present) return currentState;
            // Shallow equality check: if top-level keys point to the same references, skip
            if (shallowEqual(newState, currentState.present)) return currentState;

            // Trim past to MAX_HISTORY_SIZE by dropping oldest entries
            const newPast = [...currentState.past, currentState.present];
            if (newPast.length > MAX_HISTORY_SIZE) {
                newPast.splice(0, newPast.length - MAX_HISTORY_SIZE);
            }

            lastPushedRef.current = newState;

            return {
                past: newPast,
                present: newState,
                future: [] // Clear future on new action
            };
        });
    }, []);

    // For setting state without pushing to history (e.g. initial load)
    const set = useCallback((newState: T) => {
        lastPushedRef.current = newState;
        setState({
            past: [],
            present: newState,
            future: []
        });
    }, []);

    return {
        state: state.present,
        pushState,
        undo,
        redo,
        canUndo,
        canRedo,
        set
    };
}
