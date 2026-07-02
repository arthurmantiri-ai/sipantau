/* ============================================================
   MANAJEMEN STOK OBAT — KLINIK IMANUEL (REDESIGN)
   Sistem batch FIFO + laporan bulanan + import/export Excel
   Tabel Supabase: apotek_batch, apotek_transaksi
   ============================================================ */

// --- KONFIGURASI SUPABASE ---
const SUPABASE_URL = 'https://xbvnydbglqyqnhwddjvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhidm55ZGJnbHF5cW5od2RkanZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQwNTMsImV4cCI6MjA5NjMxMDA1M30.QRjVy7TSJi7vOeF3sZzsk1JSD0mg2NMhwBMlO4YrOv0';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- STATE GLOBAL ---
let batchData = [];       // isi tabel apotek_batch
let transaksiData = [];   // isi tabel apotek_transaksi
let openGroups = new Set();
let importRows = [];      // hasil parse file import

const KATEGORI_KELUAR = ['Resep Dokter', 'Obat Expired', 'Obat Rusak', 'Lainnya'];
const KATEGORI_WARNA = { 'Resep Dokter': '#3b82f6', 'Obat Expired': '#f59e0b', 'Obat Rusak': '#ef4444', 'Lainnya': '#64748b' };
const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// --- UTILITAS ---
function formatRp(angka) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(angka || 0);
}
function formatTgl(str) {
    if (!str) return '-';
    return new Date(str + (str.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function monthStr(d) { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; }
function labelBulan(ym) { const [y, m] = ym.split('-'); return `${BULAN_ID[parseInt(m) - 1]} ${y}`; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Urutan FIFO: batch yang masuk paling awal berada paling depan
function sortFifo(list) {
    return [...list].sort((a, b) =>
        new Date(a.tgl_masuk) - new Date(b.tgl_masuk) ||
        new Date(a.created_at) - new Date(b.created_at)
    );
}

/* ============================================================
   AUTHENTICATION
   ============================================================ */
const overlay = document.getElementById('authOverlay');
const mainApp = document.getElementById('mainApp');
document.getElementById('btnMasukAuth').addEventListener('click', checkAuth);
document.getElementById('farmasiPassword').addEventListener('keypress', e => { if (e.key === 'Enter') checkAuth(); });

function checkAuth() {
    const passInput = document.getElementById('farmasiPassword');
    if (passInput.value === 'farmasiimanuel') {
        overlay.style.display = 'none';
        mainApp.style.display = 'block';
        initApp();
    } else {
        document.getElementById('authError').style.display = 'block';
        passInput.style.borderColor = 'var(--danger)';
    }
}

/* ============================================================
   INISIALISASI
   ============================================================ */
function initApp() {
    updateWaktu();
    setInterval(updateWaktu, 60000);

    // Default nilai form
    document.getElementById('in_tglmasuk').value = todayStr();
    document.getElementById('out_tanggal').value = todayStr();
    document.getElementById('laporanBulan').value = monthStr();
    const firstDay = new Date(); firstDay.setDate(1);
    document.getElementById('exportMulai').value = firstDay.toISOString().split('T')[0];
    document.getElementById('exportSelesai').value = todayStr();

    setupTabs();
    setupModals();
    setupForms();
    setupImportExport();

    document.getElementById('searchInput').addEventListener('input', renderTabelStok);
    document.getElementById('laporanBulan').addEventListener('change', renderLaporanBulanan);
    document.getElementById('riwayatFilterJenis').addEventListener('change', renderRiwayat);
    document.getElementById('riwayatFilterBulan').addEventListener('change', renderRiwayat);
    document.getElementById('btnResetRiwayat').addEventListener('click', () => {
        document.getElementById('riwayatFilterJenis').value = '';
        document.getElementById('riwayatFilterBulan').value = '';
        renderRiwayat();
    });

    muatSemuaData();
}

function updateWaktu() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentTime').innerText = new Date().toLocaleDateString('id-ID', options);
}

async function muatSemuaData() {
    const [resBatch, resTrx] = await Promise.all([
        db.from('apotek_batch').select('*').order('nama_obat', { ascending: true }),
        db.from('apotek_transaksi').select('*').order('tanggal', { ascending: false }).order('created_at', { ascending: false })
    ]);

    if (resBatch.error) {
        alert('Gagal memuat data batch. Pastikan tabel "apotek_batch" sudah dibuat di Supabase (jalankan supabase_setup_apotek.sql).\n\n' + resBatch.error.message);
        return;
    }
    if (resTrx.error) {
        alert('Gagal memuat riwayat transaksi. Pastikan tabel "apotek_transaksi" sudah dibuat di Supabase.\n\n' + resTrx.error.message);
        return;
    }

    batchData = resBatch.data || [];
    transaksiData = resTrx.data || [];

    renderSemua();
}

function renderSemua() {
    renderStatUtama();
    renderTabelStok();
    renderLaporanBulanan();
    renderRekapBulanan();
    renderRiwayat();
    populateFormLists();
}

/* ============================================================
   TABS
   ============================================================ */
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
        });
    });
}

/* ============================================================
   KARTU STATISTIK UTAMA (poin 5)
   ============================================================ */
