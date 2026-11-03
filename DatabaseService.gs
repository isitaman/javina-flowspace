/**
 * FlowSpace - DatabaseService.gs
 * Utilitas baca/tulis Google Sheets. Satu-satunya tempat menyentuh sheet langsung.
 */

var DatabaseService = {
  /**
   * Dapatkan ID spreadsheet aktif dari script properties.
   * Jika belum ada, kembalikan null (perlu setup).
   */
  getSpreadsheetId: function () {
    return PropertiesService.getScriptProperties().getProperty(CONFIG.SPREADSHEET_PROPERTY_KEY);
  },

  /**
   * Set ID spreadsheet aktif.
   */
  setSpreadsheetId: function (id) {
    PropertiesService.getScriptProperties().setProperty(CONFIG.SPREADSHEET_PROPERTY_KEY, id);
  },

  /**
   * Buka spreadsheet aktif.
   */
  getSpreadsheet: function () {
    var id = this.getSpreadsheetId();
    if (!id) throw new Error('Spreadsheet belum di-setup. Jalankan setupDatabase() dulu.');
    return SpreadsheetApp.openById(id);
  },

  /**
   * Pastikan semua sheet dan header sudah benar.
   * Dipanggil saat setup.
   */
  ensureSheets: function () {
    var ss = this.getSpreadsheet();
    var existingSheets = {};
    ss.getSheets().forEach(function (s) {
      existingSheets[s.getName()] = s;
    });

    Object.keys(CONFIG.HEADERS).forEach(function (sheetName) {
      var headers = CONFIG.HEADERS[sheetName];
      var sheet;
      if (existingSheets[sheetName]) {
        sheet = existingSheets[sheetName];
        // Cek apakah header sudah benar
        var existingHeader = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
        var needRewrite = false;
        for (var i = 0; i < headers.length; i++) {
          if (existingHeader[i] !== headers[i]) {
            needRewrite = true;
            break;
          }
        }
        if (needRewrite) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        }
      } else {
        sheet = ss.insertSheet(sheetName);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        // Bold + freeze header
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        sheet.setFrozenRows(1);
      }
    });

    // Hapus sheet default "Sheet1" jika ada
    var defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      ss.deleteSheet(defaultSheet);
    }
  },

  /**
   * Baca semua baris dari sebuah sheet, return array object.
   */
  readAll: function (sheetName) {
    var ss = this.getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return []; // hanya header
    var lastCol = sheet.getLastColumn();
    var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var headers = CONFIG.HEADERS[sheetName] || sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    return values.map(function (row) {
      var obj = {};
      for (var i = 0; i < headers.length; i++) {
        obj[headers[i]] = row[i];
      }
      return obj;
    });
  },

  /**
   * Cari baris berdasarkan field tertentu, return array object.
   */
  findBy: function (sheetName, field, value) {
    return this.readAll(sheetName).filter(function (r) {
      return String(r[field]) === String(value);
    });
  },

  /**
   * Cari satu baris berdasarkan ID (kolom pertama biasanya).
   */
  findById: function (sheetName, idFieldName, idValue) {
    var matches = this.findBy(sheetName, idFieldName, idValue);
    return matches.length > 0 ? matches[0] : null;
  },

  /**
   * Tambah baris baru ke sheet.
   * @param {string} sheetName
   * @param {Object} data - object dengan key = nama header
   * @return {Object} data yang ditambahkan
   */
  insert: function (sheetName, data) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      var ss = this.getSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      var headers = CONFIG.HEADERS[sheetName];
      var row = headers.map(function (h) {
        var v = data[h];
        if (v === undefined || v === null) return '';
        return v;
      });
      sheet.appendRow(row);
      return data;
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  },

  /**
   * Update baris berdasarkan ID.
   * @param {string} sheetName
   * @param {string} idFieldName
   * @param {string} idValue
   * @param {Object} patch - field yang ingin diubah
   * @return {boolean} sukses atau tidak
   */
  update: function (sheetName, idFieldName, idValue, patch) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      var ss = this.getSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      var headers = CONFIG.HEADERS[sheetName];
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return false;
      var lastCol = sheet.getLastColumn();
      var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var idColIndex = headers.indexOf(idFieldName);
      if (idColIndex === -1) return false;

      var updated = false;
      for (var r = 1; r < allValues.length; r++) {
        if (String(allValues[r][idColIndex]) === String(idValue)) {
          // Update field yang ada di patch
          for (var c = 0; c < headers.length; c++) {
            var field = headers[c];
            if (patch.hasOwnProperty(field) && patch[field] !== undefined) {
              sheet.getRange(r + 1, c + 1).setValue(patch[field]);
            }
          }
          updated = true;
          break;
        }
      }
      return updated;
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  },

  /**
   * Hapus baris berdasarkan ID.
   */
  remove: function (sheetName, idFieldName, idValue) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      var ss = this.getSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      var headers = CONFIG.HEADERS[sheetName];
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return false;
      var lastCol = sheet.getLastColumn();
      var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var idColIndex = headers.indexOf(idFieldName);
      if (idColIndex === -1) return false;

      for (var r = 1; r < allValues.length; r++) {
        if (String(allValues[r][idColIndex]) === String(idValue)) {
          sheet.deleteRow(r + 1);
          return true;
        }
      }
      return false;
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  },

  /**
   * Batch insert - lebih efisien untuk banyak baris.
   */
  batchInsert: function (sheetName, dataArray) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      var ss = this.getSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      var headers = CONFIG.HEADERS[sheetName];
      var rows = dataArray.map(function (data) {
        return headers.map(function (h) {
          var v = data[h];
          if (v === undefined || v === null) return '';
          return v;
        });
      });
      if (rows.length === 0) return;
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rows.length, headers.length).setValues(rows);
      return dataArray;
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  },

  /**
   * Hapus semua baris yang cocok dengan field tertentu.
   */
  removeBy: function (sheetName, field, value) {
    var lock = LockService.getScriptLock();
    try {
      lock.waitLock(10000);
      var ss = this.getSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      var headers = CONFIG.HEADERS[sheetName];
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return 0;
      var lastCol = sheet.getLastColumn();
      var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var colIndex = headers.indexOf(field);
      if (colIndex === -1) return 0;

      // Hapus dari bawah ke atas agar index tidak tergeser
      var removed = 0;
      for (var r = allValues.length - 1; r >= 1; r--) {
        if (String(allValues[r][colIndex]) === String(value)) {
          sheet.deleteRow(r + 1);
          removed++;
        }
      }
      return removed;
    } finally {
      try { lock.releaseLock(); } catch (e) {}
    }
  },
};
