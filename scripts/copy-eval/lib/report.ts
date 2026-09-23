// Armado de Markdown chiquito para el reporte del harness: nada más que
// formatear tablas y números, sin ninguna lógica de evaluación.

export function mdTable(headers: string[], rows: Array<Array<string | number>>): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.map((cell) => String(cell)).join(" | ")} |`);
  return [headerLine, sepLine, ...rowLines].join("\n");
}

export function fmtPct(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function fmtNum(value: number | null, digits = 3): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function fmtMs(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}
