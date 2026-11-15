import ora from 'ora';
let spinner = null;
let silenced = false;
/**
 * The dashboard owns stdin and the alt screen. ora's default
 * `discardStdin` pauses stdin and drops raw mode when the spinner
 * stops, which makes the TUI paint once and then exit.
 */
export function silenceStatus(on) {
    if (on)
        statusClear();
    silenced = on;
}
export function status(msg) {
    if (silenced)
        return;
    if (spinner) {
        spinner.text = msg;
    }
    else {
        spinner = ora(msg).start();
    }
}
export function statusClear() {
    if (spinner) {
        spinner.stop();
        spinner = null;
    }
}
