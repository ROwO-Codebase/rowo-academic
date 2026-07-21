export type ScheduleExportStatus =
  | "completed"
  | "in_progress"
  | "planned"
  | "transfer";

export interface ScheduleExportCourse {
  code: string;
  title: string;
  term: string;
  status: ScheduleExportStatus;
  credits: number;
  grade?: number | null;
}

export type ProgressExportStatus = "met" | "planned" | "not_met" | "unknown";

export interface ProgressExportRequirement {
  title: string;
  status: ProgressExportStatus;
  description?: string | null;
  evidence?: string[];
  missing?: string[];
}

export interface ProgressExportProgram {
  title: string;
  code: string;
  credential?: string | null;
  faculty?: string | null;
  requirements: ProgressExportRequirement[];
}

export interface GeneratedExport {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type ShareExportResult = "shared" | "downloaded" | "cancelled";

const encoder = new TextEncoder();
const scheduleStatusLabels: Record<ScheduleExportStatus, string> = {
  completed: "Completed",
  in_progress: "In progress",
  planned: "Planned",
  transfer: "Transfer credit",
};
const progressStatusLabels: Record<ProgressExportStatus, string> = {
  met: "Met",
  planned: "On track with plan",
  not_met: "Not met",
  unknown: "Needs review",
};

function exportDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function filenameDate(value: Date): string {
  return exportDate(value).replaceAll("-", "");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sheetColumnName(index: number): string {
  let value = index;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function termSequence(term: string): number {
  const year = Number(term.match(/\b(20\d{2})\b/)?.[1] ?? 0);
  const lower = term.toLowerCase();
  const season = lower.includes("winter")
    ? 1
    : lower.includes("spring")
      ? 2
      : lower.includes("summer")
        ? 3
        : lower.includes("fall") || lower.includes("autumn")
          ? 4
          : 5;
  return year ? year * 10 + season : Number.MAX_SAFE_INTEGER;
}

function sortedSchedule(courses: ScheduleExportCourse[]): ScheduleExportCourse[] {
  return [...courses].sort((left, right) => {
    const termDifference = termSequence(left.term) - termSequence(right.term);
    if (termDifference !== 0) return termDifference;
    return left.code.localeCompare(right.code);
  });
}

function inlineStringCell(reference: string, value: string, style = 1): string {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function numberCell(reference: string, value: number, style = 2): string {
  return `<c r="${reference}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function setUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function setUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatenateBytes(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function createStoredZip(files: Array<{ name: string; contents: string }>): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const contents = encoder.encode(file.contents);
    const checksum = crc32(contents);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    setUint32(localView, 0, 0x04034b50);
    setUint16(localView, 4, 20);
    setUint16(localView, 6, 0x0800);
    setUint16(localView, 8, 0);
    setUint16(localView, 10, 0);
    setUint16(localView, 12, 0);
    setUint32(localView, 14, checksum);
    setUint32(localView, 18, contents.length);
    setUint32(localView, 22, contents.length);
    setUint16(localView, 26, name.length);
    setUint16(localView, 28, 0);
    localHeader.set(name, 30);
    localParts.push(localHeader, contents);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    setUint32(centralView, 0, 0x02014b50);
    setUint16(centralView, 4, 20);
    setUint16(centralView, 6, 20);
    setUint16(centralView, 8, 0x0800);
    setUint16(centralView, 10, 0);
    setUint16(centralView, 12, 0);
    setUint16(centralView, 14, 0);
    setUint32(centralView, 16, checksum);
    setUint32(centralView, 20, contents.length);
    setUint32(centralView, 24, contents.length);
    setUint16(centralView, 28, name.length);
    setUint16(centralView, 30, 0);
    setUint16(centralView, 32, 0);
    setUint16(centralView, 34, 0);
    setUint16(centralView, 36, 0);
    setUint32(centralView, 38, 0);
    setUint32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + contents.length;
  }

  const centralDirectory = concatenateBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  setUint32(endView, 0, 0x06054b50);
  setUint16(endView, 4, 0);
  setUint16(endView, 6, 0);
  setUint16(endView, 8, files.length);
  setUint16(endView, 10, files.length);
  setUint32(endView, 12, centralDirectory.length);
  setUint32(endView, 16, localOffset);
  setUint16(endView, 20, 0);
  return concatenateBytes([...localParts, centralDirectory, end]);
}

export function createCourseScheduleXlsx(
  courses: ScheduleExportCourse[],
  includeGrades: boolean,
  generatedAt = new Date(),
): GeneratedExport {
  const headers = ["Term", "Course", "Title", "Status", "Units"];
  if (includeGrades) headers.push("Grade");
  const rows = sortedSchedule(courses).map((course, rowIndex) => {
    const row = rowIndex + 2;
    const cells = [
      inlineStringCell(`A${row}`, course.term),
      inlineStringCell(`B${row}`, course.code),
      inlineStringCell(`C${row}`, course.title),
      inlineStringCell(`D${row}`, scheduleStatusLabels[course.status]),
      numberCell(`E${row}`, course.credits),
    ];
    if (includeGrades && course.grade !== null && course.grade !== undefined) {
      cells.push(numberCell(`F${row}`, course.grade, 3));
    }
    return `<row r="${row}" ht="22" customHeight="1">${cells.join("")}</row>`;
  });
  const lastColumn = sheetColumnName(headers.length);
  const lastRow = Math.max(1, courses.length + 1);
  const headerCells = headers
    .map((header, index) => inlineStringCell(`${sheetColumnName(index + 1)}1`, header, 4))
    .join("");
  const columnWidths = [
    '<col min="1" max="1" width="18" customWidth="1"/>',
    '<col min="2" max="2" width="14" customWidth="1"/>',
    '<col min="3" max="3" width="42" customWidth="1"/>',
    '<col min="4" max="4" width="18" customWidth="1"/>',
    '<col min="5" max="5" width="11" customWidth="1"/>',
    includeGrades ? '<col min="6" max="6" width="12" customWidth="1"/>' : "",
  ].join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="1" summaryRight="1"/></sheetPr><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${columnWidths}</cols><sheetData><row r="1" ht="26" customHeight="1">${headerCells}</row>${rows.join("")}</sheetData><autoFilter ref="A1:${lastColumn}${lastRow}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
  const timestamp = generatedAt.toISOString();
  const files = [
    {
      name: "[Content_Types].xml",
      contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    },
    {
      name: "_rels/.rels",
      contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
    },
    {
      name: "docProps/core.xml",
      contents: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Course schedule</dc:title><dc:creator>Rowo Academic</dc:creator><cp:lastModifiedBy>Rowo Academic</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`,
    },
    {
      name: "docProps/app.xml",
      contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Rowo Academic</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Course schedule</vt:lpstr></vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>',
    },
    {
      name: "xl/workbook.xml",
      contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="xl"/><workbookPr date1904="0"/><bookViews><workbookView xWindow="120" yWindow="120" windowWidth="28800" windowHeight="15000"/></bookViews><sheets><sheet name="Course schedule" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    },
    {
      name: "xl/styles.xml",
      contents: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0&quot;%&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><color rgb="FF334155"/><name val="Aptos"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4338CA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>',
    },
    { name: "xl/worksheets/sheet1.xml", contents: worksheet },
  ];

  return {
    filename: `rowo-course-schedule-${filenameDate(generatedAt)}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: createStoredZip(files),
  };
}

function pdfAscii(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7e]/g, "?");
}

function pdfEscape(value: string): string {
  return pdfAscii(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function wrapText(value: string, maxCharacters: number): string[] {
  const words = pdfAscii(value).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if ((line + " " + word).length <= maxCharacters) {
      line += " " + word;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

class PdfLayout {
  private pages: string[][] = [];
  private currentPage: string[] = [];
  private y = 0;

  constructor(
    private readonly title: string,
    private readonly subtitle: string,
    private readonly generatedAt: Date,
  ) {
    this.newPage();
  }

  private newPage(): void {
    this.currentPage = [];
    this.pages.push(this.currentPage);
    this.text(48, 752, "ROWO ACADEMIC", 9, true, [0.263, 0.22, 0.792]);
    this.text(48, 727, this.title, 20, true, [0.059, 0.09, 0.165]);
    this.text(48, 708, this.subtitle, 9, false, [0.392, 0.455, 0.545]);
    this.currentPage.push("0.886 0.91 0.941 RG 0.8 w 48 695 m 564 695 l S");
    this.y = 675;
  }

  private text(
    x: number,
    y: number,
    value: string,
    size: number,
    bold: boolean,
    color: [number, number, number],
  ): void {
    this.currentPage.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${color.join(" ")} rg 1 0 0 1 ${x} ${y} Tm (${pdfEscape(value)}) Tj ET`,
    );
  }

  ensure(height: number): void {
    if (this.y - height < 62) this.newPage();
  }

  gap(points: number): void {
    this.ensure(points);
    this.y -= points;
  }

  rule(): void {
    this.ensure(12);
    this.currentPage.push(
      `0.886 0.91 0.941 RG 0.6 w 48 ${this.y} m 564 ${this.y} l S`,
    );
    this.y -= 12;
  }

  lines(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: [number, number, number];
      indent?: number;
      maxCharacters?: number;
      lineHeight?: number;
    } = {},
  ): void {
    const size = options.size ?? 10;
    const lineHeight = options.lineHeight ?? size + 4;
    const indent = options.indent ?? 0;
    const wrapped = wrapText(value, options.maxCharacters ?? Math.max(25, 91 - indent));
    this.ensure(wrapped.length * lineHeight);
    for (const line of wrapped) {
      this.text(
        48 + indent * 5.5,
        this.y,
        line,
        size,
        options.bold ?? false,
        options.color ?? [0.2, 0.255, 0.333],
      );
      this.y -= lineHeight;
    }
  }

