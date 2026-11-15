/**
 * The production DataSource: a thin adapter over the same functions the CLI
 * calls. It opens one authenticated session lazily (on the first request
 * that needs the network) and reuses it, so moving between screens does not
 * re-login.
 */
import { launchBrowser } from '../../browser.js';
import { fetchTodayMatches, fetchBets, fetchSchedule, fetchLeaderboard, fetchOverview, fetchTable, fetchRules, fetchCommunities, fetchPlayers, fetchMatchdayBets, fetchBonusQuestions, fetchBonusBets, fetchMembers, fetchBetsForMember, placeBets, placeBetsForMember, placeBonusBets, } from '../../core.js';
import { loadCommunity, loadPlayer, getActiveProfile, saveCommunity, savePlayer, hasUsableAuth, listProfiles, } from '../../config.js';
import { isReadOnly } from '../../read-only.js';
import { CacheStore } from '../../cache/store.js';
import { loadSeason } from '../../analytics/season.js';
import { computeSeasonStats } from '../../analytics/season-stats.js';
import { replaySeason } from '../../analytics/replay.js';
import { analyseRival } from '../../analytics/rivals.js';
import { projectStandings } from '../../analytics/scenarios.js';
import { gapBeforeMatchday } from '../../analytics/gap.js';
import { toOddsMatches } from '../../analytics/odds.js';
import { suggestBets } from '../../analytics/strategies.js';
import { buildDeadlineReport } from '../../analytics/deadline.js';
import { resolveRules, resolveRulesFromCache } from '../../rules/resolve.js';
import { readAudit } from '../../audit/log.js';
import { notifierSnapshot, applyNotifierSettings } from '../../notify/backends.js';
import { saveNotifySection } from '../../config.js';
import { syncSeason } from '../../cache/sync.js';
import { getGuideText } from '../../commands/guide.js';
export class LiveDataSource {
    demo = false;
    page = null;
    async ensurePage() {
        if (!this.page) {
            const { page } = await launchBrowser();
            this.page = page;
        }
        return this.page;
    }
    requireCommunity() {
        const community = loadCommunity();
        if (!community) {
            throw new Error('No community selected. Open “Set community” first (or run `kicktipp set-community`).');
        }
        return community;
    }
    store() {
        return new CacheStore(this.requireCommunity());
    }
    getContext() {
        return {
            community: loadCommunity(),
            player: loadPlayer(),
            profile: getActiveProfile(),
            readOnly: isReadOnly(),
            loggedIn: hasUsableAuth(),
            demo: false,
        };
    }
    async today() {
        const page = await this.ensurePage();
        return fetchTodayMatches(page, this.requireCommunity());
    }
    async bets(matchday) {
        const page = await this.ensurePage();
        return fetchBets(page, this.requireCommunity(), matchday);
    }
    async schedule(matchday) {
        const page = await this.ensurePage();
        return fetchSchedule(page, this.requireCommunity(), matchday);
    }
    async leaderboard(matchday, bonus = false) {
        const page = await this.ensurePage();
        return fetchLeaderboard(page, this.requireCommunity(), matchday, bonus);
    }
    async overview(view = 'matchday-points') {
        const page = await this.ensurePage();
        return fetchOverview(page, this.requireCommunity(), view);
    }
    async table(option) {
        const page = await this.ensurePage();
        return fetchTable(page, this.requireCommunity(), option);
    }
    async rules() {
        const page = await this.ensurePage();
        return fetchRules(page, this.requireCommunity());
    }
    async communities() {
        const page = await this.ensurePage();
        return fetchCommunities(page);
    }
    async players() {
        const page = await this.ensurePage();
        return fetchPlayers(page, this.requireCommunity());
    }
    async matchdayBets(matchday) {
        const page = await this.ensurePage();
        return fetchMatchdayBets(page, this.requireCommunity(), matchday);
    }
    async bonusQuestions() {
        const page = await this.ensurePage();
        return fetchBonusQuestions(page, this.requireCommunity());
    }
    async bonusBets() {
        const page = await this.ensurePage();
        return fetchBonusBets(page, this.requireCommunity());
    }
    async members() {
        const page = await this.ensurePage();
        return fetchMembers(page, this.requireCommunity());
    }
    async betsForMember(member, matchday) {
        const page = await this.ensurePage();
        return fetchBetsForMember(page, this.requireCommunity(), member, matchday);
    }
    async deadline(matchday) {
        const page = await this.ensurePage();
        const community = this.requireCommunity();
        const { matches } = await fetchBets(page, community, matchday);
        return buildDeadlineReport(community, matchday ?? null, matches);
    }
    async suggest(strategy, matchday) {
        const page = await this.ensurePage();
        const community = this.requireCommunity();
        const cache = { store: new CacheStore(community) };
        const { matches } = await fetchBets(page, community, matchday);
        const rules = await resolveRules(page, community, cache);
        const suggestions = suggestBets(toOddsMatches(matches), rules.values, strategy);
        return { strategy, matchday: matchday ?? null, rules, suggestions };
    }
    async stats(player) {
        const store = this.store();
        const season = loadSeason(store);
        const who = player ?? loadPlayer();
        if (!who)
            throw new Error('No player set. Open “Set player” first (or run `kicktipp set-player`).');
        const rules = resolveRulesFromCache(store);
        return computeSeasonStats(season, who, rules.values, loadPlayer());
    }
    async replay(strategy, player) {
        const store = this.store();
        const season = loadSeason(store);
        const who = player ?? loadPlayer();
        if (!who)
            throw new Error('No player set. Open “Set player” first (or run `kicktipp set-player`).');
        const rules = resolveRulesFromCache(store);
        return replaySeason(season, who, rules.values, strategy, loadPlayer());
    }
    async rival(name, matchday) {
        const page = await this.ensurePage();
        const community = this.requireCommunity();
        const player = loadPlayer();
        if (!player)
            throw new Error('No player set. Open “Set player” first (or run `kicktipp set-player`).');
        const cache = { store: new CacheStore(community) };
        const grid = await fetchMatchdayBets(page, community, matchday);
        const leaderboard = await fetchLeaderboard(page, community, matchday, false, cache);
        const rules = await resolveRules(page, community, cache);
        const gap = gapBeforeMatchday(leaderboard, player, name);
        return analyseRival(grid, player, name, rules.values, gap);
    }
    async scenario(matchday, results = []) {
        const page = await this.ensurePage();
        const community = this.requireCommunity();
        const cache = { store: new CacheStore(community) };
        const grid = await fetchMatchdayBets(page, community, matchday);
        const leaderboard = await fetchLeaderboard(page, community, matchday, false, cache);
        const rules = await resolveRules(page, community, cache);
        const supplied = results.map(parseResultArg);
        return projectStandings(grid, leaderboard, rules.values, supplied);
    }
    async cacheInfo() {
        const community = loadCommunity();
        if (!community)
            return null;
        const store = new CacheStore(community);
        const meta = store.readMeta();
        return {
            community,
            dir: store.dir,
            sizeBytes: store.sizeBytes(),
            lastSync: meta?.lastSync ?? null,
            knownMatchdays: meta?.knownMatchdays ?? null,
            matchdays: store.cachedMatchdays(),
        };
    }
    clearCache() {
        this.store().clear();
    }
    auditLog(matchday) {
        const community = loadCommunity();
        if (!community)
            return [];
        const records = readAudit(community);
        return matchday === undefined ? records : records.filter((r) => r.matchday === matchday);
    }
    profiles() {
        return { active: getActiveProfile(), profiles: listProfiles() };
    }
    notifyConfig() {
        const snap = notifierSnapshot();
        return { kind: snap.kind, target: snap.target, fromEnv: snap.from_env };
    }
    guide() {
        return getGuideText();
    }
    async placeBets(args, matchday) {
        const page = await this.ensurePage();
        return placeBets(page, this.requireCommunity(), args, matchday, true, 'cli:tui');
    }
    async placeBetsForMember(member, args, matchday) {
        const page = await this.ensurePage();
        return placeBetsForMember(page, this.requireCommunity(), member, args, matchday, true, 'cli:admin');
    }
    async placeBonusBets(args) {
        const page = await this.ensurePage();
        return placeBonusBets(page, this.requireCommunity(), args, true, 'cli:tui');
    }
    setCommunity(name) {
        saveCommunity(name);
    }
    setPlayer(name) {
        savePlayer(name);
    }
    setNotify(kind, target) {
        if (kind === 'clear') {
            saveNotifySection({ kind: 'desktop' });
            return;
        }
        applyNotifierSettings(kind, target);
    }
    async sync(opts) {
        const page = await this.ensurePage();
        return syncSeason(page, this.requireCommunity(), opts);
    }
}
/** '"Home vs Away=H:G"' → a hypothetical result. */
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
