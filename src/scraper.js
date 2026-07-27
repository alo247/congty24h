// src/scraper.js
// Module cào & trích xuất ĐẦY ĐỦ thông tin chi tiết từ VietQR API + Masothue Engine + Tự động liên kết Thư Viện Pháp Luật
const axios = require('axios');
const cheerio = require('cheerio');

const ENHANCED_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'max-age=0',
    'Referer': 'https://masothue.com/'
};

function removeTones(str) {
    if (!str) return '';
    return str.toLowerCase()
        .replace(/à|á|ạ|ả|ã|â|ầ|ấ|ậ|ẩ|ẫ|ă|ằ|ắ|ặ|ẳ|ẵ/g, "a")
        .replace(/è|é|ẹ|ẻ|ẽ|ê|ề|ế|ệ|ể|ễ/g, "e")
        .replace(/ì|í|ị|ỉ|ĩ/g, "i")
        .replace(/ò|ó|ọ|ỏ|õ|ô|ồ|ố|ộ|ổ|ỗ|ơ|ờ|ớ|ợ|ở|ỡ/g, "o")
        .replace(/ù|ú|ụ|ủ|ũ|ư|ừ|ứ|ự|ử|ữ/g, "u")
        .replace(/ỳ|ý|ỵ|ỷ|ỹ/g, "y")
        .replace(/đ/g, "d")
        .replace(/[^a-z0-9 ]/g, '')
        .replace(/\s+/g, '-')
        .trim();
}

function buildTvplUrl(taxCode, name) {
    const slug = removeTones(name || 'cong-ty');
    return `https://thuvienphapluat.vn/ma-so-thue/${slug}-mst-${taxCode}.html`;
}

function cleanRepresentative(rawText) {
    if (!rawText) return '';
    return rawText.split('Ngoài ra')[0].split('đại diện các')[0].trim();
}

function cleanPhone(rawText) {
    if (!rawText) return '';
    return rawText.replace(/Ẩn số điện thoại/gi, '').trim();
}

/**
 * Cào / Trích xuất chi tiết thông tin công ty bằng cơ chế Đa Nguồn (VietQR API + Masothue Engine + Thư Viện Pháp Luật)
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
                tax_address: vdata.address || '',
                phone: vdata.phone || '',
                license_date: vdata.createdDate || '',
                managed_by: vdata.managedBy || '',
                company_type: vdata.companyType || 'Doanh nghiệp',
                status: vdata.status || 'Đang hoạt động',
                main_business: vdata.mainBusiness || '',
                last_updated_at: new Date().toISOString().split('T')[0],
                tvpl_url: buildTvplUrl(cleanTaxCode, vdata.name),
                raw_html: JSON.stringify(vdata)
            };
        }
    } catch (e) {
        console.log(`[VietQR API Miss] ${cleanTaxCode}:`, e.message);
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
            tax_address: '',
            phone: '',
            license_date: '',
            managed_by: '',
            company_type: '',
            status: 'Đang hoạt động',
            main_business: '',
            last_updated_at: '',
            tvpl_url: '',
            raw_html: response.data
        };

        company.name = $('th[span="2"]').text().trim() 
                    || $('table.table-taxinfo thead th').text().trim() 
                    || $('h1').first().text().trim();

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

        if (company.name && !company.name.includes('Không tìm thấy')) {
            company.tvpl_url = buildTvplUrl(company.tax_code, company.name);
            return company;
        }
    } catch (error) {
        console.error(`[Masothue Scraper Error] Lỗi cào dữ liệu cho MST ${cleanTaxCode}:`, error.message);
    }

    return null;
}

/**
 * Cào danh sách các Mã số thuế từ trang tìm kiếm
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
    scrapeSearchList,
    buildTvplUrl
};
