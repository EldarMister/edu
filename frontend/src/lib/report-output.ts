export function exportCsv(title: string, headings: string[], rows: string[][]) {
  const csv = [headings, ...rows].map((row) => row.map((value) => {
    const isNegativeNumber = /^-\d+(?:[\u00a0\u202f ]\d{3})*(?:[.,]\d+)?(?: с|%| сек\.)?$/.test(value);
    const safe = /^\s*[=+@-]/.test(value) && !isNegativeNumber ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  }).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = title + '.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printReport(title: string, caption: string, headings: string[], rows: string[][]) {
  const target = window.open('', '_blank', 'width=1000,height=730');
  if (!target) return false;
  target.opener = null;
  const doc = target.document;
  doc.title = title;
  const style = doc.createElement('style');
  style.textContent = '@page { size: landscape; margin: 12mm; } body { font: 13px sans-serif; } table { width: 100%; border-collapse: collapse; } th, td { padding: 7px; border: 1px solid #ccc; text-align: left; } tr { break-inside: avoid; }';
  doc.head.append(style);
  const heading = doc.createElement('h1');
  heading.textContent = title;
  doc.body.append(heading);
  if (caption) {
    const period = doc.createElement('p');
    period.textContent = caption;
    doc.body.append(period);
  }
  const table = doc.createElement('table');
  const header = table.createTHead().insertRow();
  for (const value of headings) {
    const th = doc.createElement('th');
    th.textContent = value;
    header.append(th);
  }
  const body = table.createTBody();
  for (const data of rows) {
    const row = body.insertRow();
    for (const value of data) row.insertCell().textContent = value;
  }
  doc.body.append(table);
  target.addEventListener('afterprint', () => target.close(), { once: true });
  target.focus();
  target.print();
  return true;
}
