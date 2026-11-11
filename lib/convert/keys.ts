// Keys that are data rather than field names: numbers, UUIDs, dates.
const DATA_KEY = /^(?:-?\d+(?:\.\d+)?|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|\d{4}-\d\d-\d\d\S*)$/i;

/**
 * A key that is data (an id, a UUID, a date) rather than a field name: objects keyed by them are dictionaries
 * (infer.ts) and their values the rows of one table (xlsx.ts). Its own module, so the spreadsheet code needn't
 * load type inference.
 */
export const isDataKey = (k: string) => DATA_KEY.test(k);
