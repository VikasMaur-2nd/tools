/** A plain number, which a spreadsheet reads as a number (never a formula) whatever its sign. */
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * A CSV cell as text a spreadsheet won't run (OWASP "CSV injection"): one that starts with = + - @, or a
 * tab or carriage return (spreadsheets skip those first), is a formula when Excel, Sheets or LibreOffice
 * opens the file, so it gets a leading ' (shown as the text it is). Plain numbers stay as they are.
 */
export const formulaSafe = (s: string): string => (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s) ? "'" + s : s);
