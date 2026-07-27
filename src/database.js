// src/database.js
// Quản lý cơ sở dữ liệu SQLite - Tương thích mượt mà cả trên Local lẫn Vercel Serverless
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Kiểm tra nếu đang chạy trong môi trường Serverless Vercel (chỉ cho phép ghi ở /tmp)
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dbDir = isVercel ? '/tmp' : path.join(__dirname, '..');
const dbPath = path.join(dbDir, 'database.db');

// Khởi tạo kết nối SQLite
const db = new Database(dbPath);

// Tự động khởi tạo bảng và chỉ mục tối ưu hóa tốc độ tìm kiếm
db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tax_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        international_name TEXT,
        short_name TEXT,
        representative TEXT,
        address TEXT,
        phone TEXT,
        license_date TEXT,
        managed_by TEXT,
        status TEXT,
        main_business TEXT,
        raw_html TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tax_code ON companies(tax_code);
    CREATE INDEX IF NOT EXISTS idx_main_business ON companies(main_business);
    CREATE INDEX IF NOT EXISTS idx_address ON companies(address);
`);

/**
 * Tìm kiếm công ty theo Mã số thuế chính xác
 * @param {string} taxCode 
 * @returns {object|undefined}
 */
function findCompanyByTaxCode(taxCode) {
    const stmt = db.prepare('SELECT * FROM companies WHERE tax_code = ?');
    return stmt.get(taxCode);
}

/**
 * Tìm kiếm danh sách công ty theo Từ khóa, Địa điểm hoặc Ngành nghề
 * @param {object} param0 
 * @returns {array}
 */
function searchCompanies({ taxCodeOrName, location, business }) {
    let sql = 'SELECT * FROM companies WHERE 1=1';
    const params = [];

    if (taxCodeOrName) {
        sql += ' AND (tax_code LIKE ? OR name LIKE ?)';
        params.push(`%${taxCodeOrName}%`, `%${taxCodeOrName}%`);
    }
    if (location) {
        sql += ' AND address LIKE ?';
        params.push(`%${location}%`);
    }
    if (business) {
        sql += ' AND main_business LIKE ?';
        params.push(`%${business}%`);
    }

    sql += ' ORDER BY id DESC LIMIT 100';
    const stmt = db.prepare(sql);
    return stmt.all(...params);
}

/**
 * Lưu hoặc cập nhật thông tin công ty vào CSDL SQLite
 * @param {object} companyData 
 * @returns {object}
 */
function saveCompany(companyData) {
    const stmt = db.prepare(`
        INSERT INTO companies (
            tax_code, name, international_name, short_name,
            representative, address, phone, license_date,
            managed_by, status, main_business, raw_html
        ) VALUES (
            @tax_code, @name, @international_name, @short_name,
            @representative, @address, @phone, @license_date,
            @managed_by, @status, @main_business, @raw_html
        )
        ON CONFLICT(tax_code) DO UPDATE SET
            name=excluded.name,
            international_name=excluded.international_name,
            short_name=excluded.short_name,
            representative=excluded.representative,
            address=excluded.address,
            phone=excluded.phone,
            license_date=excluded.license_date,
            managed_by=excluded.managed_by,
            status=excluded.status,
            main_business=excluded.main_business,
            updated_at=CURRENT_TIMESTAMP
    `);
    return stmt.run(companyData);
}

module.exports = {
    db,
    findCompanyByTaxCode,
    searchCompanies,
    saveCompany
};
