// src/scraper.js
// Module cào dữ liệu từ masothue.com bằng Cheerio và Axios
const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': 'https://masothue.com/'
};

/**
 * Cào chi tiết thông tin công ty dựa trên Mã số thuế
 * @param {string} taxCode 
 * @returns {object|null}
 */
async function scrapeCompanyDetail(taxCode) {
    try {
        const url = `https://masothue.com/Search/?q=${encodeURIComponent(taxCode)}&type=auto`;
        const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });
        const $ = cheerio.load(response.data);

        const company = {
            tax_code: taxCode,
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

        // Lấy tên công ty từ header hoặc bảng
        company.name = $('th[span="2"]').text().trim() 
                    || $('h1.title-tax-code').text().trim() 
                    || $('table.table-taxinfo thead th').text().trim()
                    || $('h1').first().text().trim();

        // Duyệt qua bảng thông tin chi tiết
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
        console.error(`[Scraper Error] Lỗi cào dữ liệu cho MST ${taxCode}:`, error.message);
        return null;
    }
}

/**
 * Cào danh sách các Mã số thuế từ trang tìm kiếm danh sách trên masothue.com
 * @param {string} keyword Từ khóa tìm kiếm (Ví dụ: "chăn nuôi bắc ninh")
 * @returns {Array<string>} Danh sách mã số thuế lấy được
 */
async function scrapeSearchList(keyword) {
    try {
        const url = `https://masothue.com/Search/?q=${encodeURIComponent(keyword)}`;
        const response = await axios.get(url, { headers: HEADERS, timeout: 10000 });
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
