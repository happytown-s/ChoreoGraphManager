import { useState, useCallback } from 'react';

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

export function useHistory<T>(initialState: T) {
    const [state, setState] = useState<HistoryState<T>>({
        past: [],
        present: initialState,
        future: []
    });

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
            // If the new state is exactly the same as the present, don't push
            if (JSON.stringify(currentState.present) === JSON.stringify(newState)) {
                return currentState;
            }

            return {
                past: [...currentState.past, currentState.present],
                present: newState,
                future: [] // Clear future on new action
            };
        });
    }, []);

    // For setting state without pushing to history (e.g. initial load)
    const set = useCallback((newState: T) => {
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
