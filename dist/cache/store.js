import fs from 'fs';
import path from 'path';
import { parseMatchDate } from '../helpers/match-date.js';
import { communityDir } from './paths.js';
/**
 * Bumped when the shape of a cached payload changes. Readers ignore files
 * written by a different version and re-fetch instead of guessing.
 */
export const SCHEMA_VERSION = 1;
/** Kinds stored once per matchday; everything else is stored once. */
const PER_MATCHDAY = new Set([
    'schedule',
    'bets',
    'leaderboard',
    'matchdayBets',
]);
function matchdayFolder(matchday) {
    return `matchday-${String(matchday).padStart(2, '0')}`;
}
function writeJsonAtomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
}
function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    catch {
        return null;
    }
}
/**
 * A directory of JSON snapshots, one per page the agent has fetched.
 *
 * Deliberately not a database: the whole season is a few hundred kilobytes,
 * the shapes are the ones core.ts already returns, and staying dependency-free
 * keeps installs light.
 */
export class CacheStore {
    community;
    root;
    constructor(community, root = communityDir(community)) {
        this.community = community;
        this.root = root;
    }
    get dir() {
        return this.root;
    }
    fileFor(kind, matchday) {
        if (PER_MATCHDAY.has(kind)) {
            if (matchday === undefined) {
                throw new Error(`Cache kind '${kind}' requires a matchday.`);
            }
            return path.join(this.root, matchdayFolder(matchday), `${kind}.json`);
        }
        return path.join(this.root, `${kind}.json`);
    }
    write(kind, data, matchday) {
        const envelope = {
            schemaVersion: SCHEMA_VERSION,
            community: this.community,
            kind,
            matchday,
            fetchedAt: new Date().toISOString(),
            data,
        };
        writeJsonAtomic(this.fileFor(kind, matchday), envelope);
    }
    read(kind, matchday) {
        const envelope = readJson(this.fileFor(kind, matchday));
        if (!envelope || envelope.schemaVersion !== SCHEMA_VERSION)
            return null;
        return envelope;
    }
    has(kind, matchday) {
        return this.read(kind, matchday) !== null;
    }
    /** Matchday numbers that have at least one cached file, ascending. */
    cachedMatchdays() {
        if (!fs.existsSync(this.root))
            return [];
        return fs
            .readdirSync(this.root)
            .map((name) => name.match(/^matchday-(\d+)$/))
            .filter((m) => m !== null)
            .map((m) => Number(m[1]))
            .sort((a, b) => a - b);
    }
    readMeta() {
        const meta = readJson(path.join(this.root, 'meta.json'));
        if (!meta || meta.schemaVersion !== SCHEMA_VERSION)
            return null;
        return meta;
    }
    writeMeta(meta) {
        writeJsonAtomic(path.join(this.root, 'meta.json'), {
            schemaVersion: SCHEMA_VERSION,
            community: this.community,
            ...meta,
        });
    }
    clear() {
        fs.rmSync(this.root, { recursive: true, force: true });
    }
    /** Total bytes on disk, for `kicktipp cache status`. */
    sizeBytes() {
        if (!fs.existsSync(this.root))
            return 0;
        let total = 0;
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory())
                    walk(full);
                else
                    total += fs.statSync(full).size;
            }
        };
        walk(this.root);
        return total;
    }
}
/** A matchday counts as finished once every match has a real result. */
export function isMatchdayFinished(matches) {
    return matches.length > 0 && matches.every((m) => /^\d+:\d+$/.test(m.result));
}
/** True when every fixture has a kickoff after `now`. Unparseable dates
 *  mean we cannot tell, so this stays false and the matchday is fetched. */
export function isMatchdayUpcoming(matches, now = new Date()) {
    if (!matches.length)
        return false;
    const kickoffs = [];
    for (const match of matches) {
        const at = parseMatchDate(match.date);
        if (!at)
            return false;
        kickoffs.push(at);
    }
    return kickoffs.every((at) => at.getTime() > now.getTime());
}
