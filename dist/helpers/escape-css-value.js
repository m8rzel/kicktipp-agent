export function escapeCssValue(value) {
    return value.replace(/["\\]/g, '\\$&');
}
