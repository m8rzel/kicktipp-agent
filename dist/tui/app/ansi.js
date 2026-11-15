/**
 * Low-level terminal escape codes and colour helpers.
 *
 * Everything the TUI draws goes through here, so colour support can be
 * detected once and degraded gracefully: truecolor when the terminal
 * advertises it, 256-colour otherwise, and plain text when colour is off
 * (NO_COLOR, a dumb terminal, or a non-interactive stream).
 */
let colorEnabled = true;
let truecolor = true;
/** Decide how much colour the current terminal can take. Called on launch. */
export function detectColor(env = process.env, isTTY = process.stdout.isTTY) {
    if (env.NO_COLOR !== undefined || env.TERM === 'dumb' || !isTTY) {
        colorEnabled = false;
        truecolor = false;
        return;
    }
    colorEnabled = true;
    const flag = `${env.COLORTERM ?? ''}`.toLowerCase();
    truecolor = flag.includes('truecolor') || flag.includes('24bit');
}
/** Force a colour mode; used by tests and the plain renderer. */
export function setColorMode(opts) {
    if (opts.color !== undefined)
        colorEnabled = opts.color;
    if (opts.truecolor !== undefined)
        truecolor = opts.truecolor;
}
export function colorIsEnabled() {
    return colorEnabled;
}
// ── Screen control ────────────────────────────────────────────────
export const ESC = '\x1b';
export const CSI = `${ESC}[`;
export const enterAltScreen = `${CSI}?1049h`;
export const exitAltScreen = `${CSI}?1049l`;
export const hideCursor = `${CSI}?25l`;
export const showCursor = `${CSI}?25h`;
export const clearScreen = `${CSI}2J`;
export const home = `${CSI}H`;
export const clearLine = `${CSI}2K`;
export function moveTo(row, col) {
    return `${CSI}${row};${col}H`;
}
// ── Text attributes ───────────────────────────────────────────────
const RESET = `${CSI}0m`;
function wrap(open, text) {
    if (!colorEnabled)
        return text;
    return `${open}${text}${RESET}`;
}
export const bold = (t) => wrap(`${CSI}1m`, t);
export const dim = (t) => wrap(`${CSI}2m`, t);
export const italic = (t) => wrap(`${CSI}3m`, t);
export const underline = (t) => wrap(`${CSI}4m`, t);
export const invert = (t) => wrap(`${CSI}7m`, t);
// ── Colour ────────────────────────────────────────────────────────
/** Map an rgb triple to the nearest xterm-256 index (6x6x6 cube + greys). */
function to256(rgb) {
    const [r, g, b] = rgb;
    if (r === g && g === b) {
        if (r < 8)
            return 16;
        if (r > 248)
            return 231;
        return Math.round(((r - 8) / 247) * 24) + 232;
    }
    const q = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.round((v - 35) / 40));
    return 16 + 36 * q(r) + 6 * q(g) + q(b);
}
function fgCode(rgb) {
    if (truecolor)
        return `${CSI}38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
    return `${CSI}38;5;${to256(rgb)}m`;
}
function bgCode(rgb) {
    if (truecolor)
        return `${CSI}48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
    return `${CSI}48;5;${to256(rgb)}m`;
}
export function fg(rgb, text) {
    return wrap(fgCode(rgb), text);
}
export function bg(rgb, text) {
    return wrap(bgCode(rgb), text);
}
/** Foreground + background in a single wrap, so nesting stays clean. */
export function paint(fgColor, bgColor, text) {
    if (!colorEnabled)
        return text;
    const open = (fgColor ? fgCode(fgColor) : '') + (bgColor ? bgCode(bgColor) : '');
    return open ? `${open}${text}${RESET}` : text;
}
