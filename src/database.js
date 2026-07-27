// src/database.js
// Quản lý CSDL SQLite - Tự động Seed CSDL trên Vercel & Tìm kiếm Không Dấu Đa Từ (Multi-Word Accent-Insensitive Search)
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const rootDbPath = path.join(__dirname, '..', 'database.db');
const dbDir = isVercel ? '/tmp' : path.join(__dirname, '..');
const dbPath = path.join(dbDir, 'database.db');

// Nếu trên Vercel Serverless, tự động copy file CSDL đã bundle từ gốc vào /tmp trên Cold Start
if (isVercel) {
    try {
        if (!fs.existsSync(dbPath) && fs.existsSync(rootDbPath)) {
            fs.copyFileSync(rootDbPath, dbPath);
            console.log('[Vercel Seed] Đã copy CSDL database.db từ root vào /tmp/database.db thành công!');
        }
    } catch (err) {
        console.error('[Vercel Seed Error]', err.message);
    }
}

const db = new Database(dbPath);

/**
 * Loại bỏ dấu tiếng Việt để phục vụ tìm kiếm không dấu
 */
function removeVietnameseTones(str) {
    if (!str) return '';
    str = str.replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a");
    str = str.replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e");
    str = str.replace(/ì|í|ị|ỉ|ĩ/g, "i");
    str = str.replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o");
    str = str.replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u");
    str = str.replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y");
    str = str.replace(/đ/g, "d");
    str = str.replace(/À|Á|Ạ|Ả|Ã|Â|Ầ|Ấ|Ậ|Ẩ|Ẫ|Ă|Ằ|Ắ|Ặ|Ẳ|Ẵ/g, "a");
    str = str.replace(/È|É|Ẹ|Ẻ|Ẽ|Ê|Ề|Ế|Ệ|Ể|Ễ/g, "e");
    str = str.replace(/Ì|Í|Ị|Ỉ|Ĩ/g, "i");
    str = str.replace(/Ò|Ó|Ọ|Ỏ|Õ|Ô|Ồ|Ố|Ộ|Ổ|Ỗ|Ơ|Ờ|Ớ|Ợ|Ở|Ỡ/g, "o");
    str = str.replace(/Ù|Ú|Ụ|Ủ|Ũ|Ư|Ừ|Ứ|Ự|Ử|Ữ/g, "u");
    str = str.replace(/Ỳ|Ý|Ỵ|Ỷ|Ỹ/g, "y");
    str = str.replace(/Đ/g, "d");
    return str.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function generateTvplUrl(taxCode, name) {
    if (!taxCode) return '';
    const cleanName = name || 'doanh-nghiep';
    const slug = removeVietnameseTones(cleanName).replace(/\s+/g, '-');
    return `https://thuvienphapluat.vn/ma-so-thue/${slug}-mst-${taxCode}.html`;
}

function generateSearchText(c) {
    const raw = [
        c.tax_code,
        c.name,
        c.international_name,
        c.short_name,
        c.representative,
        c.address,
        c.tax_address,
        c.main_business
    ].filter(Boolean).join(' ');

    return (raw + ' ' + removeVietnameseTones(raw)).toLowerCase();
}

// Khởi tạo bảng
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
        tvpl_url TEXT,
        search_text TEXT,
        raw_html TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

try { db.exec('ALTER TABLE companies ADD COLUMN tax_address TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE companies ADD COLUMN company_type TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE companies ADD COLUMN last_updated_at TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE companies ADD COLUMN tvpl_url TEXT;'); } catch(e){}
try { db.exec('ALTER TABLE companies ADD COLUMN search_text TEXT;'); } catch(e){}

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tax_code ON companies(tax_code);
    CREATE INDEX IF NOT EXISTS idx_main_business ON companies(main_business);
    CREATE INDEX IF NOT EXISTS idx_address ON companies(address);
    CREATE INDEX IF NOT EXISTS idx_search_text ON companies(search_text);
`);

function findCompanyByTaxCode(taxCode) {
    const stmt = db.prepare('SELECT * FROM companies WHERE tax_code = ?');
    return stmt.get(taxCode);
}

/**
 * Tra cứu CSDL SQLite với thuật toán lọc đa từ không dấu (Multi-Word Unaccented Search)
 */
function searchCompanies({ taxCodeOrName, location, business }) {
    let sql = 'SELECT * FROM companies WHERE 1=1';
    const params = [];

    const applyWordFilter = (inputStr) => {
        if (!inputStr) return;
        const norm = removeVietnameseTones(inputStr);
        const words = norm.split(' ').filter(w => w.length > 0);

        words.forEach(word => {
            sql += ' AND (tax_code LIKE ? OR name LIKE ? OR search_text LIKE ?)';
            params.push(`%${word}%`, `%${word}%`, `%${word}%`);
        });
    };

    if (taxCodeOrName) {
        applyWordFilter(taxCodeOrName);
    }
    if (location) {
        applyWordFilter(location);
    }
    if (business) {
        applyWordFilter(business);
    }

    sql += ' ORDER BY id DESC LIMIT 100';
    const stmt = db.prepare(sql);
    return stmt.all(...params);
}

function saveCompany(companyData) {
    const searchText = generateSearchText(companyData);
    const tvplUrl = companyData.tvpl_url || generateTvplUrl(companyData.tax_code, companyData.name);

    const stmt = db.prepare(`
        INSERT INTO companies (
            tax_code, name, international_name, short_name,
            representative, address, tax_address, phone, license_date,
            managed_by, company_type, status, main_business, last_updated_at, tvpl_url, search_text, raw_html
        ) VALUES (
            @tax_code, @name, @international_name, @short_name,
            @representative, @address, @tax_address, @phone, @license_date,
            @managed_by, @company_type, @status, @main_business, @last_updated_at, @tvpl_url, @search_text, @raw_html
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
            tvpl_url=excluded.tvpl_url,
            search_text=excluded.search_text,
            updated_at=CURRENT_TIMESTAMP
    `);

    return stmt.run({
        tax_address: '',
        company_type: '',
        last_updated_at: '',
        raw_html: '',
        ...companyData,
        tvpl_url: tvplUrl,
        search_text: searchText
    });
}

module.exports = {
    db,
    findCompanyByTaxCode,
    searchCompanies,
    saveCompany,
    removeVietnameseTones,
    generateTvplUrl
};
