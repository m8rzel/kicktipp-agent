/**
 * JSON mode is a process-wide switch rather than a parameter because the
 * top-level error handler needs it too: in JSON mode a failure has to come
 * out as JSON on stdout, not as prose on stderr.
 */
let jsonMode = false;
export function setJsonMode(on) {
    jsonMode = on;
}
export function isJsonMode() {
    return jsonMode;
}
/** The only place that writes machine-readable output to stdout. */
export function emitJson(value) {
    console.log(JSON.stringify(value, null, 2));
}
export function emitError(err) {
    const message = err instanceof Error ? err.message : String(err);
    if (jsonMode)
        emitJson({ error: message });
    else
        console.error(message);
}
/** Width of the widest entry, for column alignment. */
export function widest(values, min = 0) {
    return Math.max(min, ...values.map((v) => v.length));
}
