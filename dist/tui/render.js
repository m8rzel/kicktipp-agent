import { widest } from '../helpers/output.js';
import { t } from '../i18n/index.js';
import { changedRows, isCompleteDraft, normalizeDraft } from './state.js';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const INVERT = '\x1b[7m';
/** The whole screen as lines. Pure, so the layout can be asserted on. */
export function renderScreen(state, options) {
    const style = (code, text) => options.plain ? text : `${code}${text}${RESET}`;
    const lines = [];
    lines.push(style(BOLD, options.title));
    lines.push(options.deadline ? t('tui.nextKickoff', { deadline: options.deadline }) : t('tui.noKickoff'));
    lines.push('');
    const fixtureWidth = widest(state.rows.map((row) => `${row.home} vs ${row.away}`), 12);
    state.rows.forEach((row, index) => {
        const selected = index === state.cursor;
        const fixture = `${row.home} vs ${row.away}`.padEnd(fixtureWidth);
        let field;
        if (!row.editable)
            field = t('tui.closed');
        else if (row.draft)
            field = ` ${normalizeDraft(row.draft).padEnd(5)} `;
        else
            field = '  _:_   ';
        const changed = row.editable && isCompleteDraft(row.draft) && normalizeDraft(row.draft) !== row.saved;
        const marker = changed ? '*' : ' ';
        const saved = row.saved ? t('tui.was', { bet: row.saved }) : row.editable ? t('tui.noBetYet') : '';
        const hint = row.suggestion && !row.draft ? t('tui.suggests', { bet: row.suggestion }) : '';
        const body = `${marker} ${fixture}  ${selected ? style(INVERT, field) : field}  ` +
            style(DIM, `${saved.padEnd(Math.max(12, t('tui.noBetYet').length))} ${hint}`);
        lines.push(selected ? `> ${body}` : `  ${body}`);
    });
    lines.push('');
    const pending = changedRows(state).length;
    lines.push(pending
        ? style(BOLD, t('tui.ready', { n: pending }))
        : style(DIM, t('tui.noChanges')));
    lines.push(style(DIM, t('tui.keys')));
    if (state.message)
        lines.push(state.message);
    return lines;
}
