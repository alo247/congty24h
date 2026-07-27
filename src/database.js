// src/database.js
// Quản lý CSDL SQLite - Lưu trữ đầy đủ 14 trường thông tin chi tiết của doanh nghiệp
const Database = require('better-sqlite3');
const path = require('path');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const dbDir = isVercel ? '/tmp' : path.join(__dirname, '..');
const dbPath = path.join(dbDir, 'database.db');

const db = new Database(dbPath);

// Tự động khởi tạo bảng và chỉ mục
db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tax_code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        international_name TEXT,
        short_name TEXT,
        representative TEXT,
        address TEXT,
        tax_address TEXT,
        phone TEXT,
        license_date TEXT,
        managed_by TEXT,
        company_type TEXT,
        status TEXT,
        main_business TEXT,
        last_updated_at TEXT,
        raw_html TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tax_code ON companies(tax_code);
    CREATE INDEX IF NOT EXISTS idx_main_business ON companies(main_business);
    CREATE INDEX IF NOT EXISTS idx_address ON companies(address);
`);

// Thêm cột tự động cho CSDL cũ nếu chưa có
try { db.exec('ALTER TABLE companies ADD COLUMN tax_address TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE companies ADD COLUMN company_type TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE companies ADD COLUMN last_updated_at TEXT;'); } catch(e){}

function findCompanyByTaxCode(taxCode) {
    const stmt = db.prepare('SELECT * FROM companies WHERE tax_code = ?');
    return stmt.get(taxCode);
}

function searchCompanies({ taxCodeOrName, location, business }) {
    let sql = 'SELECT * FROM companies WHERE 1=1';
    const params = [];

    if (taxCodeOrName) {
        sql += ' AND (tax_code LIKE ? OR name LIKE ? OR representative LIKE ?)';
        params.push(`%${taxCodeOrName}%`, `%${taxCodeOrName}%`, `%${taxCodeOrName}%`);
    }
    if (location) {
        sql += ' AND (address LIKE ? OR tax_address LIKE ?)';
        params.push(`%${location}%`, `%${location}%`);
    }
    if (business) {
        sql += ' AND main_business LIKE ?';
        params.push(`%${business}%`);
    }

    sql += ' ORDER BY id DESC LIMIT 100';
    const stmt = db.prepare(sql);
    return stmt.all(...params);
}

function saveCompany(companyData) {
    const stmt = db.prepare(`
        INSERT INTO companies (
            tax_code, name, international_name, short_name,
            representative, address, tax_address, phone, license_date,
            managed_by, company_type, status, main_business, last_updated_at, raw_html
        ) VALUES (
            @tax_code, @name, @international_name, @short_name,
            @representative, @address, @tax_address, @phone, @license_date,
            @managed_by, @company_type, @status, @main_business, @last_updated_at, @raw_html
        )
        ON CONFLICT(tax_code) DO UPDATE SET
            name=excluded.name,
            international_name=excluded.international_name,
            short_name=excluded.short_name,
            representative=excluded.representative,
            address=excluded.address,
            tax_address=excluded.tax_address,
            phone=excluded.phone,
            license_date=excluded.license_date,
            managed_by=excluded.managed_by,
            company_type=excluded.company_type,
            status=excluded.status,
            main_business=excluded.main_business,
            last_updated_at=excluded.last_updated_at,
            updated_at=CURRENT_TIMESTAMP
    `);
    return stmt.run({
        tax_address: '',
        company_type: '',
        last_updated_at: '',
        ...companyData
    });
}

module.exports = {
    db,
    findCompanyByTaxCode,
    searchCompanies,
    saveCompany
};
