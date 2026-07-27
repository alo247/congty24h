// src/server.js
// Máy chủ Express Backend phục vụ API tra cứu mã số thuế và xuất file CSV (Đã tối ưu cho Vercel & Tự động cào danh sách)
const express = require('express');
const cors = require('cors');
const path = require('path');
const { findCompanyByTaxCode, searchCompanies, saveCompany } = require('./database');
const { scrapeCompanyDetail, scrapeSearchList } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// API Tra cứu theo Mã số thuế (Lazy-Caching Scraping)
app.get('/api/company/:taxCode', async (req, res) => {
    try {
        const { taxCode } = req.params;
        const cleanTaxCode = taxCode.trim();

        // 1. Kiểm tra CSDL trước (Cache Hit)
        let company = findCompanyByTaxCode(cleanTaxCode);
        if (company) {
            return res.json({ success: true, from_cache: true, data: company });
        }

        // 2. Chưa có trong CSDL -> Gọi Worker cào dữ liệu mới (Cache Miss)
        console.log(`[Cache Miss] Đang cào dữ liệu mới cho MST: ${cleanTaxCode}`);
        const scrapedData = await scrapeCompanyDetail(cleanTaxCode);

        if (scrapedData && scrapedData.name) {
            saveCompany(scrapedData);
            const savedCompany = findCompanyByTaxCode(cleanTaxCode);
            return res.json({ success: true, from_cache: false, data: savedCompany });
        } else {
            return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin công ty cho mã số thuế này.' });
        }
    } catch (error) {
        console.error('[API Error]', error);
        return res.status(500).json({ success: false, message: 'Lỗi hệ thống khi xử lý yêu cầu.' });
    }
});

// API Tra cứu danh sách theo Từ khóa / Địa điểm / Ngành nghề (Tự động cào dữ liệu tươi nếu CSDL chưa có)
app.get('/api/companies/search', async (req, res) => {
    try {
        const { query, location, business } = req.query;
        let results = searchCompanies({ taxCodeOrName: query, location, business });

        const searchKeyword = [query, location, business].filter(Boolean).join(' ').trim();

        // Nếu CSDL SQLite chưa có dữ liệu hoặc kết quả ít (< 3) -> Tự động cào danh sách mới từ masothue.com
        if (searchKeyword && results.length < 3) {
            console.log(`[Auto Scrape List] Đang tự động cào masothue.com cho từ khóa: "${searchKeyword}"`);
            const msts = await scrapeSearchList(searchKeyword);

            if (msts.length > 0) {
                // Lấy tối đa 10 MST để cào chi tiết và nạp vào CSDL
                const mstsToScrape = msts.slice(0, 10);
                for (const mst of mstsToScrape) {
                    if (!findCompanyByTaxCode(mst)) {
                        console.log(`[Auto Scrape Detail] Cào chi tiết MST: ${mst}`);
                        const detail = await scrapeCompanyDetail(mst);
                        if (detail && detail.name) {
                            saveCompany(detail);
                        }
                    }
                }

                // Query lại CSDL SQLite sau khi đã nạp dữ liệu tươi
                results = searchCompanies({ taxCodeOrName: query, location, business });
                if (results.length === 0) {
                    // Trả về danh sách vừa cào nếu câu query SQL quá khắt khe
                    results = mstsToScrape.map(mst => findCompanyByTaxCode(mst)).filter(Boolean);
                }
            }
        }

        res.json({ success: true, count: results.length, data: results });
    } catch (error) {
        console.error('[Search API Error]', error);
        res.status(500).json({ success: false, message: 'Lỗi tìm kiếm dữ liệu.' });
    }
});

// API Xuất file CSV (Chuẩn UTF-8 BOM mở trực tiếp trên Excel & Google Sheets không bị lỗi phông)
app.get('/api/export/csv', (req, res) => {
    try {
        const { query, location, business } = req.query;
        const companies = searchCompanies({ taxCodeOrName: query, location, business });

        // Ký tự UTF-8 BOM để Excel nhận diện chuẩn tiếng Việt
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
        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_cong_ty_masothue.csv');
        res.send(csv);
    } catch (error) {
        console.error('[Export CSV Error]', error);
        res.status(500).send('Lỗi khi kết xuất file CSV.');
    }
});

// Export app cho Vercel Serverless Function handler
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server Masothue Cache App đang chạy tại: http://localhost:${PORT}`);
    });
}
