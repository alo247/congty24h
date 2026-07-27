// tests/database.test.js
// Unit test cho module CSDL SQLite
const { findCompanyByTaxCode, saveCompany } = require('../src/database');

const testCompany = {
    tax_code: '0100109106',
    name: 'TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI',
    international_name: 'VIETNAM MILITARY TELECOMMUNICATIONS GROUP',
    short_name: 'VIETTEL',
    representative: 'Tào Đức Thắng',
    address: 'Lô D26 Khu đô thị mới Cầu Giấy, Phường Yên Hòa, Quận Cầu Giấy, Thành phố Hà Nội',
    phone: '02462556789',
    license_date: '2010-12-14',
    managed_by: 'Cục Thuế Thành phố Hà Nội',
    status: 'Đang hoạt động',
    main_business: 'Hoạt động viễn thông có dây',
    raw_html: '<html>test</html>'
};

console.log('--- Bắt đầu test CSDL SQLite ---');
saveCompany(testCompany);
const result = findCompanyByTaxCode('0100109106');

if (result && result.name === testCompany.name) {
    console.log('✅ TEST CSDL THÀNH CÔNG: Đã lưu và tìm thấy thông tin công ty Viettel.');
} else {
    console.error('❌ TEST CSDL THẤT BẠI.');
    process.exit(1);
}
