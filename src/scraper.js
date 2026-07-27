// src/scraper.js
// Module cào & trích xuất ĐẦY ĐỦ 14 trường thông tin chi tiết của doanh nghiệp
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
 * Làm sạch chuỗi người đại diện (Loại bỏ danh sách doanh nghiệp liên quan phía sau)
 */
function cleanRepresentative(rawText) {
    if (!rawText) return '';
    return rawText.split('Ngoài ra')[0].split('đại diện các')[0].trim();
}

/**
 * Làm sạch chuỗi số điện thoại (Loại bỏ chữ 'Ẩn số điện thoại')
 */
function cleanPhone(rawText) {
    if (!rawText) return '';
    return rawText.replace(/Ẩn số điện thoại/gi, '').trim();
}

/**
 * Cào / Trích xuất chi tiết ĐẦY ĐỦ 14 trường thông tin công ty từ masothue.com và VietQR API
 * @param {string} taxCode 
 * @returns {object|null}
 */
async function scrapeCompanyDetail(taxCode) {
    const cleanTaxCode = taxCode.trim();

    // 1. Thử cào trực tiếp từ masothue.com (Truy cập thẳng trang chi tiết hoặc tìm kiếm)
    try {
        const searchUrl = `https://masothue.com/Search/?q=${encodeURIComponent(cleanTaxCode)}`;
        const searchRes = await axios.get(searchUrl, { headers: ENHANCED_HEADERS, timeout: 8000 });
        const $search = cheerio.load(searchRes.data);

        // Tìm link chi tiết dạng /<taxCode>-slug nếu có
        let detailUrl = searchUrl;
        $search('a').each((i, el) => {
            const href = $search(el).attr('href') || '';
            if (href.includes(`/${cleanTaxCode}-`)) {
                detailUrl = `https://masothue.com${href}`;
            }
        });

        const detailRes = detailUrl === searchUrl ? searchRes : await axios.get(detailUrl, { headers: ENHANCED_HEADERS, timeout: 8000 });
        const $ = cheerio.load(detailRes.data);

        const company = {
            tax_code: cleanTaxCode,
            name: $('th[span="2"]').text().trim() || $('table.table-taxinfo thead th').text().trim() || $('h1').first().text().trim(),
            international_name: '',
            short_name: '',
            representative: '',
            address: '',
            tax_address: '',
            phone: '',
            license_date: '',
            managed_by: '',
            company_type: '',
            status: 'Đang hoạt động',
            main_business: '',
            last_updated_at: '',
            raw_html: detailRes.data
        };

        $('table.table-taxinfo tbody tr').each((i, el) => {
            const label = $(el).find('td').eq(0).text().trim();
            const value = $(el).find('td').eq(1).text().trim();

            if (label.includes('Mã số thuế')) {
                const parsedMst = value.split(' ')[0];
                if (parsedMst) company.tax_code = parsedMst;
            }
            if (label.includes('Địa chỉ Thuế')) company.tax_address = value;
            if (label.includes('Địa chỉ') && !label.includes('Thuế')) company.address = value;
            if (label.includes('Tình trạng') || label.includes('Trạng thái')) company.status = value;
            if (label.includes('Tên quốc tế')) company.international_name = value;
            if (label.includes('Tên viết tắt')) company.short_name = value;
            if (label.includes('Người đại diện')) company.representative = cleanRepresentative(value);
            if (label.includes('Điện thoại')) company.phone = cleanPhone(value);
            if (label.includes('Ngày hoạt động') || label.includes('Ngày cấp')) company.license_date = value;
            if (label.includes('Quản lý bởi')) company.managed_by = value;
            if (label.includes('Loại hình DN')) company.company_type = value;
            if (label.includes('Ngành nghề chính')) company.main_business = value;
            if (label.includes('Cập nhật mã số thuế')) company.last_updated_at = label + ' ' + value;
        });

        // Đảm bảo tên hợp lệ và đúng MST
        if (company.name && !company.name.includes('Không tìm thấy') && company.tax_code === cleanTaxCode) {
            return company;
        }
    } catch (error) {
        console.log(`[Masothue Scraper Fallback] ${cleanTaxCode}:`, error.message);
    }

    // 2. Thử VietQR Business API nếu masothue.com bị chặn hoặc thiếu
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
                tax_address: vdata.address || '',
                phone: vdata.phone || '',
                license_date: vdata.createdDate || '',
                managed_by: vdata.managedBy || '',
                company_type: vdata.companyType || 'Doanh nghiệp',
                status: vdata.status || 'Đang hoạt động',
                main_business: vdata.mainBusiness || '',
                last_updated_at: new Date().toISOString().split('T')[0],
                raw_html: JSON.stringify(vdata)
            };
        }
    } catch (e) {
        console.log(`[VietQR API Miss] ${cleanTaxCode}:`, e.message);
    }

    return null;
}

/**
 * Cào danh sách các Mã số thuế từ trang tìm kiếm danh sách trên masothue.com
 * @param {string} keyword 
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
