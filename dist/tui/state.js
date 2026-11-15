import { t } from '../i18n/index.js';
export function initialState(rows) {
    const firstEditable = rows.findIndex((r) => r.editable);
    return {
        rows,
        cursor: firstEditable === -1 ? 0 : firstEditable,
        message: null,
        outcome: null,
        confirmingQuit: false,
    };
}
/**
 * The draft holds exactly what was typed. Two bare digits are read as a
 * scoreline ("21" is 2:1) because that is the overwhelmingly common case,
 * but anything longer needs an explicit separator, so 10:0 stays typeable.
 * Guessing at "100" would be a coin flip, so it is simply incomplete.
 */
export function normalizeDraft(draft) {
    if (draft.includes(':'))
        return draft;
    if (draft.length === 2)
        return `${draft[0]}:${draft[1]}`;
    return draft;
}
/** A draft is only submittable once it reads as a full scoreline. */
export function isCompleteDraft(draft) {
    return /^\d{1,2}:\d{1,2}$/.test(normalizeDraft(draft));
}
/** Rows whose draft differs from what is already stored. */
export function changedRows(state) {
    return state.rows.filter((row) => row.editable && isCompleteDraft(row.draft) && normalizeDraft(row.draft) !== row.saved);
}
export function isDirty(state) {
    return changedRows(state).length > 0;
}
function moveCursor(state, delta) {
    const editable = state.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.editable);
    if (!editable.length)
        return state;
    const position = editable.findIndex(({ index }) => index === state.cursor);
    const next = position === -1 ? 0 : (position + delta + editable.length) % editable.length;
    return { ...state, cursor: editable[next].index, message: null, confirmingQuit: false };
}
function updateRow(state, patch) {
    const rows = state.rows.map((row, index) => index === state.cursor ? { ...row, ...patch } : row);
    return { ...state, rows, message: null, confirmingQuit: false };
}
export function handleKey(state, key) {
    if (state.outcome)
        return state;
    const row = state.rows[state.cursor];
    switch (key.type) {
        case 'up':
            return moveCursor(state, -1);
        case 'down':
        case 'enter':
            return moveCursor(state, 1);
        case 'char': {
            if (!row?.editable)
                return state;
            // Digits and a separator are the only meaningful characters; typing a
            // digit once a scoreline is complete starts over, which is what people
            // expect when correcting a value.
            if (/^\d$/.test(key.value)) {
                // No auto-restart: a wrong entry is corrected with backspace or u,
                // which keeps every scoreline reachable and the behaviour predictable.
                if (row.draft.length >= 5)
                    return state;
                return updateRow(state, { draft: `${row.draft}${key.value}` });
            }
            if (key.value === ':' || key.value === '-') {
                if (!row.draft || row.draft.includes(':'))
                    return state;
                return updateRow(state, { draft: `${row.draft}:` });
            }
            return state;
        }
        case 'backspace':
            if (!row?.editable || !row.draft)
                return state;
            return updateRow(state, { draft: row.draft.slice(0, -1) });
        case 'clear':
            if (!row?.editable)
                return state;
            return updateRow(state, { draft: '' });
        case 'suggest':
            if (!row?.editable || !row.suggestion)
                return state;
            return updateRow(state, { draft: row.suggestion });
        case 'suggest-all': {
            const rows = state.rows.map((r) => r.editable && r.suggestion && !isCompleteDraft(r.draft) ? { ...r, draft: r.suggestion } : r);
            return { ...state, rows, message: t('tui.filledAll'), confirmingQuit: false };
        }
        case 'submit': {
            const changed = changedRows(state);
            if (!changed.length) {
                return { ...state, message: t('tui.nothingChanged'), confirmingQuit: false };
            }
            return { ...state, outcome: 'submit', message: null, confirmingQuit: false };
        }
        case 'quit':
            if (isDirty(state) && !state.confirmingQuit) {
                return {
                    ...state,
                    confirmingQuit: true,
                    message: t('tui.unsaved'),
                };
            }
            return { ...state, outcome: 'quit', message: null };
        default:
            return state;
    }
}