function renderStatUtama() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const h30 = new Date(today); h30.setDate(h30.getDate() + 30);

    const aktif = batchData.filter(b => b.stok_sisa > 0);
    const nilaiAset = aktif.reduce((s, b) => s + b.stok_sisa * parseFloat(b.harga_satuan || 0), 0);
    const jenisObat = new Set(aktif.map(b => b.nama_obat)).size;
    const menipis = aktif.filter(b => b.stok_sisa < 10).length;
    const expired = aktif.filter(b => new Date(b.tgl_expired) <= today).length;
    const segera = aktif.filter(b => { const e = new Date(b.tgl_expired); return e > today && e <= h30; }).length;

    document.getElementById('nilaiAsetRp').innerText = formatRp(nilaiAset);
    document.getElementById('totalBatch').innerText = aktif.length;
    document.getElementById('totalJenisObat').innerText = `(${jenisObat} jenis obat)`;
    document.getElementById('stokMenipis').innerText = menipis;
    document.getElementById('obatExpired').innerText = expired;
    document.getElementById('obatSegera').innerText = segera > 0 ? `(+${segera} segera exp ≤30 hr)` : '';
}

/* ============================================================
   TAB 1: TABEL STOK (grup per obat, batch urutan FIFO) — poin 1 & 4
   ============================================================ */
function renderTabelStok() {
    const tbody = document.getElementById('tabelStokBody');
    const q = document.getElementById('searchInput').value.toLowerCase().trim();
    const today = new Date(); today.setHours(0, 0, 0, 0);

    let list = batchData.filter(b => b.stok_sisa > 0 || new Date(b.created_at) > new Date(Date.now() - 7 * 864e5)); // sembunyikan batch habis > 7 hari
    if (q) {
        list = list.filter(b =>
            (b.nama_obat || '').toLowerCase().includes(q) ||
            (b.pbf || '').toLowerCase().includes(q) ||
            (b.no_faktur || '').toLowerCase().includes(q)
        );
    }

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">Belum ada data stok. Gunakan tombol <strong>Obat Masuk</strong> atau <strong>Import</strong> untuk memulai.</td></tr>';
        return;
    }

    // Kelompokkan per nama obat
    const groups = {};
    list.forEach(b => {
        if (!groups[b.nama_obat]) groups[b.nama_obat] = [];
        groups[b.nama_obat].push(b);
    });

    let html = '';
    Object.keys(groups).sort((a, b) => a.localeCompare(b)).forEach(nama => {
        const batches = sortFifo(groups[nama]);
        const totalStok = batches.reduce((s, b) => s + b.stok_sisa, 0);
        const totalNilai = batches.reduce((s, b) => s + b.stok_sisa * parseFloat(b.harga_satuan || 0), 0);
        const satuan = batches[0].satuan || '';
        const gid = 'g_' + nama.replace(/[^a-z0-9]/gi, '_');
        const isOpen = openGroups.has(nama) || q.length > 0;

        // Status grup: ambil yang paling parah
        let grupBadge = '<span class="badge badge-ok">Aman</span>';
        if (batches.some(b => b.stok_sisa > 0 && new Date(b.tgl_expired) <= today)) grupBadge = '<span class="badge badge-danger">Ada Kadaluarsa</span>';
        else if (totalStok === 0) grupBadge = '<span class="badge badge-danger">Habis</span>';
        else if (totalStok < 10) grupBadge = '<span class="badge badge-warn">Menipis</span>';

        html += `
        <tr class="group-row ${isOpen ? 'open' : ''}" data-group="${esc(nama)}">
            <td><span class="chev"><i class="fa-solid fa-chevron-right"></i></span>${esc(nama)} <small style="color:var(--text-muted);font-weight:500">(${batches.length} batch)</small></td>
            <td colspan="4" style="color:var(--text-muted);font-weight:500">—</td>
            <td class="text-right" style="color:var(--text-muted);font-weight:500">rata²</td>
            <td class="text-right">${totalStok} <small>${esc(satuan)}</small></td>
            <td class="text-right" style="color:var(--primary)">${formatRp(totalNilai)}</td>
            <td>${grupBadge}</td>
            <td></td>
        </tr>`;

        batches.forEach((b, idx) => {
            const exp = new Date(b.tgl_expired);
            let badge;
            if (exp <= today && b.stok_sisa > 0) badge = '<span class="badge badge-danger">Kadaluarsa</span>';
            else if (b.stok_sisa === 0) badge = '<span class="badge badge-danger">Habis</span>';
            else if (b.stok_sisa < 10) badge = '<span class="badge badge-warn">Menipis</span>';
            else badge = '<span class="badge badge-ok">Aman</span>';

            const fifoTag = (idx === 0 && b.stok_sisa > 0) ? '<span class="fifo-tag">FIFO #1 — keluar duluan</span>' : '';

            html += `
            <tr class="batch-row ${isOpen ? 'show' : ''}" data-parent="${esc(nama)}">
                <td>Batch ${idx + 1}${fifoTag}${b.keterangan ? `<br><small style="color:var(--text-muted)">${esc(b.keterangan)}</small>` : ''}</td>
                <td>${esc(b.no_faktur) || '-'}</td>
                <td>${esc(b.pbf) || '-'}</td>
                <td style="font-family:monospace">${formatTgl(b.tgl_masuk)}</td>
                <td style="font-family:monospace">${formatTgl(b.tgl_expired)}</td>
                <td class="text-right">${formatRp(b.harga_satuan)}</td>
                <td class="text-right"><strong>${b.stok_sisa}</strong> <small>${esc(b.satuan)}</small></td>
                <td class="text-right">${formatRp(b.stok_sisa * parseFloat(b.harga_satuan || 0))}</td>
                <td>${badge}</td>
                <td class="text-center">
                    <button type="button" class="btn-delete-row" onclick="hapusBatch('${b.id}', '${esc(b.nama_obat).replace(/'/g, "\\'")}')" title="Hapus batch (koreksi salah input)"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>`;
        });
    });

    tbody.innerHTML = html;

    // Toggle expand/collapse grup
    tbody.querySelectorAll('.group-row').forEach(row => {
        row.addEventListener('click', () => {
            const nama = row.dataset.group;
            const open = openGroups.has(nama);
            if (open) openGroups.delete(nama); else openGroups.add(nama);
            row.classList.toggle('open');
            tbody.querySelectorAll(`.batch-row[data-parent="${CSS.escape(nama)}"]`).forEach(r => r.classList.toggle('show'));
        });
    });
}

