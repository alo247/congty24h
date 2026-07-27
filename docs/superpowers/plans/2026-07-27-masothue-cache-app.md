# Masothue Cache App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng web ứng dụng tra cứu mã số thuế doanh nghiệp với cơ chế Lazy-Caching Scraping bằng Node.js, SQLite3 và Express.

**Architecture:** Node.js Express server kết nối với CSDL SQLite (qua `better-sqlite3`). Khi tra cứu MST hoặc Ngành nghề / Địa điểm, hệ thống sẽ query CSDL trước. Nếu thiếu dữ liệu, Worker Cheerio sẽ tự động cào dữ liệu từ masothue.com, ghi vào CSDL SQLite và phản hồi kết quả về Frontend.

**Tech Stack:** Node.js, Express, better-sqlite3, cheerio, axios, HTML5/CSS3/JS.

## Global Constraints

- Ngôn ngữ phản hồi và comment trong code: Tiếng Việt 100%.
- CSDL phải thiết lập Index cho cột `tax_code`, `main_business`, `address`.
- Hỗ trợ xuất dữ liệu ra file CSV mã hóa UTF-8 BOM.

---

### Task 1: Khởi tạo dự án & Cấu hình CSDL SQLite

**Files:**
- Create: `package.json`
- Create: `src/database.js`
- Create: `tests/database.test.js`

**Interfaces:**
- Consumes: None
- Produces: `getDb()`, `findCompanyByTaxCode(taxCode)`, `searchCompanies(query)`, `saveCompany(companyData)`

- [ ] **Step 1: Khởi tạo package.json**
Run command: `npm init -y`

- [ ] **Step 2: Cài đặt dependencies**
Run command: `npm install express better-sqlite3 cheerio axios cors dotenv`

- [ ] **Step 3: Viết module CSDL SQLite (`src/database.js`)**

```javascript
// src/database.js
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../database.db');
const db = new Database(dbPath);

// Khởi tạo bảng và chỉ mục
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

function findCompanyByTaxCode(taxCode) {
    const stmt = db.prepare('SELECT * FROM companies WHERE tax_code = ?');
    return stmt.get(taxCode);
}

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
```

- [ ] **Step 4: Viết test cho database module**

```javascript
// tests/database.test.js
const { findCompanyByTaxCode, saveCompany } = require('../src/database');

const testCompany = {
    tax_code: '0101234567',
    name: 'CÔNG TY TNHH THỬ NGHIỆM',
    international_name: 'TESTING CO., LTD',
    short_name: 'TEST CO',
    representative: 'Nguyễn Văn A',
    address: 'Hà Nội',
    phone: '0901234567',
    license_date: '2020-01-01',
    managed_by: 'Chi cục Thuế Hà Nội',
    status: 'Đang hoạt động',
    main_business: 'Lập trình máy tính',
    raw_html: ''
};

saveCompany(testCompany);
const result = findCompanyByTaxCode('0101234567');
console.log('Test Insert/Select Result:', result.name === testCompany.name ? 'PASS' : 'FAIL');
```

- [ ] **Step 5: Test module CSDL**
Run: `node tests/database.test.js`
Expected output: `Test Insert/Select Result: PASS`

---

### Task 2: Xây dựng Scraper Worker (Cheerio + Axios)

**Files:**
- Create: `src/scraper.js`
- Create: `tests/scraper.test.js`

**Interfaces:**
- Consumes: None
- Produces: `scrapeCompanyDetail(taxCode)`, `scrapeSearchList(keyword)`

- [ ] **Step 1: Viết module Scraper (`src/scraper.js`)**

