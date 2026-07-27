const axios = require('axios');
const cheerio = require('cheerio');

async function testDirectUrl(taxCode) {
    const HEADERS = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://masothue.com/'
    };

    // Thử truy cập theo slug URL: https://masothue.com/2400360346-cong-ty-cp-hoang-ninh-group
    const urlsToTry = [
        `https://masothue.com/${taxCode}-cong-ty-cp-hoang-ninh-group`,
        `https://masothue.com/${taxCode}-a`,
        `https://masothue.com/Search/?q=${taxCode}`
    ];

    for (const url of urlsToTry) {
        console.log('\n--- Fetching URL:', url);
        try {
            const res = await axios.get(url, { headers: HEADERS });
            const $ = cheerio.load(res.data);
            const title = $('table.table-taxinfo thead th').text().trim() || $('h1').first().text().trim();
            console.log('Title/Name:', title);

            $('table.table-taxinfo tbody tr').each((i, el) => {
                const label = $(el).find('td').eq(0).text().trim();
                const value = $(el).find('td').eq(1).text().trim();
                console.log(`  [${label}] => ${value}`);
            });
            break;
        } catch (e) {
            console.log('Error status:', e.response ? e.response.status : e.message);
        }
    }
}

testDirectUrl('2400360346');
