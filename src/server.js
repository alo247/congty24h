// src/server.js
// Máy chủ Express Backend phục vụ API tra cứu mã số thuế và xuất file CSV (Bổ sung Link Thư Viện Pháp Luật)
const express = require('express');
const cors = require('cors');
const path = require('path');
const { findCompanyByTaxCode, searchCompanies, saveCompany, generateTvplUrl } = require('./database');
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
            if (!company.tvpl_url) {
                company.tvpl_url = generateTvplUrl(company.tax_code, company.name);
            }
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

// API Tra cứu danh sách theo Từ khóa / Địa điểm / Ngành nghề
app.get('/api/companies/search', async (req, res) => {
    try {
        const { query, location, business } = req.query;
        let results = searchCompanies({ taxCodeOrName: query, location, business });

        const searchKeyword = [query, location, business].filter(Boolean).join(' ').trim();

        // Nếu CSDL SQLite chưa có đủ dữ liệu -> Tự động cào danh sách mới
        if (searchKeyword && results.length < 3) {
            console.log(`[Auto Scrape List] Đang tự động cào cho từ khóa: "${searchKeyword}"`);
            const msts = await scrapeSearchList(searchKeyword);

            if (msts.length > 0) {
                const mstsToScrape = msts.slice(0, 15);
                const freshlyScraped = [];

                for (const mst of mstsToScrape) {
                    let detail = findCompanyByTaxCode(mst);
                    if (!detail) {
                        console.log(`[Auto Scrape Detail] Cào chi tiết MST: ${mst}`);
                        detail = await scrapeCompanyDetail(mst);
                        if (detail && detail.name) {
                            saveCompany(detail);
                            detail = findCompanyByTaxCode(mst) || detail;
                        }
                    }
                    if (detail && detail.name) {
                        if (!detail.tvpl_url) {
                            detail.tvpl_url = generateTvplUrl(detail.tax_code, detail.name);
                        }
                        freshlyScraped.push(detail);
                    }
                }

                results = searchCompanies({ taxCodeOrName: query, location, business });
                if (results.length === 0 && freshlyScraped.length > 0) {
                    results = freshlyScraped;
                }
            }
        }

        // Bổ sung tvpl_url cho tất cả bản ghi trả về
        results = results.map(c => ({
            ...c,
            tvpl_url: c.tvpl_url || generateTvplUrl(c.tax_code, c.name)
        }));

        res.json({ success: true, count: results.length, data: results });
    } catch (error) {
        console.error('[Search API Error]', error);
        res.status(500).json({ success: false, message: 'Lỗi tìm kiếm dữ liệu.' });
    }
});

// API Xuất file CSV (Đầy đủ trường thông tin & Link Thư Viện Pháp Luật)
app.get('/api/export/csv', (req, res) => {
    try {
        const { query, location, business } = req.query;
        let companies = searchCompanies({ taxCodeOrName: query, location, business });

        let csv = '\uFEFF';
        csv += 'Mã Số Thuế,Tên Công Ty,Tên Quốc Tế,Tên Viết Tắt,Người Đại Diện,Địa Chỉ Trụ Sở,Địa Chỉ Thuế,Điện Thoại,Trạng Thái,Loại Hình DN,Chi Cục Thuế Quản Lý,Ngành Nghề Chính,Ngày Cấp,Link Thư Viện Pháp Luật\n';

        companies.forEach(c => {
            const tvplUrl = c.tvpl_url || generateTvplUrl(c.tax_code, c.name);
            const row = [
                `"${c.tax_code || ''}"`,
                `"${(c.name || '').replace(/"/g, '""')}"`,
                `"${(c.international_name || '').replace(/"/g, '""')}"`,
                `"${(c.short_name || '').replace(/"/g, '""')}"`,
                `"${(c.representative || '').replace(/"/g, '""')}"`,
                `"${(c.address || '').replace(/"/g, '""')}"`,
                `"${(c.tax_address || '').replace(/"/g, '""')}"`,
                `"${c.phone || ''}"`,
                `"${c.status || ''}"`,
                `"${(c.company_type || '').replace(/"/g, '""')}"`,
                `"${(c.managed_by || '').replace(/"/g, '""')}"`,
                `"${(c.main_business || '').replace(/"/g, '""')}"`,
                `"${c.license_date || ''}"`,
                `"${tvplUrl}"`
            ];
            csv += row.join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_cong_ty_tvpl.csv');
        res.send(csv);
    } catch (error) {
        console.error('[Export CSV Error]', error);
        res.status(500).send('Lỗi khi kết xuất file CSV.');
    }
});

module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server Masothue Cache App đang chạy tại: http://localhost:${PORT}`);
    });
}
