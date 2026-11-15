import { de } from './de.js';
import { en } from './en.js';
const catalogs = { en, de };
let current = 'en';
export function currentLanguage() {
    return current;
}
export function setLanguage(language) {
    current = language;
}
export function isLanguage(value) {
    return value === 'en' || value === 'de';
}
/** Reject unknown spellings. Empty / missing is not an error. */
export function parseLanguage(raw) {
    if (raw == null)
        return undefined;
    const value = raw.trim().toLowerCase();
    if (!value)
        return undefined;
    if (isLanguage(value))
        return value;
    throw new Error(en.i18n.unknown.replace('{value}', raw.trim()));
}
export function langFromArgv(argv) {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--lang' || arg === '-L')
            return argv[i + 1];
        if (arg.startsWith('--lang='))
            return arg.slice('--lang='.length);
    }
    return undefined;
}
export function resolveLanguage(opts) {
    const argv = opts?.argv ?? process.argv;
    const env = opts?.env ?? process.env;
    const fromFlag = parseLanguage(langFromArgv(argv));
    if (fromFlag)
        return fromFlag;
    const fromEnv = parseLanguage(env.KICKTIPP_LANG);
    if (fromEnv)
        return fromEnv;
    const fromConfig = parseLanguage(opts?.configLanguage);
    if (fromConfig)
        return fromConfig;
    return 'en';
}
function lookup(catalog, key) {
    let cur = catalog;
    for (const part of key.split('.')) {
        if (typeof cur !== 'object' || cur === null || !(part in cur)) {
            throw new Error(`Missing i18n key '${key}'`);
        }
        cur = cur[part];
    }
    if (typeof cur !== 'string')
        throw new Error(`i18n key '${key}' is not a string`);
    return cur;
}
export function flattenKeys(node, prefix = '') {
    const keys = [];
    for (const [name, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${name}` : name;
        if (typeof value === 'string')
            keys.push(path);
        else if (value && typeof value === 'object')
            keys.push(...flattenKeys(value, path));
    }
    return keys;
}
export function t(key, vars) {
    let text = lookup(catalogs[current], key);
    if (!vars)
        return text;
    for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
}
export { en, de };
