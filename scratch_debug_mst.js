const axios = require('axios');
const cheerio = require('cheerio');

async function testDetail(taxCode) {
    const HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://masothue.com/'
    };

    const url = `https://masothue.com/Search/?q=${encodeURIComponent(taxCode)}&type=auto`;
    console.log('Fetching:', url);
    const res = await axios.get(url, { headers: HEADERS });
    const $ = cheerio.load(res.data);

    console.log('H1 Title:', $('h1').text().trim());
    console.log('h1.title-tax-code:', $('h1.title-tax-code').text().trim());
    console.log('Table th:', $('table.table-taxinfo thead th').text().trim());
    console.log('Table th span 2:', $('th[span="2"]').text().trim());

    $('table.table-taxinfo tbody tr').each((i, el) => {
        console.log(`Row ${i}:`, $(el).find('td').eq(0).text().trim(), '===>', $(el).find('td').eq(1).text().trim());
    });
}

testDetail('2400360346');
