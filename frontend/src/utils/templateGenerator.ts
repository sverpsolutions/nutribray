import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

// Column definitions with mandatory/optional flags
const COLUMNS = [
  { header: 'ITEM CODE',        key: 'item_code',     mandatory: true,  width: 14 },
  { header: 'ITEM NAME',        key: 'item_name',     mandatory: true,  width: 28 },
  { header: 'BILL PRINT NAME',  key: 'bill_print',    mandatory: false, width: 22 },
  { header: 'FULL ITEM NAME',   key: 'full_name',     mandatory: false, width: 30 },
  { header: 'GROUP',            key: 'group',         mandatory: true,  width: 16 },
  { header: 'SUB GROUP',        key: 'subgroup',      mandatory: true,  width: 16 },
  { header: 'CATEGORY',         key: 'category',      mandatory: true,  width: 18 },
  { header: 'SUB CATEGORY',     key: 'subcategory',   mandatory: true,  width: 18 },
  { header: 'BRAND',            key: 'brand',         mandatory: true,  width: 16 },
  { header: 'SUB BRAND',        key: 'subbrand',      mandatory: false, width: 16 },
  { header: 'VARIANT',          key: 'variant',       mandatory: false, width: 14 },
  { header: 'FLAVOUR',          key: 'flavour',       mandatory: false, width: 14 },
  { header: 'MANUFACTURE',      key: 'manufacture',   mandatory: false, width: 18 },
  { header: 'SUB MANUFACTURE',  key: 'sub_mfg',       mandatory: false, width: 18 },
  { header: 'CLASSIFICATION',   key: 'classification', mandatory: false, width: 16 },
  { header: 'BASE UOM',         key: 'base_uom',     mandatory: true,  width: 12 },
  { header: 'PURCHASE UOM',     key: 'purchase_uom',  mandatory: false, width: 14 },
  { header: 'SALES UOM',        key: 'sales_uom',    mandatory: false, width: 12 },
  { header: 'INNER PACK',       key: 'inner_pack',   mandatory: false, width: 12 },
  { header: 'OUTER CARTON',     key: 'outer_carton',  mandatory: false, width: 14 },
  { header: 'GST %',            key: 'gst',           mandatory: true,  width: 10 },
  { header: 'HSN CODE',         key: 'hsn',           mandatory: false, width: 14 },
  { header: 'BARCODE',          key: 'barcode',       mandatory: true,  width: 18 },
  { header: 'MRP',              key: 'mrp',           mandatory: true,  width: 10 },
  { header: 'COST PRICE',       key: 'cost',          mandatory: false, width: 12 },
  { header: 'SALE PRICE',       key: 'sale',          mandatory: false, width: 12 },
  { header: 'STORAGE TYPE',     key: 'storage',       mandatory: false, width: 14 },
  { header: 'TEMPERATURE TYPE', key: 'temp',          mandatory: false, width: 18 },
  { header: 'ACTIVE STATUS',    key: 'status',        mandatory: true,  width: 14 },
];

const SAMPLE = [
  'FMCG001','Amul Butter 500g','Amul Butter 500g','Amul Butter 500g Salted',
  'FMCG Food','Grocery','Dairy Product','Butter','Amul','Butter','500gm','Salted',
  'AMUL','','Regular','PCS','PCS','PCS','12','6','12','04051000','8901234567890',
  '250','210','240','Dry','Normal','ACTIVE'
];

// Colors
const RED_BG   = 'FFD32F2F'; // Mandatory header bg
const RED_FG   = 'FFFFFFFF'; // Mandatory header text
const BLUE_BG  = 'FF1565C0'; // Optional header bg
const BLUE_FG  = 'FFFFFFFF'; // Optional header text
const RED_FILL = 'FFFFEBEE'; // Mandatory column tint
const BLUE_FILL= 'FFE3F2FD'; // Optional column tint
const TITLE_BG = 'FF0D47A1'; // Title row