```javascript
// src/scraper.js
const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://masothue.com/'
};

async function scrapeCompanyDetail(taxCode) {
    try {
        const url = `https://masothue.com/Search/?q=${encodeURIComponent(taxCode)}&type=auto`;
        const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        const company = {
            tax_code: taxCode,
            name: $('th[span="2"]').text().trim() || $('h1.title-tax-code').text().trim() || $('table.table-taxinfo thead th').text().trim(),
            international_name: '',
            short_name: '',
            representative: '',
            address: '',
            phone: '',
            license_date: '',
            managed_by: '',
            status: 'Đang hoạt động',
            main_business: '',
            raw_html: response.data
        };

        // Scrape table content
        $('table.table-taxinfo tbody tr').each((i, el) => {
            const label = $(el).find('td').eq(0).text().trim();
            const value = $(el).find('td').eq(1).text().trim();

            if (label.includes('Tên quốc tế')) company.international_name = value;
            if (label.includes('Tên viết tắt')) company.short_name = value;
            if (label.includes('Người đại diện')) company.representative = $(el).find('td').eq(1).find('a').text().trim() || value;
            if (label.includes('Địa chỉ')) company.address = value;
            if (label.includes('Điện thoại')) company.phone = value;
            if (label.includes('Ngày cấp') || label.includes('Ngày hoạt động')) company.license_date = value;
            if (label.includes('Quản lý bởi')) company.managed_by = value;
            if (label.includes('Trạng thái')) company.status = value;
            if (label.includes('Ngành nghề')) company.main_business = value;
        });

        if (!company.name) {
            // Fallback header title
            company.name = $('h1').first().text().trim();
        }

        return company;
    } catch (error) {
        console.error(`Lỗi cào dữ liệu cho MST ${taxCode}:`, error.message);
        return null;
    }
}

module.exports = {
    scrapeCompanyDetail
};
```

- [ ] **Step 2: Viết test cho Scraper Worker**

```javascript
// tests/scraper.test.js
const { scrapeCompanyDetail } = require('../src/scraper');

async function testScraper() {
    console.log('Đang cào dữ liệu thử nghiệm cho MST 0100109106 (Viettel)...');
    const data = await scrapeCompanyDetail('0100109106');
    console.log('Kết quả cào:', data);
}

testScraper();
```

---

### Task 3: Xây dựng Backend Express API Server

**Files:**
- Create: `src/server.js`

**Interfaces:**
- Consumes: `src/database.js`, `src/scraper.js`
- Produces: REST Endpoints `/api/company/:taxCode`, `/api/companies/search`, `/api/export/csv`

- [ ] **Step 1: Viết Express Server (`src/server.js`)**

```javascript
// src/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { findCompanyByTaxCode, searchCompanies, saveCompany } = require('./database');
const { scrapeCompanyDetail } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Tra cứu theo Mã số thuế (Lazy-Caching)
app.get('/api/company/:taxCode', async (req, res) => {
    const { taxCode } = req.params;
    const cleanTaxCode = taxCode.trim();

    // 1. Check CSDL trước
    let company = findCompanyByTaxCode(cleanTaxCode);
    if (company) {
        return res.json({ success: true, from_cache: true, data: company });
    }

    // 2. Chưa có -> Kích hoạt Cào dữ liệu
    console.log(`[Cache Miss] Cào dữ liệu tươi cho MST: ${cleanTaxCode}`);
    const scrapedData = await scrapeCompanyDetail(cleanTaxCode);

    if (scrapedData && scrapedData.name) {
        saveCompany(scrapedData);
        const savedCompany = findCompanyByTaxCode(cleanTaxCode);
        return res.json({ success: true, from_cache: false, data: savedCompany });
    } else {
        return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin mã số thuế này.' });
    }
});

// API Tra cứu theo Từ khóa / Ngành nghề / Địa điểm
app.get('/api/companies/search', (req, res) => {
    const { query, location, business } = req.query;
    const results = searchCompanies({ taxCodeOrName: query, location, business });
    res.json({ success: true, count: results.length, data: results });
});

