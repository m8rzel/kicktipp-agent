import { launchBrowser } from '../browser.js';
import { ensureCommunity } from '../shared.js';
import { status, statusClear } from '../helpers/spinner.js';
import { emitJson, setJsonMode, widest } from '../helpers/output.js';
import { localizeMatchDates, localizePrintedDate } from '../helpers/match-date.js';
import { fetchSchedule } from '../core.js';
import { t } from '../i18n/index.js';
function render(title, matches) {
    const lines = [];
    if (title)
        lines.push(title, '');
    if (!matches.length)
        return lines.concat(t('common.noSchedule')).join('\n');
    const homeWidth = widest(matches.map((m) => m.home));
    const awayWidth = widest(matches.map((m) => m.away));
    for (const m of matches) {
        lines.push(`  ${localizePrintedDate(m.date).padEnd(17)} ${m.home.padStart(homeWidth)} vs ${m.away.padEnd(awayWidth)}  ${m.result}`);
    }
    return lines.join('\n');
}
export function registerScheduleCommand(program) {
    program
        .command('schedule')
        .description(t('cmd.schedule.description'))
        .option('--matchday <n>', t('opt.matchday'), parseInt)
        .option('--json', t('opt.json'))
        .action(async (opts) => {
        if (opts.json)
            setJsonMode(true);
        const { page } = await launchBrowser();
        try {
            const community = await ensureCommunity(page);
            status(t('status.loadingSchedule'));
            const data = await fetchSchedule(page, community, opts.matchday);
            statusClear();
            if (opts.json)
                emitJson({ community, matchday: opts.matchday ?? null, data: { ...data, matches: localizeMatchDates(data.matches) } });
            else
                console.log(render(data.title, data.matches));
        }
        finally {
            await page.close();
        }
    });
}