// Gaya tombol hapus (dipakai render di atas)
const styleDel = document.createElement('style');
styleDel.textContent = `.btn-delete-row{background:transparent;color:var(--text-muted);border:1px solid transparent;padding:8px 11px;border-radius:8px;cursor:pointer;transition:all .2s}.btn-delete-row:hover{background:#fef2f2;color:var(--danger);border-color:#fee2e2}`;
document.head.appendChild(styleDel);

/* ============================================================
   HAPUS BATCH (koreksi salah input)
   ============================================================ */
async function hapusBatch(id, nama) {
    const ok = confirm(`KOREKSI DATA\n\nHapus batch "${nama}" ini beserta seluruh riwayat transaksinya?\n\nGunakan hanya untuk memperbaiki kesalahan input. Nilai aset & laporan bulanan akan ikut terkoreksi otomatis.`);
    if (!ok) return;

    // Hapus transaksi terkait dulu, lalu batch-nya
    const { error: e1 } = await db.from('apotek_transaksi').delete().eq('batch_id', id);
    const { error: e2 } = await db.from('apotek_batch').delete().eq('id', id);
    if (e1 || e2) { alert('Gagal menghapus: ' + (e1?.message || e2?.message)); return; }
    await muatSemuaData();
}
window.hapusBatch = hapusBatch;

/* ============================================================
   MODAL HANDLING
   ============================================================ */
function setupModals() {
    const pairs = [
        ['btnObatMasuk', 'modalMasuk'],
        ['btnObatKeluar', 'modalKeluar'],
        ['btnImport', 'modalImport'],
        ['btnExport', 'modalExport'],
    ];
    pairs.forEach(([btnId, modalId]) => {
        document.getElementById(btnId).addEventListener('click', () => {
            if (modalId === 'modalKeluar') populateDropdownKeluar();
            document.getElementById(modalId).classList.add('show');
        });
    });
    document.querySelectorAll('.modal').forEach(m => {
        m.querySelector('.close-modal').addEventListener('click', () => m.classList.remove('show'));
        m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
    });
}

/* ============================================================
   FORM OBAT MASUK (poin 1 & 3)
   ============================================================ */