// API Xuất dữ liệu ra file CSV (Tương thích Google Sheets / Excel)
app.get('/api/export/csv', (req, res) => {
    const { query, location, business } = req.query;
    const companies = searchCompanies({ taxCodeOrName: query, location, business });

    // UTF-8 BOM
    let csv = '\uFEFF';
    csv += 'Mã Số Thuế,Tên Công Ty,Tên Quốc Tế,Người Đại Diện,Địa Chỉ,Điện Thoại,Trạng Thái,Ngành Nghề,Ngày Cấp\n';

    companies.forEach(c => {
        const row = [
            `"${c.tax_code || ''}"`,
            `"${(c.name || '').replace(/"/g, '""')}"`,
            `"${(c.international_name || '').replace(/"/g, '""')}"`,
            `"${(c.representative || '').replace(/"/g, '""')}"`,
            `"${(c.address || '').replace(/"/g, '""')}"`,
            `"${c.phone || ''}"`,
            `"${c.status || ''}"`,
            `"${(c.main_business || '').replace(/"/g, '""')}"`,
            `"${c.license_date || ''}"`
        ];
        csv += row.join(',') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_cong_ty.csv');
    res.send(csv);
});

app.listen(PORT, () => {
    console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
```

---

### Task 4: Xây dựng Giao diện Frontend UI

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

- [ ] **Step 1: Tạo file `public/index.html`**

```html
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Hệ Thống Tra Cứu & Cào Dữ Liệu Mã Số Thuế</title>
    <link rel="stylesheet" href="styles.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
    <div class="container">
        <header>
            <h1>🏢 Tra Cứu Mã Số Thuế Doanh Nghiệp</h1>
            <p class="subtitle">Hệ thống Lazy-Caching Scraping tự động nạp & lưu CSDL thông minh</p>
        </header>

        <section class="search-card">
            <form id="searchForm">
                <div class="input-group">
                    <input type="text" id="taxInput" placeholder="Nhập Mã số thuế hoặc Tên công ty...">
                    <input type="text" id="locationInput" placeholder="Địa điểm (Tỉnh/Thành, Quận)...">
                    <input type="text" id="businessInput" placeholder="Ngành nghề kinh doanh...">
                    <button type="submit" id="btnSearch">🔍 Tra cứu & Cào</button>
                </div>
            </form>
        </section>

        <section class="actions-bar">
            <div class="status-info" id="statusCount">Đang tải dữ liệu...</div>
            <button id="btnExport" class="btn-export">📥 Xuất Excel / Google Sheets (CSV)</button>
        </section>

        <section class="results-section">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>MST</th>
                            <th>Tên Doanh Nghiệp</th>
                            <th>Người Đại Diện</th>
                            <th>Địa Chỉ</th>
                            <th>Ngành Nghề</th>
                            <th>Nguồn Dữ Liệu</th>
                        </tr>
                    </thead>
                    <tbody id="resultsBody">
                        <tr><td colspan="6" class="empty">Nhập từ khóa hoặc Mã số thuế để tra cứu</td></tr>
                    </tbody>
                </table>
            </div>
        </section>
    </div>

    <!-- Modal Chi tiết -->
    <div id="detailModal" class="modal">
        <div class="modal-content">
            <span class="close-btn">&times;</span>
            <h2 id="modalTitle">Chi tiết Doanh nghiệp</h2>
            <div id="modalBody" class="modal-body-content"></div>
        </div>
    </div>

    <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Tạo CSS Glassmorphism (`public/styles.css`)**

```css
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: 'Inter', sans-serif;
}

body {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #f8fafc;
    min-height: 100vh;
    padding: 2rem;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
}

header {
    text-align: center;
    margin-bottom: 2rem;
}

header h1 {
    font-size: 2.2rem;
    font-weight: 700;
    background: linear-gradient(90deg, #38bdf8, #818cf8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}

.subtitle {
    color: #94a3b8;
    margin-top: 0.5rem;
}

.search-card {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
}

.input-group {
    display: grid;
    grid-template-columns: 2fr 1.5fr 1.5fr 1fr;
    gap: 1rem;
}

input {
    background: #0f172a;
    border: 1px solid #334155;
    color: #fff;
    padding: 0.8rem 1rem;
    border-radius: 0.5rem;
    outline: none;
}

input:focus {
    border-color: #38bdf8;
}

button {
    background: #0284c7;
    color: white;
    border: none;
    padding: 0.8rem 1.2rem;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

button:hover {
    background: #0369a1;
}

.actions-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.btn-export {
    background: #10b981;
}

.btn-export:hover {
    background: #059669;
}

.table-container {
    background: rgba(30, 41, 59, 0.7);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 1rem;
    overflow-x: auto;
}

table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
}

th, td {
    padding: 1rem;
    border-bottom: 1px solid #334155;
}

th {
    background: #0f172a;
    color: #94a3b8;

}

.badge {
    padding: 0.3rem 0.6rem;
    border-radius: 0.3rem;
    font-size: 0.8rem;
    font-weight: 600;
}

.badge-cache {
    background: rgba(56, 189, 248, 0.2);
    color: #38bdf8;
}

.badge-fresh {
    background: rgba(16, 185, 129, 0.2);
    color: #10b981;
}

.empty {
    text-align: center;
    color: #64748b;
}

/* Modal */
.modal {
    display: none;
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0, 0, 0, 0.7);
    justify-content: center;
    align-items: center;
}

.modal-content {
    background: #1e293b;
    padding: 2rem;
    border-radius: 1rem;
    width: 90%;
    max-width: 600px;
    position: relative;
}

.close-btn {
    position: absolute;
    top: 1rem; right: 1.5rem;
    font-size: 1.5rem;
    cursor: pointer;
}
```

- [ ] **Step 3: Viết xử lý Frontend JS (`public/app.js`)**

```javascript
document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('searchForm');
    const taxInput = document.getElementById('taxInput');
    const locationInput = document.getElementById('locationInput');
    const businessInput = document.getElementById('businessInput');
    const resultsBody = document.getElementById('resultsBody');
    const statusCount = document.getElementById('statusCount');
    const btnExport = document.getElementById('btnExport');

    async function loadCompanies(query = '', location = '', business = '') {
        resultsBody.innerHTML = '<tr><td colspan="6" class="empty">⏳ Đang tra cứu & cào dữ liệu...</td></tr>';
        
        try {
            let res;
            if (query && /^\d{10}(-\d{3})?$/.test(query.trim())) {
                // Tra cứu đơn theo MST
                res = await fetch(`/api/company/${encodeURIComponent(query.trim())}`);
                const data = await res.json();
                if (data.success) {
                    renderTable([data.data], data.from_cache);
                } else {
                    resultsBody.innerHTML = `<tr><td colspan="6" class="empty">❌ ${data.message}</td></tr>`;
                }
            } else {
                // Tra cứu danh sách theo từ khóa/ngành/địa điểm
                const params = new URLSearchParams({ query, location, business });
                res = await fetch(`/api/companies/search?${params.toString()}`);
                const data = await res.json();
                renderTable(data.data || [], true);
            }
        } catch (err) {
            resultsBody.innerHTML = '<tr><td colspan="6" class="empty">Lỗi kết nối máy chủ API!</td></tr>';
        }
    }

    function renderTable(companies, fromCache = true) {
        if (!companies || companies.length === 0) {
            resultsBody.innerHTML = '<tr><td colspan="6" class="empty">Không tìm thấy dữ liệu phù hợp.</td></tr>';
            statusCount.textContent = 'Tổng số: 0 công ty';
            return;
        }

        statusCount.textContent = `Tổng số: ${companies.length} công ty`;
        resultsBody.innerHTML = companies.map(c => `
            <tr>
                <td><strong>${c.tax_code}</strong></td>
                <td>${c.name}</td>
                <td>${c.representative || '-'}</td>
                <td>${c.address || '-'}</td>
                <td>${c.main_business || '-'}</td>
                <td>
                    <span class="badge ${fromCache ? 'badge-cache' : 'badge-fresh'}">
                        ${fromCache ? 'Từ CSDL' : 'Mới cào'}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loadCompanies(taxInput.value, locationInput.value, businessInput.value);
    });

    btnExport.addEventListener('click', () => {
        const query = taxInput.value;
        const location = locationInput.value;
        const business = businessInput.value;
        const params = new URLSearchParams({ query, location, business });
        window.location.href = `/api/export/csv?${params.toString()}`;
    });

    // Load initial
    loadCompanies();
});
```

---

## Plan Completion & Handoff

Plan complete and saved to `C:\Users\alo24\.gemini\antigravity\scratch\masothue-cache-app\docs\superpowers\plans\2026-07-27-masothue-cache-app.md`. Two execution options:

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