export async function downloadProfessionalTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Nutribay ERP';
  wb.created = new Date();

  // ── Sheet 1: Item Master ──────────────────────────────────────────
  const ws = wb.addWorksheet('Item Master', {
    views: [{ state: 'frozen', ySplit: 3 }]
  });

  // Row 1: Title
  const titleRow = ws.addRow(['NUTRIBAY — PRODUCT IMPORT TEMPLATE']);
  ws.mergeCells(1, 1, 1, COLUMNS.length);
  titleRow.height = 36;
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG } };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 2: Legend
  const legendRow = ws.addRow([
    '🔴 RED = MANDATORY FIELD    |    🔵 BLUE = OPTIONAL FIELD    |    Fill all RED columns for successful import'
  ]);
  ws.mergeCells(2, 1, 2, COLUMNS.length);
  legendRow.height = 24;
  legendRow.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF424242' } };
  legendRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF9C4' } };
  legendRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

  // Row 3: Column Headers
  const headerRow = ws.addRow(COLUMNS.map(c => c.header));
  headerRow.height = 28;
  COLUMNS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    const isMandatory = col.mandatory;
    cell.font = { bold: true, size: 10, color: { argb: isMandatory ? RED_FG : BLUE_FG } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isMandatory ? RED_BG : BLUE_BG } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9E9E9E' } },
      bottom: { style: 'medium', color: { argb: 'FF424242' } },
      left: { style: 'thin', color: { argb: 'FF9E9E9E' } },
      right: { style: 'thin', color: { argb: 'FF9E9E9E' } },
    };
    ws.getColumn(i + 1).width = col.width;
  });

  // Row 4: Sample data
  const sampleRow = ws.addRow(SAMPLE);
  sampleRow.height = 22;
  COLUMNS.forEach((col, i) => {
    const cell = sampleRow.getCell(i + 1);
    cell.font = { size: 10, italic: true, color: { argb: 'FF616161' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.mandatory ? RED_FILL : BLUE_FILL } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFBDBDBD' } },
      left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
      right: { style: 'thin', color: { argb: 'FFE0E0E0' } },
    };
  });

  // Add 100 empty rows with column tinting
  for (let r = 0; r < 100; r++) {
    const row = ws.addRow([]);
    row.height = 20;
    COLUMNS.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.mandatory ? RED_FILL : BLUE_FILL } };
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFE0E0E0' } },
        left: { style: 'hair', color: { argb: 'FFE0E0E0' } },
        right: { style: 'hair', color: { argb: 'FFE0E0E0' } },
      };
    });
  }

  // ── Sheet 2: Legend / Instructions ────────────────────────────────
  const helpWs = wb.addWorksheet('Instructions');
  helpWs.getColumn(1).width = 25;
  helpWs.getColumn(2).width = 60;

  const helpTitle = helpWs.addRow(['IMPORT INSTRUCTIONS']);
  helpWs.mergeCells(1, 1, 1, 2);
  helpTitle.getCell(1).font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  helpTitle.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TITLE_BG } };
  helpTitle.height = 32;

  const instructions = [
    ['🔴 Mandatory Fields', 'RED columns must be filled. Rows with missing mandatory data will fail.'],
    ['🔵 Optional Fields', 'BLUE columns can be left empty. System will use defaults.'],
    ['ITEM CODE', 'Unique code for each product (e.g., FMCG001)'],
    ['ITEM NAME', 'Short product name for billing display'],
    ['GROUP → SUB CATEGORY', 'Must follow hierarchy: Group > Sub Group > Category > Sub Category'],
    ['BRAND', 'Brand under which the product is sold'],
    ['BASE UOM', 'Base unit of measurement: PCS, KG, LTR, BOX, etc.'],
    ['GST %', 'GST rate: 0, 5, 12, 18, 28'],
    ['BARCODE', 'Unique EAN/UPC barcode number'],
    ['MRP', 'Maximum Retail Price'],
    ['ACTIVE STATUS', 'ACTIVE or INACTIVE'],
    ['AUTO-CREATE', 'Enable "Auto-create masters" to auto-add missing Groups/Brands etc.'],
  ];
  instructions.forEach(([a, b]) => {
    const r = helpWs.addRow([a, b]);
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(2).font = { size: 10, color: { argb: 'FF616161' } };
    r.getCell(2).alignment = { wrapText: true };
    r.height = 24;
  });

  // Generate & download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, 'Nutribay_Product_Import_Template.xlsx');
}
