import { computeSeasonStats } from '../../analytics/season-stats.js';
import { replaySeason } from '../../analytics/replay.js';
import { analyseRival } from '../../analytics/rivals.js';
import { projectStandings } from '../../analytics/scenarios.js';
import { gapBeforeMatchday } from '../../analytics/gap.js';
import { toOddsMatches } from '../../analytics/odds.js';
import { suggestBets } from '../../analytics/strategies.js';
import { buildDeadlineReport } from '../../analytics/deadline.js';
import { DEFAULT_RULES } from '../../rules/scoring.js';
import { parseMatchDate, isSameCalendarDay, formatKickoffTime } from '../../helpers/match-date.js';
import { getGuideText } from '../../commands/guide.js';
import { buildDemoWorld } from './demo-data.js';
import { parseBetArg, matchFixture } from '../../helpers/parse-bet-arg.js';
const DEMO_RULES = { values: DEFAULT_RULES, source: 'default', confidence: 'parsed' };
export class DemoDataSource {
    demo = true;
    world = buildDemoWorld();
    notify = { kind: 'desktop', target: null };
    getContext() {
        return {
            community: this.world.community,
            player: this.world.player,
            profile: null,
            readOnly: false,
            loggedIn: true,
            demo: true,
        };
    }
    md(matchday) {
        const want = matchday ?? this.world.currentMatchday;
        const found = this.world.season.matchdays.find((m) => m.matchday === want);
        if (!found)
            throw new Error(`Matchday ${want} is not part of the demo season.`);
        return found;
    }
    async today() {
        const md = this.md();
        const now = new Date();
        const matches = (md.bets ?? [])
            .map((m) => {
            const kickoff = parseMatchDate(m.date);
            return { m, kickoff };
        })
            .filter(({ kickoff }) => kickoff && isSameCalendarDay(kickoff, now))
            .map(({ m, kickoff }) => ({
            time: kickoff ? formatKickoffTime(kickoff) : '--:--',
            home: m.home,
            away: m.away,
            bet: /^\d+:\d+$/.test(m.bet) ? m.bet : '',
            odds: m.odds,
            needsBet: !/^\d+:\d+$/.test(m.bet),
        }));
        return { title: `Spieltag ${md.matchday}`, matches };
    }
    async bets(matchday) {
        const md = this.md(matchday);
        return { title: `Spieltag ${md.matchday}`, matches: md.bets ?? [] };
    }
    async schedule(matchday) {
        const md = this.md(matchday);
        return { title: `Spieltag ${md.matchday}`, matches: md.schedule ?? [] };
    }
    async leaderboard(matchday, bonus = false) {
        const md = this.md(matchday);
        const base = md.leaderboard;
        if (!bonus)
            return base;
        return {
            title: `${base.title} — Bonus`,
            bonusQuestions: [
                { abbreviation: 'CH', question: 'Who will be champion?', result: 'Bayer 04 Leverkusen' },
                { abbreviation: 'TS', question: 'Top scorer of the season?', result: 'Harry Kane' },
            ],
            rankings: base.rankings,
        };
    }
    async overview() {
        return this.world.overview;
    }
    async table(option) {
        const label = option === 'home' ? 'League Table (Home)' : option === 'away' ? 'League Table (Away)' : 'League Table';
        return { label, teams: this.world.table.teams };
    }
    async rules() {
        return this.world.rules;
    }
    async communities() {
        return [this.world.community, 'office-league', 'champions-league-pool'];
    }
    async players() {
        return this.world.players;
    }
    async matchdayBets(matchday) {
        return this.md(matchday).matchdayBets;
    }
    async bonusQuestions() {
        return this.world.bonusQuestions;
    }
    async bonusBets() {
        return this.world.bonusQuestions.map((q) => {
            const answers = q.selects
                .map((sel) => sel.options.find((o) => o.value === sel.selected)?.text)
                .filter((t) => Boolean(t));
            return { question: q.question, answers, editable: true };
        });
    }
    async members() {
        return this.world.members;
    }
    async betsForMember(member, matchday) {
        const grid = this.md(matchday).matchdayBets;
        const row = grid.players.find((p) => p.player === member.name);
        const matches = grid.matches.map((m, i) => ({
            date: m.date,
            home: m.home,
            away: m.away,
            bet: row?.bets[i] || '-',
            odds: { home: '-', draw: '-', away: '-' },
        }));
        return { member, matches };
    }
    async deadline(matchday) {
        const md = this.md(matchday);
        return buildDeadlineReport(this.world.community, md.matchday, md.bets ?? []);
    }
    async suggest(strategy, matchday) {
        const md = this.md(matchday);
        const suggestions = suggestBets(toOddsMatches(md.bets ?? []), DEMO_RULES.values, strategy);
        return { strategy, matchday: md.matchday, rules: DEMO_RULES, suggestions };
    }
    async stats(player) {
        return computeSeasonStats(this.world.season, player ?? this.world.player, DEMO_RULES.values, this.world.player);
    }
    async replay(strategy, player) {
        return replaySeason(this.world.season, player ?? this.world.player, DEMO_RULES.values, strategy, this.world.player);
    }
    async rival(name, matchday) {
        const md = this.md(matchday);
        const gap = gapBeforeMatchday(md.leaderboard, this.world.player, name);
        return analyseRival(md.matchdayBets, this.world.player, name, DEMO_RULES.values, gap);
    }
    async scenario(matchday, results = []) {
        const md = this.md(matchday);
        const supplied = results.map(parseResultArg);
        return projectStandings(md.matchdayBets, md.leaderboard, DEMO_RULES.values, supplied);
    }
    async cacheInfo() {
        return {
            community: this.world.community,
            dir: '~/.local/share/kicktipp-agent/' + this.world.community,
            sizeBytes: 486_000,
            lastSync: this.world.season.lastSync ?? null,
            knownMatchdays: this.world.currentMatchday,
            matchdays: this.world.season.matchdays.map((m) => m.matchday),
        };
    }
    clearCache() {
        /* no-op in demo */
    }
    auditLog(matchday) {
        return matchday === undefined
            ? this.world.audit
            : this.world.audit.filter((r) => r.matchday === matchday);
    }
    profiles() {
        return { active: null, profiles: ['default', 'work-pool'] };
    }
    notifyConfig() {
        return { kind: this.notify.kind, target: this.notify.target, fromEnv: false };
    }
    guide() {
        return getGuideText();
    }
    async placeBets(args, matchday) {
        const md = this.md(matchday);
        const editable = (md.bets ?? []).map((m) => ({
            home: m.home,
            away: m.away,
            heimName: '',
            gastName: '',
        }));
        const placed = [];
        for (const arg of args) {
            const { home, away, h, g } = parseBetArg(arg);
            const entry = matchFixture(home, away, editable);
            const target = (md.bets ?? []).find((m) => m.home === entry.home && m.away === entry.away);
            if (target)
                target.bet = `${h}:${g}`;
            placed.push({ home: entry.home, away: entry.away, homeGoals: h, awayGoals: g });
        }
        return placed;
    }
    async placeBetsForMember(member, args) {
        return this.placeBets(args);
    }
    async placeBonusBets(args) {
        return args.map((arg) => {
            const eq = arg.lastIndexOf('=');
            return { question: arg.slice(0, eq).trim(), answer: arg.slice(eq + 1).trim() };
        });
    }
    setCommunity(name) {
        this.world.community = name;
    }
    setPlayer(name) {
        this.world.player = name;
    }
    setNotify(kind, target) {
        this.notify = { kind, target: target ?? null };
    }
    async sync() {
        return {
            community: this.world.community,
            fetched: this.world.currentMatchday,
            skipped: 0,
            knownMatchdays: this.world.currentMatchday,
            cacheDir: '~/.local/share/kicktipp-agent/' + this.world.community,
        };
    }
}
function parseResultArg(arg) {
    const eq = arg.lastIndexOf('=');
    if (eq === -1)
        throw new Error(`Invalid result '${arg}'. Use "Home vs Away=H:G".`);
    const fixture = arg.slice(0, eq).trim();
    const result = arg.slice(eq + 1).trim();
    const parts = fixture.split(/\s+vs\.?\s+/i);
    if (parts.length !== 2)
        throw new Error(`Invalid fixture in '${arg}'. Use "Home vs Away=H:G".`);
    return { home: parts[0].trim(), away: parts[1].trim(), result };
}
