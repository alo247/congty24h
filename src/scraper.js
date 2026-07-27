// src/scraper.js
// Module cào & trích xuất dữ liệu doanh nghiệp đa nguồn (VietQR API + Masothue Engine)
const axios = require('axios');
const cheerio = require('cheerio');

const ENHANCED_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'max-age=0',
    'Referer': 'https://masothue.com/'
};

/**
 * Cào / Trích xuất chi tiết thông tin công ty bằng cơ chế Dual-Engine (VietQR API + Masothue Engine)
 * @param {string} taxCode 
 * @returns {object|null}
 */
async function scrapeCompanyDetail(taxCode) {
    const cleanTaxCode = taxCode.trim();

    // 1. Thử VietQR Business API (Siêu tốc & Không bị WAF/Cloudflare 403 trên Vercel)
    try {
        const vietQrUrl = `https://api.vietqr.io/v2/business/${encodeURIComponent(cleanTaxCode)}`;
        const vres = await axios.get(vietQrUrl, { timeout: 6000 });
        if (vres.data && vres.data.code === '00' && vres.data.data && vres.data.data.name) {
            const vdata = vres.data.data;
            return {
                tax_code: cleanTaxCode,
                name: vdata.name,
                international_name: vdata.internationalName || '',
                short_name: vdata.shortName || '',
                representative: vdata.representative || '',
                address: vdata.address || '',
                phone: vdata.phone || '',
                license_date: vdata.createdDate || '',
                managed_by: vdata.managedBy || '',
                status: vdata.status || 'Đang hoạt động',
                main_business: vdata.mainBusiness || '',
                raw_html: JSON.stringify(vdata)
            };
        }
    } catch (e) {
        console.log(`[VietQR API Miss/Fallback for ${cleanTaxCode}]:`, e.message);
    }

    // 2. Fallback: Cào từ masothue.com nếu VietQR không tìm thấy
    try {
        const url = `https://masothue.com/Search/?q=${encodeURIComponent(cleanTaxCode)}&type=auto`;
        const response = await axios.get(url, { headers: ENHANCED_HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        const company = {
            tax_code: cleanTaxCode,
            name: '',
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

        company.name = $('th[span="2"]').text().trim() 
                    || $('h1.title-tax-code').text().trim() 
                    || $('table.table-taxinfo thead th').text().trim()
                    || $('h1').first().text().trim();

        $('table.table-taxinfo tbody tr').each((i, el) => {
            const label = $(el).find('td').eq(0).text().trim();
            const value = $(el).find('td').eq(1).text().trim();

            if (label.includes('Tên quốc tế')) company.international_name = value;
            if (label.includes('Tên viết tắt')) company.short_name = value;
            if (label.includes('Người đại diện')) {
                company.representative = $(el).find('td').eq(1).find('a').text().trim() || value;
            }
            if (label.includes('Địa chỉ')) company.address = value;
            if (label.includes('Điện thoại')) company.phone = value;
            if (label.includes('Ngày cấp') || label.includes('Ngày hoạt động')) company.license_date = value;
            if (label.includes('Quản lý bởi')) company.managed_by = value;
            if (label.includes('Trạng thái')) company.status = value;
            if (label.includes('Ngành nghề')) company.main_business = value;
        });

        if (!company.name || company.name.includes('Không tìm thấy')) {
            return null;
        }

        return company;
    } catch (error) {
        console.error(`[Masothue Scraper Error] Lỗi cào dữ liệu cho MST ${cleanTaxCode}:`, error.message);
        return null;
    }
}

/**
 * Cào danh sách các Mã số thuế từ trang tìm kiếm danh sách trên masothue.com
 * @param {string} keyword Từ khóa tìm kiếm
 * @returns {Array<string>} Danh sách mã số thuế lấy được
 */
async function scrapeSearchList(keyword) {
    try {
        const url = `https://masothue.com/Search/?q=${encodeURIComponent(keyword)}`;
        const response = await axios.get(url, { headers: ENHANCED_HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        const foundMsts = new Set();

        $('a').each((i, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/\/(\d{10}(-\d{3})?)/);
            if (match && match[1]) {
                foundMsts.add(match[1]);
            }
        });

        return Array.from(foundMsts);
    } catch (error) {
        console.error(`[Scraper Error] Lỗi cào trang danh sách cho từ khóa "${keyword}":`, error.message);
        return [];
    }
}

module.exports = {
    scrapeCompanyDetail,
    scrapeSearchList
};