function setupForms() {
    // Preview total nilai masuk
    const updatePreviewMasuk = () => {
        const j = parseInt(document.getElementById('in_jumlah').value) || 0;
        const h = parseFloat(document.getElementById('in_harga').value) || 0;
        document.getElementById('previewMasuk').innerText = 'Total nilai: ' + formatRp(j * h);
    };
    document.getElementById('in_jumlah').addEventListener('input', updatePreviewMasuk);
    document.getElementById('in_harga').addEventListener('input', updatePreviewMasuk);

    document.getElementById('formMasuk').addEventListener('submit', async function (e) {
        e.preventDefault();
        const row = {
            nama_obat: document.getElementById('in_nama').value.trim(),
            satuan: document.getElementById('in_satuan').value.trim(),
            jumlah: parseInt(document.getElementById('in_jumlah').value),
            harga: parseFloat(document.getElementById('in_harga').value),
            expired: document.getElementById('in_expired').value,
            tgl_masuk: document.getElementById('in_tglmasuk').value,
            faktur: document.getElementById('in_faktur').value.trim() || null,
            pbf: document.getElementById('in_pbf').value.trim(),
            keterangan: document.getElementById('in_keterangan').value.trim() || null,
        };
        const btn = this.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            await prosesObatMasuk(row, 'Pembelian');
            alert('Obat masuk berhasil dicatat sebagai batch baru & masuk laporan pembelian bulan ini.');
            this.reset();
            document.getElementById('in_tglmasuk').value = todayStr();
            document.getElementById('previewMasuk').innerText = 'Total nilai: Rp 0';
            document.getElementById('modalMasuk').classList.remove('show');
            await muatSemuaData();
        } catch (err) {
            alert('Gagal menyimpan: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });

    setupFormKeluar();
}

// Insert batch + transaksi MASUK. Jika batch identik (nama+harga+expired+faktur+pbf) sudah ada, stoknya ditambah.
async function prosesObatMasuk(row, kategori) {
    const existing = batchData.find(b =>
        b.nama_obat.toLowerCase() === row.nama_obat.toLowerCase() &&
        parseFloat(b.harga_satuan) === row.harga &&
        b.tgl_expired === row.expired &&
        (b.no_faktur || '') === (row.faktur || '') &&
        (b.pbf || '').toLowerCase() === (row.pbf || '').toLowerCase()
    );

    let batchId;
    if (existing) {
        const { error } = await db.from('apotek_batch').update({
            stok_awal: existing.stok_awal + row.jumlah,
            stok_sisa: existing.stok_sisa + row.jumlah,
            updated_at: new Date().toISOString()
        }).eq('id', existing.id);
        if (error) throw error;
        batchId = existing.id;
    } else {
        const { data, error } = await db.from('apotek_batch').insert([{
            nama_obat: row.nama_obat, satuan: row.satuan, harga_satuan: row.harga,
            stok_awal: row.jumlah, stok_sisa: row.jumlah,
            tgl_expired: row.expired, no_faktur: row.faktur, pbf: row.pbf,
            tgl_masuk: row.tgl_masuk, keterangan: row.keterangan
        }]).select().single();
        if (error) throw error;
        batchId = data.id;
    }

    const { error: errTrx } = await db.from('apotek_transaksi').insert([{
        batch_id: batchId, nama_obat: row.nama_obat, satuan: row.satuan,
        jenis: 'MASUK', kategori: kategori,
        jumlah: row.jumlah, harga_satuan: row.harga, total_nilai: row.jumlah * row.harga,
        no_faktur: row.faktur, pbf: row.pbf, tanggal: row.tgl_masuk, keterangan: row.keterangan
    }]);
    if (errTrx) throw errTrx;
}

/* ============================================================
   FORM OBAT KELUAR + MESIN FIFO (poin 2 & 4)
   ============================================================ */
function populateDropdownKeluar() {
    const sel = document.getElementById('out_nama');
    const aktif = batchData.filter(b => b.stok_sisa > 0);
    const namaMap = {};
    aktif.forEach(b => { namaMap[b.nama_obat] = (namaMap[b.nama_obat] || 0) + b.stok_sisa; });

    const names = Object.keys(namaMap).sort((a, b) => a.localeCompare(b));
    sel.innerHTML = names.length === 0
        ? '<option value="" disabled selected>Tidak ada stok tersedia</option>'
        : '<option value="" disabled selected>-- Pilih Obat --</option>' +
          names.map(n => `<option value="${esc(n)}">${esc(n)} (sisa: ${namaMap[n]})</option>`).join('');

    updateBatchDropdown();
    updateInfoKeluar();
}

function updateBatchDropdown() {
    const nama = document.getElementById('out_nama').value;
    const selBatch = document.getElementById('out_batch');
    if (!nama) { selBatch.innerHTML = ''; return; }
    const batches = sortFifo(batchData.filter(b => b.nama_obat === nama && b.stok_sisa > 0));
    selBatch.innerHTML = batches.map(b =>
        `<option value="${b.id}">Exp ${formatTgl(b.tgl_expired)} | ${esc(b.pbf) || '-'} | Faktur ${esc(b.no_faktur) || '-'} | sisa ${b.stok_sisa} | ${formatRp(b.harga_satuan)}/sat</option>`
    ).join('');
}

function updateInfoKeluar() {
    const nama = document.getElementById('out_nama').value;
    const info = document.getElementById('out_stok_info');
    const preview = document.getElementById('previewKeluar');
    if (!nama) { info.innerText = ''; preview.style.display = 'none'; return; }

    const metode = document.getElementById('out_metode').value;
    const jumlah = parseInt(document.getElementById('out_jumlah').value) || 0;

    let batches;
    if (metode === 'manual') {
        const bid = document.getElementById('out_batch').value;
        batches = batchData.filter(b => b.id === bid);
    } else {
        batches = sortFifo(batchData.filter(b => b.nama_obat === nama && b.stok_sisa > 0));
    }
    const tersedia = batches.reduce((s, b) => s + b.stok_sisa, 0);
    info.innerText = metode === 'manual'
        ? `Sisa stok batch terpilih: ${tersedia}`
        : `Total tersedia (semua batch): ${tersedia}. Batch pertama FIFO: ${batches[0] ? 'masuk ' + formatTgl(batches[0].tgl_masuk) + ', exp ' + formatTgl(batches[0].tgl_expired) : '-'}`;

    if (jumlah > 0) {
        // Simulasi FIFO untuk preview nilai
        let sisa = jumlah, nilai = 0, potongan = [];
        for (const b of batches) {
            if (sisa <= 0) break;
            const ambil = Math.min(b.stok_sisa, sisa);
            nilai += ambil * parseFloat(b.harga_satuan || 0);
            potongan.push(`${ambil} dari batch exp ${formatTgl(b.tgl_expired)}`);
            sisa -= ambil;
        }
        preview.style.display = 'block';
        preview.innerHTML = sisa > 0
            ? `<span style="color:var(--danger)">Stok tidak cukup! Kurang ${sisa}.</span>`
            : `Nilai keluar (harga beli FIFO): <strong>${formatRp(nilai)}</strong><br><small style="font-weight:400;color:var(--text-muted)">${potongan.join(' + ')}</small>`;
    } else {
        preview.style.display = 'none';
    }
}

function setupFormKeluar() {
    document.getElementById('out_nama').addEventListener('change', () => { updateBatchDropdown(); updateInfoKeluar(); });
    document.getElementById('out_metode').addEventListener('change', function () {
        document.getElementById('out_batch_wrap').style.display = this.value === 'manual' ? 'block' : 'none';
        updateInfoKeluar();
    });
    document.getElementById('out_batch').addEventListener('change', updateInfoKeluar);
    document.getElementById('out_jumlah').addEventListener('input', updateInfoKeluar);

    // Saran otomatis: kategori Expired -> metode manual (pilih batch yang expired)
    document.getElementById('out_kategori').addEventListener('change', function () {
        if (this.value === 'Obat Expired' || this.value === 'Obat Rusak') {
            document.getElementById('out_metode').value = 'manual';
            document.getElementById('out_batch_wrap').style.display = 'block';
        }
        updateInfoKeluar();
    });

    document.getElementById('formKeluar').addEventListener('submit', async function (e) {
        e.preventDefault();
        const nama = document.getElementById('out_nama').value;
        const kategori = document.getElementById('out_kategori').value;
        const metode = document.getElementById('out_metode').value;
        const jumlah = parseInt(document.getElementById('out_jumlah').value);
        const tanggal = document.getElementById('out_tanggal').value;
        const keterangan = document.getElementById('out_keterangan').value.trim() || null;
        const batchIdManual = metode === 'manual' ? document.getElementById('out_batch').value : null;

        if (!nama) { alert('Pilih obat terlebih dahulu.'); return; }

        const btn = this.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            const hasil = await prosesObatKeluarFIFO(nama, jumlah, kategori, tanggal, keterangan, batchIdManual);
            alert(`Obat keluar berhasil dicatat.\nKategori: ${kategori}\nJumlah: ${jumlah}\nNilai (harga beli FIFO): ${formatRp(hasil.totalNilai)}\nDiambil dari ${hasil.batchCount} batch.`);
            this.reset();
            document.getElementById('out_tanggal').value = todayStr();
            document.getElementById('previewKeluar').style.display = 'none';
            document.getElementById('out_batch_wrap').style.display = 'none';
            document.getElementById('modalKeluar').classList.remove('show');
            await muatSemuaData();
        } catch (err) {
            alert('Gagal: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });
}

// MESIN FIFO: mengurangi stok mulai dari batch paling awal masuk,
// bisa melintasi beberapa batch sekaligus. Nilai keluar = harga beli batch masing-masing.
async function prosesObatKeluarFIFO(nama, jumlah, kategori, tanggal, keterangan, batchIdManual) {
    let batches;
    if (batchIdManual) {
        batches = batchData.filter(b => b.id === batchIdManual && b.stok_sisa > 0);
        if (batches.length === 0) throw new Error('Batch terpilih tidak ditemukan / stok habis.');
    } else {
        batches = sortFifo(batchData.filter(b => b.nama_obat === nama && b.stok_sisa > 0));
    }

    const tersedia = batches.reduce((s, b) => s + b.stok_sisa, 0);
    if (jumlah > tersedia) throw new Error(`Stok tidak cukup. Diminta ${jumlah}, tersedia ${tersedia}.`);

    let sisa = jumlah;
    let totalNilai = 0;
    const trxRows = [];

    for (const b of batches) {
        if (sisa <= 0) break;
        const ambil = Math.min(b.stok_sisa, sisa);
        sisa -= ambil;

        const { error } = await db.from('apotek_batch')
            .update({ stok_sisa: b.stok_sisa - ambil, updated_at: new Date().toISOString() })
            .eq('id', b.id);
        if (error) throw error;

        const nilai = ambil * parseFloat(b.harga_satuan || 0);
        totalNilai += nilai;
        trxRows.push({
            batch_id: b.id, nama_obat: b.nama_obat, satuan: b.satuan,
            jenis: 'KELUAR', kategori: kategori,
            jumlah: ambil, harga_satuan: b.harga_satuan, total_nilai: nilai,
            no_faktur: b.no_faktur, pbf: b.pbf, tanggal: tanggal, keterangan: keterangan
        });
    }

    const { error: errTrx } = await db.from('apotek_transaksi').insert(trxRows);
    if (errTrx) throw errTrx;

    return { totalNilai, batchCount: trxRows.length };
}

/* ============================================================
   TAB 2: LAPORAN BULANAN (poin 6, 7, 8)
   ============================================================ */
function trxBulan(ym) {
    return transaksiData.filter(t => (t.tanggal || '').startsWith(ym));
}

function renderLaporanBulanan() {
    const ym = document.getElementById('laporanBulan').value || monthStr();
    const trx = trxBulan(ym);

    // --- Pembelian bulan ini (poin 6) ---
    const masuk = trx.filter(t => t.jenis === 'MASUK');
    const beliRp = masuk.reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0);
    const beliQty = masuk.reduce((s, t) => s + (t.jumlah || 0), 0);
    document.getElementById('lapPembelianRp').innerText = formatRp(beliRp);
    document.getElementById('lapPembelianQty').innerText = `${beliQty} item · ${masuk.length} transaksi`;

    // --- Keluar bulan ini per kategori (poin 7) ---
    const keluar = trx.filter(t => t.jenis === 'KELUAR');
    const keluarRp = keluar.reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0);
    const keluarQty = keluar.reduce((s, t) => s + (t.jumlah || 0), 0);
    document.getElementById('lapKeluarRp').innerText = formatRp(keluarRp);
    document.getElementById('lapKeluarQty').innerText = `${keluarQty} item · ${keluar.length} transaksi`;
    document.getElementById('lapSelisihRp').innerText = formatRp(beliRp - keluarRp);

    const ul = document.getElementById('lapKategoriList');
    let html = '';
    KATEGORI_KELUAR.forEach(kat => {
        const rows = keluar.filter(t => t.kategori === kat);
        const rp = rows.reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0);
        const qty = rows.reduce((s, t) => s + (t.jumlah || 0), 0);
        html += `<li>
            <span class="k-left"><span class="k-dot" style="background:${KATEGORI_WARNA[kat]}"></span>${kat} <span class="k-qty">(${qty} item)</span></span>
            <span class="k-rp">${formatRp(rp)}</span>
        </li>`;
    });
    html += `<li class="total-row"><span class="k-left">TOTAL KELUAR ${labelBulan(ym).toUpperCase()}</span><span class="k-rp">${formatRp(keluarRp)}</span></li>`;
    ul.innerHTML = html;

    // --- Rincian pembelian per obat ---
    const beliMap = {};
    masuk.forEach(t => {
        const k = t.nama_obat;
        if (!beliMap[k]) beliMap[k] = { qty: 0, rp: 0, satuan: t.satuan };
        beliMap[k].qty += t.jumlah || 0;
        beliMap[k].rp += parseFloat(t.total_nilai || 0);
    });
    const beliBody = document.getElementById('lapPembelianBody');
    const beliKeys = Object.keys(beliMap).sort((a, b) => beliMap[b].rp - beliMap[a].rp);
    beliBody.innerHTML = beliKeys.length === 0
        ? '<tr><td colspan="3" class="text-center">Tidak ada pembelian pada bulan ini</td></tr>'
        : beliKeys.map(k => `<tr><td>${esc(k)}</td><td class="text-right">${beliMap[k].qty} ${esc(beliMap[k].satuan || '')}</td><td class="text-right">${formatRp(beliMap[k].rp)}</td></tr>`).join('');
}

// Rekap 12 bulan terakhir untuk perbandingan (poin 8)
function renderRekapBulanan() {
    const tbody = document.getElementById('rekapBulananBody');
    const now = new Date();
    let html = '';

    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = monthStr(d);
        const trx = trxBulan(ym);
        if (trx.length === 0 && i > 0) continue; // lewati bulan kosong (kecuali bulan berjalan)

        const beli = trx.filter(t => t.jenis === 'MASUK').reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0);
        const perKat = {};
        KATEGORI_KELUAR.forEach(k => perKat[k] = 0);
        let totalKeluar = 0;
        trx.filter(t => t.jenis === 'KELUAR').forEach(t => {
            const kat = KATEGORI_KELUAR.includes(t.kategori) ? t.kategori : 'Lainnya';
            perKat[kat] += parseFloat(t.total_nilai || 0);
            totalKeluar += parseFloat(t.total_nilai || 0);
        });

        html += `<tr ${i === 0 ? 'style="background:var(--primary-soft);font-weight:700"' : ''}>
            <td>${labelBulan(ym)}${i === 0 ? ' <small>(berjalan)</small>' : ''}</td>
            <td class="text-right">${formatRp(beli)}</td>
            <td class="text-right">${formatRp(perKat['Resep Dokter'])}</td>
            <td class="text-right">${formatRp(perKat['Obat Expired'])}</td>
            <td class="text-right">${formatRp(perKat['Obat Rusak'])}</td>
            <td class="text-right">${formatRp(perKat['Lainnya'])}</td>
            <td class="text-right" style="color:var(--danger);font-weight:700">${formatRp(totalKeluar)}</td>
        </tr>`;
    }

    tbody.innerHTML = html || '<tr><td colspan="7" class="text-center">Belum ada transaksi</td></tr>';
}

/* ============================================================
   TAB 3: RIWAYAT TRANSAKSI
   ============================================================ */
function renderRiwayat() {
    const tbody = document.getElementById('tabelRiwayatBody');
    const jenis = document.getElementById('riwayatFilterJenis').value;
    const bulan = document.getElementById('riwayatFilterBulan').value;

    let list = transaksiData;
    if (jenis) list = list.filter(t => t.jenis === jenis);
    if (bulan) list = list.filter(t => (t.tanggal || '').startsWith(bulan));
    list = list.slice(0, 300); // batasi tampilan

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Tidak ada transaksi.</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(t => `
        <tr>
            <td style="font-family:monospace">${formatTgl(t.tanggal)}</td>
            <td><span class="badge ${t.jenis === 'MASUK' ? 'badge-masuk' : 'badge-keluar'}">${t.jenis}</span></td>
            <td>${esc(t.kategori)}</td>
            <td><strong>${esc(t.nama_obat)}</strong></td>
            <td class="text-right">${t.jumlah} <small>${esc(t.satuan || '')}</small></td>
            <td class="text-right">${formatRp(t.harga_satuan)}</td>
            <td class="text-right" style="font-weight:600;color:${t.jenis === 'MASUK' ? 'var(--success)' : 'var(--danger)'}">${formatRp(t.total_nilai)}</td>
            <td><small>${esc(t.no_faktur) || '-'}<br>${esc(t.pbf) || '-'}</small></td>
            <td><small>${esc(t.keterangan) || '-'}</small></td>
        </tr>`).join('');
}

/* ============================================================
   DATALIST FORM (auto-complete)
   ============================================================ */
function populateFormLists() {
    const fill = (id, values) => {
        const el = document.getElementById(id);
        el.innerHTML = [...new Set(values.filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join('');
    };
    fill('namaObatList', batchData.map(b => b.nama_obat));
    fill('satuanList', batchData.map(b => b.satuan));
    fill('pbfList', batchData.map(b => b.pbf));
}

/* ============================================================
   IMPORT & EXPORT EXCEL (poin 9 & 10)
   ============================================================ */
const TEMPLATE_HEADERS = ['Nama Obat', 'Satuan', 'Jumlah Stok', 'Harga Satuan (Rp)', 'Tanggal Expired', 'No Faktur', 'PBF', 'Tanggal Masuk', 'Keterangan'];

function setupImportExport() {
    // --- Download template ---
    document.getElementById('btnDownloadTemplate').addEventListener('click', () => {
        const contoh = [
            { 'Nama Obat': 'Parasetamol 500mg', 'Satuan': 'Tablet', 'Jumlah Stok': 200, 'Harga Satuan (Rp)': 350, 'Tanggal Expired': '2027-05-31', 'No Faktur': 'FK-2026/07/001', 'PBF': 'PT Kimia Farma', 'Tanggal Masuk': '2026-07-01', 'Keterangan': 'Contoh - hapus baris ini' },
            { 'Nama Obat': 'Amoxicillin 500mg', 'Satuan': 'Kapsul', 'Jumlah Stok': 100, 'Harga Satuan (Rp)': 800, 'Tanggal Expired': '2027-03-15', 'No Faktur': 'FK-2026/07/002', 'PBF': 'PT Enseval', 'Tanggal Masuk': '2026-07-01', 'Keterangan': 'Contoh - hapus baris ini' },
        ];
        const ws = XLSX.utils.json_to_sheet(contoh, { header: TEMPLATE_HEADERS });
        ws['!cols'] = TEMPLATE_HEADERS.map(h => ({ wch: Math.max(h.length + 4, 16) }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template Stok');

        // Sheet petunjuk
        const petunjuk = [
            ['PETUNJUK PENGISIAN TEMPLATE IMPORT STOK OBAT'],
            [''],
            ['1. Isi data pada sheet "Template Stok". Jangan mengubah nama kolom di baris pertama.'],
            ['2. Hapus 2 baris contoh sebelum meng-import.'],
            ['3. Format Tanggal Expired & Tanggal Masuk: YYYY-MM-DD (misal 2027-05-31) atau format tanggal Excel biasa.'],
            ['4. Jumlah Stok & Harga Satuan diisi angka saja (tanpa "Rp" atau titik pemisah ribuan).'],
            ['5. Kolom wajib: Nama Obat, Satuan, Jumlah Stok, Harga Satuan, Tanggal Expired, PBF.'],
            ['6. No Faktur, Tanggal Masuk, dan Keterangan boleh dikosongkan (Tanggal Masuk kosong = hari ini).'],
            ['7. Setiap baris akan menjadi 1 batch stok, dibedakan per Tgl Expired / Faktur / PBF (sistem FIFO).'],
        ];
        const ws2 = XLSX.utils.aoa_to_sheet(petunjuk);
        ws2['!cols'] = [{ wch: 100 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Petunjuk');

        XLSX.writeFile(wb, 'Template_Import_Stok_Obat.xlsx');
    });

    // --- Pilih file ---
    const dropzone = document.getElementById('importDropzone');
    const fileInput = document.getElementById('importFile');
    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleImportFile);

    // --- Proses import ---
    document.getElementById('btnProsesImport').addEventListener('click', prosesImport);

    // --- Export ---
    document.getElementById('btnProsesExport').addEventListener('click', exportToExcel);
}

// Parse tanggal fleksibel: Date object, 'YYYY-MM-DD', 'DD/MM/YYYY', serial Excel
function parseTanggal(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return v.toISOString().split('T')[0];
    if (typeof v === 'number') { // serial Excel
        const d = new Date(Math.round((v - 25569) * 86400 * 1000));
        return isNaN(d) ? null : d.toISOString().split('T')[0];
    }
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // DD/MM/YYYY
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const d = new Date(s);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
}

function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        try {
            const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            importRows = rows.map((r, i) => {
                const nama = String(r['Nama Obat'] || '').trim();
                const satuan = String(r['Satuan'] || '').trim();
                const jumlah = parseInt(r['Jumlah Stok']);
                const harga = parseFloat(r['Harga Satuan (Rp)']);
                const expired = parseTanggal(r['Tanggal Expired']);
                const faktur = String(r['No Faktur'] || '').trim() || null;
                const pbf = String(r['PBF'] || '').trim();
                const tglMasuk = parseTanggal(r['Tanggal Masuk']) || todayStr();
                const keterangan = String(r['Keterangan'] || '').trim() || null;

                let err = null;
                if (!nama) err = 'Nama obat kosong';
                else if (!satuan) err = 'Satuan kosong';
                else if (!jumlah || jumlah < 1) err = 'Jumlah tidak valid';
                else if (isNaN(harga) || harga < 0) err = 'Harga tidak valid';
                else if (!expired) err = 'Tgl expired tidak valid';
                else if (!pbf) err = 'PBF kosong';

                return { no: i + 1, nama, satuan, jumlah, harga, expired, faktur, pbf, tglMasuk, keterangan, err };
            }).filter(r => r.nama || r.satuan || r.jumlah); // buang baris benar-benar kosong

            renderImportPreview();
        } catch (err) {
            alert('Gagal membaca file: ' + err.message);
        }
        e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
}

function renderImportPreview() {
    const wrap = document.getElementById('importPreview');
    const body = document.getElementById('importPreviewBody');
    const summary = document.getElementById('importSummary');

    if (importRows.length === 0) {
        wrap.style.display = 'none';
        alert('Tidak ada data terbaca pada file. Pastikan menggunakan template yang disediakan.');
        return;
    }

    const valid = importRows.filter(r => !r.err).length;
    const invalid = importRows.length - valid;
    summary.innerHTML = `Terbaca <strong>${importRows.length} baris</strong>: <span style="color:var(--success)">${valid} valid</span>${invalid ? `, <span style="color:var(--danger)">${invalid} bermasalah (akan dilewati)</span>` : ''}.`;

    body.innerHTML = importRows.map(r => `
        <tr style="${r.err ? 'background:#fef2f2' : ''}">
            <td>${r.no}</td><td>${esc(r.nama)}</td><td>${esc(r.satuan)}</td>
            <td class="text-right">${r.jumlah || '-'}</td>
            <td class="text-right">${isNaN(r.harga) ? '-' : formatRp(r.harga)}</td>
            <td>${r.expired || '-'}</td><td>${esc(r.faktur) || '-'}</td><td>${esc(r.pbf) || '-'}</td>
            <td>${r.err ? `<span class="badge badge-danger">${r.err}</span>` : '<span class="badge badge-ok">OK</span>'}</td>
        </tr>`).join('');

    wrap.style.display = 'block';
}

async function prosesImport() {
    const validRows = importRows.filter(r => !r.err);
    if (validRows.length === 0) { alert('Tidak ada baris valid untuk di-import.'); return; }
    if (!confirm(`Import ${validRows.length} baris data stok? Setiap baris akan menjadi batch baru dan tercatat sebagai transaksi masuk.`)) return;

    const btn = document.getElementById('btnProsesImport');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

    try {
        // Insert semua batch sekaligus
        const batchRows = validRows.map(r => ({
            nama_obat: r.nama, satuan: r.satuan, harga_satuan: r.harga,
            stok_awal: r.jumlah, stok_sisa: r.jumlah,
            tgl_expired: r.expired, no_faktur: r.faktur, pbf: r.pbf,
            tgl_masuk: r.tglMasuk, keterangan: r.keterangan
        }));
        const { data: inserted, error: e1 } = await db.from('apotek_batch').insert(batchRows).select();
        if (e1) throw e1;

        // Insert transaksi MASUK untuk tiap batch
        const trxRows = inserted.map(b => ({
            batch_id: b.id, nama_obat: b.nama_obat, satuan: b.satuan,
            jenis: 'MASUK', kategori: 'Import Stok Awal',
            jumlah: b.stok_awal, harga_satuan: b.harga_satuan,
            total_nilai: b.stok_awal * parseFloat(b.harga_satuan || 0),
            no_faktur: b.no_faktur, pbf: b.pbf, tanggal: b.tgl_masuk, keterangan: b.keterangan
        }));
        const { error: e2 } = await db.from('apotek_transaksi').insert(trxRows);
        if (e2) throw e2;

        alert(`Import berhasil! ${validRows.length} batch stok telah ditambahkan.`);
        importRows = [];
        document.getElementById('importPreview').style.display = 'none';
        document.getElementById('modalImport').classList.remove('show');
        await muatSemuaData();
    } catch (err) {
        alert('Import gagal: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Proses Import';
    }
}

// --- EXPORT KE EXCEL: 3 sheet (poin 9) ---
function exportToExcel() {
    const tglMulai = document.getElementById('exportMulai').value;
    const tglSelesai = document.getElementById('exportSelesai').value;
    if (!tglMulai || !tglSelesai) { alert('Pilih rentang tanggal terlebih dahulu!'); return; }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Stok saat ini (per batch, urutan FIFO)
    const stokRows = [];
    const groups = {};
    batchData.filter(b => b.stok_sisa > 0).forEach(b => {
        if (!groups[b.nama_obat]) groups[b.nama_obat] = [];
        groups[b.nama_obat].push(b);
    });
    Object.keys(groups).sort().forEach(nama => {
        sortFifo(groups[nama]).forEach((b, idx) => {
            stokRows.push({
                'Nama Obat': b.nama_obat, 'Urutan FIFO': idx + 1, 'Satuan': b.satuan,
                'Sisa Stok': b.stok_sisa, 'Harga Satuan (Rp)': parseFloat(b.harga_satuan || 0),
                'Nilai (Rp)': b.stok_sisa * parseFloat(b.harga_satuan || 0),
                'Tanggal Masuk': b.tgl_masuk, 'Tanggal Expired': b.tgl_expired,
                'No Faktur': b.no_faktur || '-', 'PBF': b.pbf || '-', 'Keterangan': b.keterangan || '-'
            });
        });
    });
    const totalAset = stokRows.reduce((s, r) => s + r['Nilai (Rp)'], 0);
    stokRows.push({}, { 'Nama Obat': 'TOTAL NILAI ASET OBAT', 'Nilai (Rp)': totalAset });
    const ws1 = XLSX.utils.json_to_sheet(stokRows);
    ws1['!cols'] = [{ wch: 28 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Stok Saat Ini');

    // Sheet 2: Riwayat transaksi (rentang tanggal)
    const trxFiltered = transaksiData.filter(t => t.tanggal >= tglMulai && t.tanggal <= tglSelesai);
    const trxRows = trxFiltered.map(t => ({
        'Tanggal': t.tanggal, 'Jenis': t.jenis, 'Kategori': t.kategori,
        'Nama Obat': t.nama_obat, 'Satuan': t.satuan || '-', 'Jumlah': t.jumlah,
        'Harga Satuan (Rp)': parseFloat(t.harga_satuan || 0), 'Total Nilai (Rp)': parseFloat(t.total_nilai || 0),
        'No Faktur': t.no_faktur || '-', 'PBF': t.pbf || '-', 'Keterangan': t.keterangan || '-'
    }));
    const ws2 = XLSX.utils.json_to_sheet(trxRows.length ? trxRows : [{ 'Info': 'Tidak ada transaksi pada rentang tanggal ini' }]);
    ws2['!cols'] = [{ wch: 12 }, { wch: 9 }, { wch: 17 }, { wch: 28 }, { wch: 10 }, { wch: 9 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Riwayat Transaksi');

    // Sheet 3: Rekap bulanan (12 bulan)
    const rekapRows = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = monthStr(d);
        const trx = trxBulan(ym);
        if (trx.length === 0) continue;
        const beliT = trx.filter(t => t.jenis === 'MASUK');
        const perKat = {}; KATEGORI_KELUAR.forEach(k => perKat[k] = 0);
        let totKeluar = 0;
        trx.filter(t => t.jenis === 'KELUAR').forEach(t => {
            const k = KATEGORI_KELUAR.includes(t.kategori) ? t.kategori : 'Lainnya';
            perKat[k] += parseFloat(t.total_nilai || 0);
            totKeluar += parseFloat(t.total_nilai || 0);
        });
        rekapRows.push({
            'Bulan': labelBulan(ym),
            'Pembelian (Rp)': beliT.reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0),
            'Pembelian (Qty)': beliT.reduce((s, t) => s + (t.jumlah || 0), 0),
            'Keluar - Resep Dokter (Rp)': perKat['Resep Dokter'],
            'Keluar - Obat Expired (Rp)': perKat['Obat Expired'],
            'Keluar - Obat Rusak (Rp)': perKat['Obat Rusak'],
            'Keluar - Lainnya (Rp)': perKat['Lainnya'],
            'Total Keluar (Rp)': totKeluar
        });
    }
    const ws3 = XLSX.utils.json_to_sheet(rekapRows.length ? rekapRows : [{ 'Info': 'Belum ada transaksi' }]);
    ws3['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 24 }, { wch: 24 }, { wch: 22 }, { wch: 20 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws3, 'Rekap Bulanan');

    XLSX.writeFile(wb, `Laporan_Stok_Farmasi_${tglMulai}_sd_${tglSelesai}.xlsx`);
    document.getElementById('modalExport').classList.remove('show');
}
