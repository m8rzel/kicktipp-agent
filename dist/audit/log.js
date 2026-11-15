import fs from 'fs';
import path from 'path';
import { dataDir } from '../cache/paths.js';
export function auditFile(community) {
    const safe = community.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(dataDir(), 'audit', `${safe}.jsonl`);
}
/**
 * Append one record. A failure here is reported once on stderr and then
 * ignored: an unwritable log must never stop a bet the user asked for.
 */
export function appendAudit(record) {
    try {
        const file = auditFile(record.community);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
        // appendFileSync only applies mode when creating, so make sure an older
        // file is not left world-readable.
        fs.chmodSync(file, 0o600);
    }
    catch (err) {
        console.error(`Warning: could not write the bet log (${err instanceof Error ? err.message : String(err)}).`);
    }
}
export function readAudit(community) {
    const file = auditFile(community);
    if (!fs.existsSync(file))
        return [];
    return fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
        try {
            return JSON.parse(line);
        }
        catch {
            return null;
        }
    })
        .filter((r) => r !== null);
}
/**
 * The most recent successful submission, which is what `log --undo`
 * reverses. Intent and failure records are skipped: nothing reached
 * Kicktipp for those.
 */
export function lastSubmission(community, matchday) {
    const records = readAudit(community).filter((r) => r.outcome === 'submitted' && (matchday === undefined || r.matchday === matchday));
    return records.length ? records[records.length - 1] : null;
}
