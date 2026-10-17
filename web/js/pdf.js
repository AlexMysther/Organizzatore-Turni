import { COMPANY_NAME } from './config.js';
import { DAYS, weekDates, dayOfMonth, itDate, isoWeek, addDays, fileWeekLabel } from './dates.js';

export const venueLabel = (v) => `${v.city} - ${v.name}`;

const GREEN = [26, 122, 26];
const RED = [208, 0, 0];
const GREY_SUNDAY = [211, 211, 211];
const GREY_LOAN = [180, 180, 180];
const LINE = [120, 120, 120];
const FONT = 7;

// Testo di una voce di turno, come nel PDF di riferimento ("11:00 15:00", "R", "Milano - Pola 11:00 15:00").
function entryText(e, venues) {
  if (e.kind === 'rest') return 'R';
  if (e.kind === 'work') return `${e.start} ${e.end}`;
  const v = venues.find((x) => x.id === e.venue_id);
  return [v ? venueLabel(v) : 'Altro locale', e.start && `${e.start} ${e.end}`].filter(Boolean).join(' ');
}

export function pdfFileName(venue, weekStart) {
  const slug = venue.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return `TURNI_${slug}_${fileWeekLabel(weekStart)}.pdf`;
}

export function buildPdf({ venue, venues, departments, employees, shifts, legend, weekStart, now = new Date() }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const nameW = 34;
  const dayW = (pageW - 2 * margin - nameW) / 7;
  const dates = weekDates(weekStart);
  const weekEnd = addDays(weekStart, 6);

  const byKey = new Map();
  for (const s of shifts) {
    const k = `${s.employee_id}|${s.date}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(s);
  }

  const drawPageFrame = () => {
    doc.setTextColor(0).setFont('helvetica', 'normal').setFontSize(6.5);
    doc.text(COMPANY_NAME, margin, 12);
    const stamp = `${itDate(now.toISOString().slice(0, 10))} ${now.toTimeString().slice(0, 5)}`;
    doc.text(stamp, pageW - margin, 12, { align: 'right' });
    doc.setFont('helvetica', 'bold').setFontSize(10);
    doc.text(`Ordine di servizio settimana n° ${isoWeek(weekStart)} Dal ${itDate(weekStart)} al ${itDate(weekEnd)}`, pageW / 2, 12, { align: 'center' });
    doc.setTextColor(30, 70, 140).setFontSize(10);
    doc.text(venueLabel(venue).replace(' - ', '  '), margin + 2, 19);
    doc.setTextColor(0).setFont('helvetica', 'normal').setFontSize(7);
    doc.text(String(doc.internal.getNumberOfPages()), pageW - margin, pageH - 8, { align: 'right' });
  };

  const common = {
    margin: { top: 24, left: margin, right: margin, bottom: 14 },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: FONT, cellPadding: 1, lineColor: LINE, lineWidth: 0.1, textColor: 0, valign: 'middle', halign: 'center' },
    didDrawPage: drawPageFrame,
  };

  let y = 24;
  for (const dep of departments) {
    const emps = employees.filter((e) => e.department_id === dep.id);
    if (!emps.length) continue;
    const head = [[
      { content: dep.name, styles: { halign: 'left', fontStyle: 'italic', textColor: GREEN } },
      ...dates.map((d, i) => ({
        content: `${DAYS[i]}\n${dayOfMonth(d)}`,
        styles: i === 6 ? { fillColor: GREY_SUNDAY, textColor: RED } : {},
      })),
    ]];
    const body = emps.map((emp) => [
      { content: emp.full_name, styles: { halign: 'left', fontStyle: 'bold' } },
      ...dates.map((d, i) => ({
        content: '',
        entries: byKey.get(`${emp.id}|${d}`) || [],
        styles: i === 6 ? { fillColor: GREY_SUNDAY } : {},
      })),
    ]);
    doc.autoTable({
      ...common,
      startY: y,
      head,
      body,
      headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'normal', minCellHeight: 7 },
      columnStyles: { 0: { cellWidth: nameW }, ...Object.fromEntries(dates.map((_, i) => [i + 1, { cellWidth: dayW }])) },
      bodyStyles: { minCellHeight: 10 },
      didParseCell: (data) => {
        const raw = data.cell.raw;
        if (data.section !== 'body' || data.column.index === 0 || !raw?.entries) return;
        doc.setFont('helvetica', 'normal').setFontSize(FONT);
        const segments = raw.entries.map((e) => ({
          kind: e.kind,
          lines: doc.splitTextToSize(entryText(e, venues), dayW - 2),
        }));
        data.cell.segments = segments;
        // righe vuote: riservano l'altezza, il testo viene disegnato a mano (colori diversi per riga)
        data.cell.text = segments.flatMap((s) => s.lines.map(() => ''));
        if (!data.cell.text.length) data.cell.text = [''];
      },
      didDrawCell: (data) => {
        const { cell } = data;
        if (data.section === 'head' && data.column.index === 0) {
          const w = doc.getTextWidth(dep.name);
          doc.setDrawColor(...GREEN).setLineWidth(0.15);
          doc.line(cell.x + 1, cell.y + cell.height / 2 + 1.6, cell.x + 1 + w, cell.y + cell.height / 2 + 1.6);
        }
        if (data.section !== 'body' || !cell.segments?.length) return;
        const lineH = (doc.getLineHeight() / doc.internal.scaleFactor) * 0.95;
        const total = cell.segments.reduce((n, s) => n + s.lines.length, 0);
        let ty = cell.y + (cell.height - total * lineH) / 2;
        for (const seg of cell.segments) {
          const h = seg.lines.length * lineH;
          if (seg.kind === 'loan') {
            doc.setFillColor(...GREY_LOAN).rect(cell.x + 0.1, ty - 0.2, cell.width - 0.2, h + 0.4, 'F');
            doc.setTextColor(0);
          } else {
            doc.setTextColor(...(seg.kind === 'rest' ? RED : GREEN));
          }
          doc.setFont('helvetica', 'normal').setFontSize(FONT);
          seg.lines.forEach((line, i) => doc.text(line, cell.x + cell.width / 2, ty + lineH * (i + 0.78), { align: 'center' }));
          ty += h;
        }
        doc.setTextColor(0);
      },
    });
    y = doc.lastAutoTable.finalY + 9;
  }

  if (y > pageH - 40) { doc.addPage(); y = 24; }
  const legendRows = legend.map((l) => [l.short_desc, l.description, l.hours]);
  while (legendRows.length < 2) legendRows.push(['', '', '']);
  doc.autoTable({
    ...common,
    startY: y,
    head: [
      [{ content: 'Legenda', colSpan: 3, styles: { fontStyle: 'bold', fontSize: 9 } }],
      [{ content: 'Descrizione breve', styles: { halign: 'left' } }, { content: 'Descrizione', styles: { halign: 'left' } }, { content: 'Orario', styles: { halign: 'left' } }],
    ],
    body: legendRows,
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'normal' },
    bodyStyles: { halign: 'left', minCellHeight: 5.5 },
  });

  return { blob: doc.output('blob'), filename: pdfFileName(venue, weekStart) };
}

// Condivide il PDF col foglio di condivisione del telefono (WhatsApp, mail, ...); in alternativa lo scarica.
export async function sharePdf({ blob, filename }) {
  const file = new File([blob], filename, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadPdf({ blob, filename });
  return 'downloaded';
}

export function downloadPdf({ blob, filename }) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
