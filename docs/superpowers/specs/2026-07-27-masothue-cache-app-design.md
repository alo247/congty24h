# Tài liệu thiết kế Hệ thống Tra cứu & Cào Dữ liệu Mã Số Thuế (Lazy-Caching Scraping)

## 1. Tổng quan Dự án
Xây dựng ứng dụng web tra cứu mã số thuế (MST) và thông tin doanh nghiệp Việt Nam với cơ chế **Lazy-Caching Scraping**.
- Khi người dùng tìm kiếm một mã số thuế/ngành nghề/địa điểm: Hệ thống kiểm tra trong cơ sở dữ liệu (CSDL) SQLite cục bộ.
- Nếu dữ liệu đã có: Trả về kết quả tức thì (< 5ms).
- Nếu dữ liệu chưa có: Kích hoạt Worker tự động cào dữ liệu từ masothue.com, phân tích bóc tách đầy đủ các trường thông tin, lưu vào SQLite và trả về kết quả cho người dùng.

## 2. Kiến trúc & Công nghệ
- **Ngôn ngữ & Runtime**: Node.js
- **Web Framework**: Express.js
- **Database**: SQLite3 thông qua thư viện `better-sqlite3` (Hỗ trợ Indexing cho hơn 1.000.000 bản ghi)
- **Scraper Engine**: `cheerio` + `axios` với Header/User-Agent giả lập trình duyệt
- **Frontend**: HTML5, CSS3 (Vanilla CSS với phong cách Glassmorphism hiện đại), JavaScript ES6+
- **Xuất dữ liệu**: Tự động kết xuất file CSV (UTF-8 BOM) tương thích mở trực tiếp trên Excel & Google Sheets

## 3. Cấu trúc CSDL SQLite (`database.db`)

```sql
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
```

## 4. Luồng xử lý dữ liệu (Data Flow)

### 4.1 Tra cứu theo Mã Số Thuế (Lazy-Caching Single Lookup)
1. User gửi MST -> API `/api/company/:taxCode`
2. API query `SELECT * FROM companies WHERE tax_code = ?`
3. Nếu có -> Phản hồi kết quả (Cache Hit)
4. Nếu chưa -> Kích hoạt `scrapeCompanyDetail(taxCode)`
5. Ghi kết quả cào mới vào SQLite -> Phản hồi kết quả cho User

### 4.2 Tra cứu theo Ngành Nghề / Địa Điểm (Batch List Scraping)
1. User tìm từ khóa Ngành nghề / Địa điểm -> API `/api/companies/search`
2. Query SQL `SELECT * FROM companies WHERE main_business LIKE %...% AND address LIKE %...%`
3. Kích hoạt Worker cào trang danh sách kết quả từ masothue.com theo từ khóa.
4. Lấy danh sách các MST mới -> Tự động cào chi tiết từng MST chưa có trong SQLite -> Lưu hàng loạt vào SQLite.
5. Tổng hợp và trả về kết quả cho người dùng.

## 5. Chức năng Giao diện (Frontend Dashboard)
- **Thanh tìm kiếm linh hoạt**: Hỗ trợ tìm MST, Tên công ty, Ngành nghề, Địa điểm (Tỉnh/Thành).
- **Bảng danh sách kết quả**: Thống kê số lượng, hiển thị nhãn phân biệt `Từ CSDL` hoặc `Mới cào`.
- **Modal Xem chi tiết**: Hiển thị đầy đủ thông tin chi tiết của doanh nghiệp.
- **Tính năng Export**: Tải xuống file CSV tương thích Google Sheets & MS Excel.