  finish(): Uint8Array {
    const pageCount = this.pages.length;
    const pageObjectIds = this.pages.map((_, index) => 6 + index * 2);
    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];
    this.pages.forEach((page, index) => {
      page.push(
        `BT /F1 8 Tf 0.392 0.455 0.545 rg 1 0 0 1 48 34 Tm (Generated ${pdfEscape(exportDate(this.generatedAt))}) Tj ET`,
        `BT /F1 8 Tf 0.392 0.455 0.545 rg 1 0 0 1 500 34 Tm (Page ${index + 1} of ${pageCount}) Tj ET`,
      );
      const stream = page.join("\n") + "\n";
      const contentObjectId = 5 + index * 2;
      objects.push(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`);
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      );
    });

    const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n%Rowo\n")];
    const offsets = [0];
    let byteOffset = parts[0].length;
    objects.forEach((object, index) => {
      offsets.push(byteOffset);
      const bytes = encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`);
      parts.push(bytes);
      byteOffset += bytes.length;
    });
    const xrefOffset = byteOffset;
    const xref = [
      `xref\n0 ${objects.length + 1}\n`,
      "0000000000 65535 f \n",
      ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
      `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ].join("");
    parts.push(encoder.encode(xref));
    return concatenateBytes(parts);
  }
}

export function createCourseSchedulePdf(
  courses: ScheduleExportCourse[],
  includeGrades: boolean,
  generatedAt = new Date(),
): GeneratedExport {
  const sorted = sortedSchedule(courses);
  const layout = new PdfLayout(
    "Course schedule",
    `${courses.length} ${courses.length === 1 ? "course" : "courses"}${includeGrades ? " | Grades included" : " | Grades omitted"}`,
    generatedAt,
  );
  if (sorted.length === 0) {
    layout.lines("No courses have been added to this academic record yet.", {
      size: 11,
    });
  } else {
    let currentTerm = "";
    for (const course of sorted) {
      if (course.term !== currentTerm) {
        if (currentTerm) layout.gap(7);
        layout.ensure(58);
        layout.lines(course.term || "Unscheduled", {
          size: 12,
          bold: true,
          color: [0.263, 0.22, 0.792],
          lineHeight: 18,
        });
        currentTerm = course.term;
      }
      layout.ensure(48);
      layout.lines(`${course.code} - ${course.title}`, {
        size: 10,
        bold: true,
        maxCharacters: 87,
      });
      const details = [
        scheduleStatusLabels[course.status],
        `${course.credits} ${course.credits === 1 ? "unit" : "units"}`,
      ];
      if (includeGrades) {
        details.push(
          course.grade === null || course.grade === undefined
            ? "Grade: -"
            : `Grade: ${course.grade.toFixed(1)}%`,
        );
      }
      layout.lines(details.join(" | "), {
        size: 9,
        color: [0.392, 0.455, 0.545],
        lineHeight: 15,
      });
      layout.rule();
    }
  }
  return {
    filename: `rowo-course-schedule-${filenameDate(generatedAt)}.pdf`,
    mimeType: "application/pdf",
    bytes: layout.finish(),
  };
}

export function createPlanProgressChecklistPdf(
  programs: ProgressExportProgram[],
  generatedAt = new Date(),
): GeneratedExport {
  const requirementCount = programs.reduce(
    (sum, program) => sum + program.requirements.length,
    0,
  );
  const metCount = programs.reduce(
    (sum, program) =>
      sum + program.requirements.filter((requirement) => requirement.status === "met").length,
    0,
  );
  const layout = new PdfLayout(
    "Plan progress checklist",
    `${programs.length} ${programs.length === 1 ? "plan" : "plans"} | ${metCount} of ${requirementCount} requirements met`,
    generatedAt,
  );
  if (programs.length === 0) {
    layout.lines("No tracked programs are available to export.", { size: 11 });
  }
  for (const program of programs) {
    layout.ensure(72);
    layout.lines(`${program.code} - ${program.title}`, {
      size: 13,
      bold: true,
      color: [0.263, 0.22, 0.792],
      maxCharacters: 82,
      lineHeight: 18,
    });
    const profileDetails = [program.credential, program.faculty].filter(Boolean);
    if (profileDetails.length > 0) {
      layout.lines(profileDetails.join(" | "), {
        size: 9,
        color: [0.392, 0.455, 0.545],
        lineHeight: 15,
      });
    }
    const programMet = program.requirements.filter(
      (requirement) => requirement.status === "met",
    ).length;
    layout.lines(
      `${programMet} of ${program.requirements.length} requirements met`,
      { size: 9, bold: true, lineHeight: 17 },
    );
    layout.rule();

    if (program.requirements.length === 0) {
      layout.lines("No requirement checklist is available for this plan.", {
        size: 9,
        color: [0.392, 0.455, 0.545],
      });
    }
    for (const requirement of program.requirements) {
      layout.ensure(52);
      const checkbox = requirement.status === "met" ? "[x]" : "[ ]";
      layout.lines(
        `${checkbox} ${requirement.title} - ${progressStatusLabels[requirement.status]}`,
        { size: 10, bold: requirement.status === "met", maxCharacters: 88 },
      );
      if (requirement.description) {
        layout.lines(requirement.description, {
          size: 8,
          indent: 4,
          maxCharacters: 95,
          color: [0.392, 0.455, 0.545],
          lineHeight: 12,
        });
      }
      if (requirement.evidence?.length) {
        layout.lines(`Evidence: ${requirement.evidence.join(", ")}`, {
          size: 8,
          indent: 4,
          maxCharacters: 95,
          color: [0.047, 0.42, 0.267],
          lineHeight: 12,
        });
      }
      if (requirement.missing?.length) {
        layout.lines(`Still needed: ${requirement.missing.join(", ")}`, {
          size: 8,
          indent: 4,
          maxCharacters: 95,
          color: [0.706, 0.263, 0.039],
          lineHeight: 12,
        });
      }
      layout.gap(5);
    }
    layout.gap(12);
  }
  return {
    filename: `rowo-plan-progress-${filenameDate(generatedAt)}.pdf`,
    mimeType: "application/pdf",
    bytes: layout.finish(),
  };
}

function asFile(exported: GeneratedExport): File {
  const bytes = new Uint8Array(exported.bytes.length);
  bytes.set(exported.bytes);
  return new File([bytes.buffer], exported.filename, {
    type: exported.mimeType,
    lastModified: Date.now(),
  });
}

export function downloadGeneratedExport(exported: GeneratedExport): void {
  const url = URL.createObjectURL(asFile(exported));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exported.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function shareGeneratedExport(
  exported: GeneratedExport,
): Promise<ShareExportResult> {
  const file = asFile(exported);
  const shareData: ShareData = {
    files: [file],
    title: exported.filename,
    text: "Shared from Rowo Academic",
  };
  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    try {
      await navigator.share(shareData);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return "cancelled";
      }
      throw error;
    }
  }
  downloadGeneratedExport(exported);
  return "downloaded";
}
