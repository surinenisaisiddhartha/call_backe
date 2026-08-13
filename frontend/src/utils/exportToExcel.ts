/**
 * Utility to export tabular data to Microsoft Excel compatible CSV format.
 * Includes UTF-8 Byte Order Mark (\uFEFF) so Excel opens it with proper encoding and column formatting.
 */

export interface ExportColumn<T = any> {
  header: string;
  key: keyof T | ((row: T) => any);
}

export function exportToExcel<T = any>(
  data: T[],
  columns: ExportColumn<T>[],
  fileName: string
) {
  if (!data || data.length === 0) {
    alert('No data available to export.');
    return;
  }

  // 1. Build Header Row
  const headers = columns.map(c => escapeCSVCell(c.header));
  const csvRows: string[] = [headers.join(',')];

  // 2. Build Data Rows
  for (const row of data) {
    const rowValues = columns.map(col => {
      let val: any = '';
      if (typeof col.key === 'function') {
        val = col.key(row);
      } else if (col.key && row[col.key] !== undefined && row[col.key] !== null) {
        val = row[col.key];
      }
      return escapeCSVCell(val);
    });
    csvRows.push(rowValues.join(','));
  }

  // 3. Add UTF-8 BOM (\uFEFF) so Excel parses Unicode/special characters correctly
  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  const formattedFileName = fileName.endsWith('.csv') ? fileName : `${fileName}_${new Date().toISOString().slice(0, 10)}.csv`;
  
  link.setAttribute('href', url);
  link.setAttribute('download', formattedFileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function escapeCSVCell(value: any): string {
  if (value === null || value === undefined) {
    return '""';
  }
  
  let str = String(value);
  // Replace line breaks with spaces for clean Excel cells
  str = str.replace(/\r?\n|\r/g, ' ');
  
  // Escape quotes
  str = str.replace(/"/g, '""');
  
  return `"${str}"`;
}
