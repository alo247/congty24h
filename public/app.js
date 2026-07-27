document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('searchForm');
    const taxInput = document.getElementById('taxInput');
    const locationInput = document.getElementById('locationInput');
    const businessInput = document.getElementById('businessInput');
    const resultsBody = document.getElementById('resultsBody');
    const statusCount = document.getElementById('statusCount');
    const btnExport = document.getElementById('btnExport');

    const detailModal = document.getElementById('detailModal');
    const closeModal = document.getElementById('closeModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');

    let currentCompanies = [];

    async function loadCompanies(query = '', location = '', business = '') {
        resultsBody.innerHTML = '<tr><td colspan="6" class="empty">⏳ Đang tra cứu & cào dữ liệu...</td></tr>';
        
        try {
            let res;
            const cleanQuery = query.trim();

            if (cleanQuery && /^\d{10}(-\d{3})?$/.test(cleanQuery)) {
                // Tra cứu theo Mã Số Thuế
                res = await fetch(`/api/company/${encodeURIComponent(cleanQuery)}`);
                const data = await res.json();
                if (data.success) {
                    currentCompanies = [data.data];
                    renderTable(currentCompanies, data.from_cache);
                } else {
                    currentCompanies = [];
                    resultsBody.innerHTML = `<tr><td colspan="6" class="empty">❌ ${data.message}</td></tr>`;
                    statusCount.textContent = 'Không tìm thấy kết quả.';
                }
            } else {
                // Tra cứu danh sách theo Từ khóa / Ngành nghề / Địa điểm
                const params = new URLSearchParams({ query: cleanQuery, location, business });
                res = await fetch(`/api/companies/search?${params.toString()}`);
                const data = await res.json();
                currentCompanies = data.data || [];
                renderTable(currentCompanies, true);
            }
        } catch (err) {
            resultsBody.innerHTML = '<tr><td colspan="6" class="empty">❌ Lỗi kết nối tới máy chủ Backend API!</td></tr>';
        }
    }

    function renderTable(companies, fromCache = true) {
        if (!companies || companies.length === 0) {
            resultsBody.innerHTML = '<tr><td colspan="6" class="empty">Chưa có dữ liệu. Vui lòng nhập Mã số thuế hoặc Từ khóa để tìm kiếm.</td></tr>';
            statusCount.textContent = 'Tổng số: 0 công ty';
            return;
        }

        statusCount.textContent = `Tổng số: ${companies.length} công ty`;
        resultsBody.innerHTML = companies.map((c, index) => `
            <tr data-index="${index}">
                <td><strong>${c.tax_code}</strong></td>
                <td>${c.name}</td>
                <td>${c.representative || '-'}</td>
                <td>${c.address || c.tax_address || '-'}</td>
                <td>${c.main_business || '-'}</td>
                <td>
                    <span class="badge ${fromCache ? 'badge-cache' : 'badge-fresh'}">
                        ${fromCache ? 'Từ CSDL SQLite' : 'Mới Cào từ Web'}
                    </span>
                </td>
            </tr>
        `).join('');

        // Thêm sự kiện click để mở modal xem chi tiết
        document.querySelectorAll('#resultsBody tr').forEach(row => {
            row.addEventListener('click', () => {
                const index = row.getAttribute('data-index');
                if (index !== null && currentCompanies[index]) {
                    showDetailModal(currentCompanies[index]);
                }
            });
        });
    }

    function showDetailModal(c) {
        modalTitle.textContent = c.name;
        modalBody.innerHTML = `
            <div class="detail-item"><label>Mã số thuế</label><span>${c.tax_code}</span></div>
            <div class="detail-item"><label>Địa chỉ trụ sở</label><span>${c.address || '-'}</span></div>
            <div class="detail-item"><label>Địa chỉ Thuế</label><span>${c.tax_address || c.address || '-'}</span></div>
            <div class="detail-item"><label>Trạng thái / Tình trạng</label><span>${c.status || 'Đang hoạt động'}</span></div>
            <div class="detail-item"><label>Tên quốc tế</label><span>${c.international_name || '-'}</span></div>
            <div class="detail-item"><label>Tên viết tắt</label><span>${c.short_name || '-'}</span></div>
            <div class="detail-item"><label>Người đại diện pháp luật</label><span>${c.representative || '-'}</span></div>
            <div class="detail-item"><label>Điện thoại</label><span>${c.phone || '-'}</span></div>
            <div class="detail-item"><label>Ngày hoạt động / Ngày cấp</label><span>${c.license_date || '-'}</span></div>
            <div class="detail-item"><label>Quản lý bởi (Chi cục Thuế)</label><span>${c.managed_by || '-'}</span></div>
            <div class="detail-item"><label>Loại hình doanh nghiệp</label><span>${c.company_type || '-'}</span></div>
            <div class="detail-item"><label>Ngành nghề kinh doanh chính</label><span>${c.main_business || '-'}</span></div>
            <div class="detail-item">
                <label>Nguồn trang Thư Viện Pháp Luật</label>
                <span>
                    <a href="${c.tvpl_url}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">
                        🔗 Xem bài viết công ty trên Thư Viện Pháp Luật
                    </a>
                </span>
            </div>
        `;
        detailModal.style.display = 'flex';
    }

    closeModal.addEventListener('click', () => {
        detailModal.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target === detailModal) {
            detailModal.style.display = 'none';
        }
    });

    searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        loadCompanies(taxInput.value, locationInput.value, businessInput.value);
    });

    btnExport.addEventListener('click', () => {
        const query = taxInput.value;
        const location = locationInput.value;
        const business = businessInput.value;
        const params = new URLSearchParams({ query, location, business });
        window.location.href = `/api/export/csv?${params.toString()}`;
    });

    loadCompanies();
});
