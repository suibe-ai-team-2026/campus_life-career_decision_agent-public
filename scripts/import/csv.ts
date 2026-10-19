/**
 * Minimal RFC 4180 CSV reader.
 *
 * The research snapshot ships a handful of small CSVs; a hand-written reader
 * keeps the import pipeline free of new dependencies. Handles a UTF-8 BOM,
 * CRLF/LF line endings, quoted fields containing commas/quotes/newlines and
 * doubled quotes. The first non-empty record is treated as the header.
 */

export interface CsvTable {
  header: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): CsvTable {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    // A record with a single empty field is a blank line, not a data row.
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };

  while (i < input.length) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      // A quote only opens a quoted field at the start of the field value.
      if (field === "") {
        inQuotes = true;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === ",") {
      pushField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Normalise CRLF and lone CR to a record separator.
      if (input[i + 1] === "\n") i += 1;
      pushRecord();
      i += 1;
      continue;
    }
    if (char === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }
  if (inQuotes) throw new Error("CSV parse error: unterminated quoted field");
  if (field !== "" || record.length > 0) pushRecord();
  if (records.length === 0) return { header: [], rows: [] };

  const [header, ...data] = records;
  const rows = data.map((values) => {
    const row: Record<string, string> = {};
    header.forEach((key, index) => {
      row[key] = values[index] ?? "";
    });
    return row;
  });
  return { header, rows };
}
