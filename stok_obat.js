/* ============================================================
   MANAJEMEN STOK OBAT — KLINIK IMANUEL (REDESIGN)
   Sistem batch FEFO + laporan bulanan + import/export Excel
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

/* Batas usia transaksi yang masih boleh dibatalkan. Angka ini juga
   ditegakkan di fungsi Postgres batalkan_transaksi_apotek(); yang di
   sini hanya untuk menonaktifkan tombol lebih awal supaya pemakai tidak
   menekan sesuatu yang sudah pasti ditolak. Server tetap penentunya. */
const BATAS_BATAL_HARI = 7;
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
/* Tanggal lokal. toISOString() menghasilkan UTC, jadi di WITA (UTC+8)
   sebelum pukul 08.00 ia mengembalikan tanggal KEMARIN: form Obat
   Masuk/Keluar terisi tanggal salah untuk input pagi. Perbaikan yang
   sama sudah dipakai di dashboard.html lewat tglLokal(). */
function tglLokal(d) {
    const x = d || new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function todayStr() { return tglLokal(); }
function monthStr(d) { const x = d || new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; }
function labelBulan(ym) { const [y, m] = ym.split('-'); return `${BULAN_ID[parseInt(m) - 1]} ${y}`; }
function esc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/* ── URUTAN KELUAR & PENJAGA KADALUWARSA ──────────────────────
   Dulu berkas ini memakai FIFO murni (urut tanggal masuk). Untuk obat
   itu keliru: batch yang masuk lebih dulu bisa saja expired-nya masih
   lama, sementara batch yang masuk belakangan justru sudah mau lewat.
   Dengan FIFO, batch yang mau lewat itu mengendap sampai benar-benar
   kadaluwarsa. FEFO membalik urutannya: yang paling dekat expired
   keluar duluan. Kalau tanggal expired-nya sama, barulah tanggal
   masuk yang menentukan — jadi FIFO tetap jadi pemutus seri. */

// Kategori yang memang bertujuan MEMBUANG stok. Hanya di sini batch
// kadaluwarsa boleh dikeluarkan — itu justru gunanya.
const KATEGORI_PEMUSNAHAN = ['Obat Expired', 'Obat Rusak'];

function awalHariIni() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

// Batch yang expired-nya jatuh hari ini sudah dihitung kadaluwarsa —
// sama seperti kartu ringkasan di atas, supaya tidak ada dua definisi.
function sudahExpired(b, today) {
    return new Date(b.tgl_expired) <= (today || awalHariIni());
}

// Urutan FEFO: expired terdekat paling depan.
function sortFefo(list) {
    return [...list].sort((a, b) =>
        new Date(a.tgl_expired) - new Date(b.tgl_expired) ||
        new Date(a.tgl_masuk) - new Date(b.tgl_masuk) ||
        new Date(a.created_at) - new Date(b.created_at)
    );
}

// Batch yang boleh dipakai untuk kategori tertentu.
function batchBolehKeluar(list, kategori) {
    if (KATEGORI_PEMUSNAHAN.includes(kategori)) return list;
    const today = awalHariIni();
    return list.filter(b => !sudahExpired(b, today));
}

/* ============================================================
   AUTHENTICATION
   ============================================================ */
/* Sandi tidak lagi tertulis di berkas ini. Dulu ada perbandingan
   langsung dengan sebuah string di baris ini — dan berkas ini terbuka
   untuk siapa pun yang membuka View Source di Netlify, jadi sandi itu
   tidak pernah benar-benar rahasia. Sekarang pemeriksaannya lewat
   fungsi Postgres; ganti sandinya di halaman Pengaturan Akun. */
const overlay = document.getElementById('authOverlay');
const mainApp = document.getElementById('mainApp');
const btnMasukAuth = document.getElementById('btnMasukAuth');

btnMasukAuth.addEventListener('click', checkAuth);
document.getElementById('farmasiPassword').addEventListener('keypress', e => { if (e.key === 'Enter') checkAuth(); });

let gagalMasuk = 0;

function pesanAuth(teks) {
    const el = document.getElementById('authError');
    el.innerText = teks;
    el.style.display = teks ? 'block' : 'none';
}

async function checkAuth() {
    const passInput = document.getElementById('farmasiPassword');
    const pw = passInput.value;
    if (!pw) { pesanAuth('Kata sandi belum diisi.'); passInput.focus(); return; }

    btnMasukAuth.disabled = true;
    passInput.disabled = true;
    pesanAuth('');

    // Perlambatan bertingkat supaya percobaan berulang tidak murah.
    if (gagalMasuk >= 3) {
        await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, gagalMasuk - 3), 8000)));
    }

    try {
        const benar = await KiAuth.verifikasi('farmasi', pw);
        if (benar) {
            gagalMasuk = 0;
            overlay.style.display = 'none';
            mainApp.style.display = 'block';
            initApp();
            return;
        }
        gagalMasuk++;
        pesanAuth('Kata sandi salah!');
        passInput.style.borderColor = 'var(--danger)';
    } catch (err) {
        /* GAGAL-TERTUTUP. Jaringan mati, RLS menolak, atau migrasi SQL
           belum dijalankan — modul tetap tidak terbuka. Jangan sekali-kali
           menambahkan cabang yang meloloskan pemakai di sini: kalau ada,
           memutus koneksi ke Supabase jadi cara melewati gerbang. */
        pesanAuth(err.message);
        console.error('[stok_obat] auth', err);
    } finally {
        btnMasukAuth.disabled = false;
        passInput.disabled = false;
        passInput.value = '';
        passInput.focus();
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
    document.getElementById('exportMulai').value = tglLokal(firstDay);
    document.getElementById('exportSelesai').value = todayStr();

    setupTabs();
    setupModals();
    setupForms();
    setupImportExport();

    document.getElementById('searchInput').addEventListener('input', renderTabelStok);
    document.getElementById('laporanBulan').addEventListener('change', renderLaporanBulanan);
    document.getElementById('btnBulanPrev').addEventListener('click', () => geserBulanLaporan(-1));
    document.getElementById('btnBulanNext').addEventListener('click', () => geserBulanLaporan(1));
    document.getElementById('btnExportBulan').addEventListener('click', exportLaporanBulan);
    document.getElementById('lapDetailJenis').addEventListener('change', renderLaporanBulanan);
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
   TAB 1: TABEL STOK (grup per obat, batch urutan FEFO) — poin 1 & 4
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
        const batches = sortFefo(groups[nama]);
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

            const fifoTag = (idx === 0 && b.stok_sisa > 0 && !(exp <= today))
                ? '<span class="fifo-tag">FEFO #1 — keluar duluan</span>' : '';

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
                    <span class="row-actions">
                        <button type="button" class="btn-edit-row" onclick="event.stopPropagation(); editBatch('${b.id}')" title="Edit / koreksi batch ini"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button type="button" class="btn-delete-row" onclick="event.stopPropagation(); hapusBatch('${b.id}', '${esc(b.nama_obat).replace(/'/g, "\\'")}')" title="Hapus batch (koreksi salah input)"><i class="fa-solid fa-trash"></i></button>
                    </span>
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

/* ============================================================
   DIALOG KONFIRMASI "APAKAH ANDA YAKIN?" (Ya / Tidak)
   ============================================================ */
function konfirmasi(judul, pesan, tipe = 'danger', rincianHtml = '', labelYa = 'Ya, Lanjutkan') {
    return new Promise(resolve => {
        const modal = document.getElementById('modalKonfirm');
        const icon = document.getElementById('konfirmIcon');
        const btnYa = document.getElementById('konfirmYa');
        const btnTidak = document.getElementById('konfirmTidak');
        const kotak = modal.querySelector('.confirm-content');
        const rincian = document.getElementById('konfirmRincian');

        document.getElementById('konfirmJudul').innerText = judul;
        document.getElementById('konfirmPesan').innerText = pesan;

        /* Blok rincian dibersihkan setiap kali dipanggil — modal ini dipakai
           bergantian oleh beberapa alur, dan sisa isi dari pemanggilan
           sebelumnya akan tampil sebagai ringkasan yang salah. */
        rincian.innerHTML = rincianHtml || '';
        rincian.style.display = rincianHtml ? 'block' : 'none';
        kotak.classList.toggle('lebar', !!rincianHtml);

        icon.className = 'confirm-icon' + (tipe === 'danger' ? ' danger' : '');
        icon.innerHTML = tipe === 'danger'
            ? '<i class="fa-solid fa-triangle-exclamation"></i>'
            : '<i class="fa-solid fa-circle-question"></i>';
        btnYa.className = tipe === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
        btnYa.innerText = labelYa;

        modal.classList.add('show');

        const selesai = (jawaban) => {
            modal.classList.remove('show');
            btnYa.onclick = null;
            btnTidak.onclick = null;
            modal.onclick = null;
            resolve(jawaban);
        };
        btnYa.onclick = () => selesai(true);
        btnTidak.onclick = () => selesai(false);
        modal.onclick = e => { if (e.target === modal) selesai(false); };
    });
}

/* Susun tabel dua kolom untuk blok rincian konfirmasi.
   Menerima array [label, nilaiHtml]; nilai sudah harus aman-HTML. */
function tabelRincian(pasangan) {
    return '<table class="rincian-tabel"><tbody>' + pasangan.map(([k, v]) =>
        `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('') + '</tbody></table>';
}

/* Simulasi FEFO tanpa menyentuh database.
   Dipakai bersama oleh pratinjau di form DAN oleh dialog konfirmasi,
   supaya angka yang dilihat pemakai sebelum menekan Simpan berasal dari
   perhitungan yang sama persis — bukan dua salinan logika yang bisa
   berbeda diam-diam. */
function simulasiFefo(batches, jumlah) {
    let sisa = jumlah, totalNilai = 0;
    const potongan = [];
    for (const b of batches) {
        if (sisa <= 0) break;
        const ambil = Math.min(b.stok_sisa, sisa);
        const nilai = ambil * parseFloat(b.harga_satuan || 0);
        potongan.push({ batch: b, ambil, nilai });
        totalNilai += nilai;
        sisa -= ambil;
    }
    return { potongan, totalNilai, kurang: sisa };
}

/* ============================================================
   HAPUS BATCH (koreksi salah input) — dengan konfirmasi Ya/Tidak
   ============================================================ */
async function hapusBatch(id, nama) {
    const b = batchData.find(x => x.id === id);
    const detail = b ? `\n\nBatch: exp ${formatTgl(b.tgl_expired)} · ${b.pbf || '-'} · Faktur ${b.no_faktur || '-'} · sisa ${b.stok_sisa} ${b.satuan || ''}` : '';
    const ok = await konfirmasi(
        'Apakah Anda yakin?',
        `Batch "${nama}" akan DIHAPUS PERMANEN beserta seluruh riwayat transaksinya.${detail}\n\nNilai aset & laporan bulanan akan ikut terkoreksi otomatis. Tindakan ini tidak dapat dibatalkan.`,
        'danger'
    );
    if (!ok) return;

    /* Hapus transaksi dulu, lalu batch-nya. Urutan ini disengaja: kalau
       langkah kedua gagal, yang tersisa adalah batch tanpa riwayat —
       terlihat di tabel stok dan bisa diperbaiki. Kebalikannya (batch
       hilang, transaksi tinggal) menyisakan baris yatim yang tidak muncul
       di mana pun tapi tetap ikut menghitung laporan.
       Galat langkah pertama WAJIB dicek sebelum lanjut; versi sebelumnya
       menjalankan keduanya lalu baru melapor, sehingga batch tetap terhapus
       walau riwayatnya gagal dibuang. */
    const { error: e1 } = await db.from('apotek_transaksi').delete().eq('batch_id', id);
    if (e1) { alert('Gagal menghapus riwayat transaksi batch ini, jadi batch-nya tidak ikut dihapus.\n\n' + e1.message); return; }

    const { error: e2 } = await db.from('apotek_batch').delete().eq('id', id);
    if (e2) { alert('Riwayat transaksi sudah terhapus, tetapi batch gagal dihapus. Silakan hapus ulang batch ini.\n\n' + e2.message); await muatSemuaData(); return; }

    await muatSemuaData();
}
window.hapusBatch = hapusBatch;

/* ============================================================
   EDIT BATCH (koreksi salah input) — dengan konfirmasi Ya/Tidak
   ============================================================ */
function editBatch(id) {
    const b = batchData.find(x => x.id === id);
    if (!b) { alert('Batch tidak ditemukan.'); return; }

    document.getElementById('ed_id').value = b.id;
    document.getElementById('ed_nama').value = b.nama_obat;
    document.getElementById('ed_satuan').value = b.satuan || '';
    document.getElementById('ed_stok_awal').value = b.stok_awal;
    document.getElementById('ed_harga').value = b.harga_satuan;
    document.getElementById('ed_expired').value = b.tgl_expired;
    document.getElementById('ed_tglmasuk').value = b.tgl_masuk;
    document.getElementById('ed_faktur').value = b.no_faktur || '';
    document.getElementById('ed_pbf').value = b.pbf || '';
    document.getElementById('ed_keterangan').value = b.keterangan || '';

    const terpakai = b.stok_awal - b.stok_sisa;
    document.getElementById('ed_stok_hint').innerText =
        `Sisa stok saat ini: ${b.stok_sisa}. Sudah terpakai/keluar: ${terpakai}. Jika jumlah awal diubah, sisa stok menyesuaikan otomatis (minimal ${terpakai}).`;
    document.getElementById('ed_stok_awal').min = Math.max(terpakai, 1);

    document.getElementById('modalEdit').classList.add('show');
}
window.editBatch = editBatch;

function setupFormEdit() {
    document.getElementById('formEdit').addEventListener('submit', async function (e) {
        e.preventDefault();
        const id = document.getElementById('ed_id').value;
        const b = batchData.find(x => x.id === id);
        if (!b) { alert('Batch tidak ditemukan.'); return; }

        const baru = {
            nama_obat: document.getElementById('ed_nama').value.trim(),
            satuan: document.getElementById('ed_satuan').value.trim(),
            stok_awal: parseInt(document.getElementById('ed_stok_awal').value),
            harga_satuan: parseFloat(document.getElementById('ed_harga').value),
            tgl_expired: document.getElementById('ed_expired').value,
            tgl_masuk: document.getElementById('ed_tglmasuk').value,
            no_faktur: document.getElementById('ed_faktur').value.trim() || null,
            pbf: document.getElementById('ed_pbf').value.trim(),
            keterangan: document.getElementById('ed_keterangan').value.trim() || null,
        };

        // Sisa stok menyesuaikan perubahan jumlah awal (tidak boleh negatif)
        const terpakai = b.stok_awal - b.stok_sisa;
        if (baru.stok_awal < terpakai) {
            alert(`Jumlah stok awal tidak boleh kurang dari yang sudah terpakai (${terpakai}).`);
            return;
        }
        const stokSisaBaru = baru.stok_awal - terpakai;

        // Ringkasan perubahan untuk konfirmasi
        const perubahan = [];
        if (baru.nama_obat !== b.nama_obat) perubahan.push(`Nama: "${b.nama_obat}" → "${baru.nama_obat}"`);
        if (baru.satuan !== (b.satuan || '')) perubahan.push(`Satuan: "${b.satuan || '-'}" → "${baru.satuan}"`);
        if (baru.stok_awal !== b.stok_awal) perubahan.push(`Jumlah awal: ${b.stok_awal} → ${baru.stok_awal} (sisa jadi ${stokSisaBaru})`);
        if (baru.harga_satuan !== parseFloat(b.harga_satuan)) perubahan.push(`Harga: ${formatRp(b.harga_satuan)} → ${formatRp(baru.harga_satuan)}`);
        if (baru.tgl_expired !== b.tgl_expired) perubahan.push(`Expired: ${formatTgl(b.tgl_expired)} → ${formatTgl(baru.tgl_expired)}`);
        if (baru.tgl_masuk !== b.tgl_masuk) perubahan.push(`Tgl masuk: ${formatTgl(b.tgl_masuk)} → ${formatTgl(baru.tgl_masuk)}`);
        if ((baru.no_faktur || '') !== (b.no_faktur || '')) perubahan.push(`Faktur: "${b.no_faktur || '-'}" → "${baru.no_faktur || '-'}"`);
        if ((baru.pbf || '') !== (b.pbf || '')) perubahan.push(`PBF: "${b.pbf || '-'}" → "${baru.pbf || '-'}"`);
        if ((baru.keterangan || '') !== (b.keterangan || '')) perubahan.push(`Keterangan diubah`);

        if (perubahan.length === 0) {
            document.getElementById('modalEdit').classList.remove('show');
            return;
        }

        const ok = await konfirmasi(
            'Apakah Anda yakin?',
            `Perubahan berikut akan disimpan:\n\n• ${perubahan.join('\n• ')}\n\nCatatan pembelian di laporan bulanan akan ikut terkoreksi.`,
            'primary'
        );
        if (!ok) return;

        const btn = this.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            // 1. Update batch
            const { error: e1 } = await db.from('apotek_batch').update({
                ...baru, stok_sisa: stokSisaBaru, updated_at: new Date().toISOString()
            }).eq('id', id);
            if (e1) throw e1;

            // 2. Koreksi transaksi MASUK terkait agar laporan bulanan konsisten
            const { error: e2 } = await db.from('apotek_transaksi').update({
                nama_obat: baru.nama_obat, satuan: baru.satuan,
                jumlah: baru.stok_awal, harga_satuan: baru.harga_satuan,
                total_nilai: baru.stok_awal * baru.harga_satuan,
                no_faktur: baru.no_faktur, pbf: baru.pbf,
                tanggal: baru.tgl_masuk, keterangan: baru.keterangan
            }).eq('batch_id', id).eq('jenis', 'MASUK');
            if (e2) throw e2;

            // 3. Sinkronkan nama/satuan/faktur/pbf di transaksi KELUAR batch ini
            //    (nilai & jumlah keluar TIDAK diubah karena sudah terjadi)
            const { error: e3 } = await db.from('apotek_transaksi').update({
                nama_obat: baru.nama_obat, satuan: baru.satuan,
                no_faktur: baru.no_faktur, pbf: baru.pbf
            }).eq('batch_id', id).eq('jenis', 'KELUAR');
            if (e3) throw e3;

            document.getElementById('modalEdit').classList.remove('show');
            await muatSemuaData();
            alert('Perubahan berhasil disimpan & laporan telah terkoreksi.');
        } catch (err) {
            alert('Gagal menyimpan perubahan: ' + err.message);
        } finally {
            btn.disabled = false;
        }
    });
}

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
        if (m.id === 'modalKonfirm') return; // dialog konfirmasi punya handler sendiri
        const closeBtn = m.querySelector('.close-modal');
        if (closeBtn) closeBtn.addEventListener('click', () => m.classList.remove('show'));
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
        if (!row.nama_obat || !row.jumlah || isNaN(row.harga) || !row.expired) {
            alert('Nama obat, jumlah, harga, dan tanggal expired wajib diisi.');
            return;
        }

        const ok = await konfirmasi(
            'Periksa dulu sebelum disimpan',
            'Data berikut akan dicatat sebagai obat masuk. Pastikan semuanya benar.',
            'primary',
            rincianObatMasuk(row),
            'Ya, Simpan'
        );
        if (!ok) return;

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
    setupFormEdit();
}

/* Ringkasan yang tampil di dialog konfirmasi Obat Masuk. Selain
   mengulang isi form, blok ini menyorot dua hal yang paling sering
   luput saat input cepat: tanggal expired yang sudah lewat, dan batch
   yang akan MENYATU dengan batch lama alih-alih jadi batch baru. */
function rincianObatMasuk(row) {
    const total = row.jumlah * row.harga;
    const gabung = batchData.find(b =>
        b.nama_obat.toLowerCase() === row.nama_obat.toLowerCase() &&
        parseFloat(b.harga_satuan) === row.harga &&
        b.tgl_expired === row.expired &&
        (b.no_faktur || '') === (row.faktur || '') &&
        (b.pbf || '').toLowerCase() === (row.pbf || '').toLowerCase()
    );

    const hariKeExp = Math.round((new Date(row.expired) - awalHariIni()) / 864e5);
    let expHtml = esc(formatTgl(row.expired));
    if (hariKeExp <= 0) {
        expHtml += ' <span class="tanda-bahaya">sudah lewat</span>';
    } else if (hariKeExp <= 90) {
        expHtml += ` <span class="tanda-awas">${hariKeExp} hari lagi</span>`;
    }

    const baris = [
        ['Nama obat', `<strong>${esc(row.nama_obat)}</strong>`],
        ['Jumlah', `<strong>${row.jumlah}</strong> ${esc(row.satuan || '')}`],
        ['Harga satuan', esc(formatRp(row.harga))],
        ['Total nilai', `<strong>${esc(formatRp(total))}</strong>`],
        ['Tgl expired', expHtml],
        ['Tgl masuk', esc(formatTgl(row.tgl_masuk))],
        ['No. faktur', esc(row.faktur || '-')],
        ['PBF', esc(row.pbf || '-')],
    ];
    if (row.keterangan) baris.push(['Keterangan', esc(row.keterangan)]);

    let html = tabelRincian(baris);
    if (gabung) {
        html += `<p class="catatan-konfirm"><i class="fa-solid fa-circle-info"></i> Sudah ada batch identik (sisa ${gabung.stok_sisa}). Stoknya akan <strong>ditambah menjadi ${gabung.stok_sisa + row.jumlah}</strong>, bukan dibuat batch baru.</p>`;
    }
    return html;
}

/* Penanda satu kali input. Mesin FEFO bisa memecah satu input jadi
   beberapa baris transaksi; tanpa penanda ini, membatalkan satu baris
   berarti pembatalan setengah jalan dan stok langsung melenceng. */
function grupBaru() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // Cadangan untuk peramban lama / konteks non-secure.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
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
        no_faktur: row.faktur, pbf: row.pbf, tanggal: row.tgl_masuk, keterangan: row.keterangan,
        grup_id: grupBaru()
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

    const kategori = document.getElementById('out_kategori').value;
    const pemusnahan = KATEGORI_PEMUSNAHAN.includes(kategori);
    const today = awalHariIni();
    const batches = sortFefo(batchData.filter(b => b.nama_obat === nama && b.stok_sisa > 0));

    // Batch kadaluwarsa tetap ditampilkan, tapi dimatikan untuk kategori
    // non-pemusnahan — supaya jelas ada, dan jelas kenapa tidak bisa dipilih.
    selBatch.innerHTML = batches.map(b => {
        const exp = sudahExpired(b, today);
        const mati = exp && !pemusnahan;
        const tanda = exp ? ' ⚠ KADALUWARSA' : '';
        return `<option value="${b.id}"${mati ? ' disabled' : ''}>` +
               `Exp ${formatTgl(b.tgl_expired)}${tanda} | ${esc(b.pbf) || '-'} | ` +
               `Faktur ${esc(b.no_faktur) || '-'} | sisa ${b.stok_sisa} | ${formatRp(b.harga_satuan)}/sat</option>`;
    }).join('');

    // Jangan biarkan pilihan berhenti di option yang disabled.
    const pilihan = [...selBatch.options].find(o => !o.disabled);
    if (pilihan) selBatch.value = pilihan.value;
}

function updateInfoKeluar() {
    const nama = document.getElementById('out_nama').value;
    const info = document.getElementById('out_stok_info');
    const preview = document.getElementById('previewKeluar');
    if (!nama) { info.innerText = ''; preview.style.display = 'none'; return; }

    const metode = document.getElementById('out_metode').value;
    const jumlah = parseInt(document.getElementById('out_jumlah').value) || 0;

    const kategori = document.getElementById('out_kategori').value;
    const semuaBatch = sortFefo(batchData.filter(b => b.nama_obat === nama && b.stok_sisa > 0));

    let batches;
    if (metode === 'manual') {
        const bid = document.getElementById('out_batch').value;
        batches = batchBolehKeluar(batchData.filter(b => b.id === bid), kategori);
    } else {
        batches = batchBolehKeluar(semuaBatch, kategori);
    }

    const tersedia = batches.reduce((s, b) => s + b.stok_sisa, 0);
    const stokTerkunci = semuaBatch.reduce((s, b) => s + b.stok_sisa, 0) - 
                         batchBolehKeluar(semuaBatch, kategori).reduce((s, b) => s + b.stok_sisa, 0);

    info.innerText = metode === 'manual'
        ? `Sisa stok batch terpilih: ${tersedia}`
        : `Total tersedia: ${tersedia}. Batch pertama FEFO: ${batches[0] ? 'exp ' + formatTgl(batches[0].tgl_expired) + ', masuk ' + formatTgl(batches[0].tgl_masuk) : '-'}`;
    if (stokTerkunci > 0) {
        info.innerText += ` — ${stokTerkunci} lagi ada di batch kadaluwarsa dan tidak ikut dihitung.`;
    }

    if (jumlah > 0) {
        const sim = simulasiFefo(batches, jumlah);
        preview.style.display = 'block';
        preview.innerHTML = sim.kurang > 0
            ? `<span style="color:var(--danger)">Stok tidak cukup! Kurang ${sim.kurang}.</span>`
            : `Nilai keluar (harga beli FEFO): <strong>${formatRp(sim.totalNilai)}</strong><br><small style="font-weight:400;color:var(--text-muted)">${sim.potongan.map(p => `${p.ambil} dari batch exp ${formatTgl(p.batch.tgl_expired)}`).join(' + ')}</small>`;
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
        if (KATEGORI_PEMUSNAHAN.includes(this.value)) {
            document.getElementById('out_metode').value = 'manual';
            document.getElementById('out_batch_wrap').style.display = 'block';
        }
        // Wajib digambar ulang: batch mana yang boleh dipilih bergantung kategori.
        updateBatchDropdown();
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
        if (!jumlah || jumlah < 1) { alert('Jumlah keluar harus diisi.'); return; }

        const rincian = rincianObatKeluar(nama, jumlah, kategori, tanggal, keterangan, batchIdManual);
        if (rincian.galat) { alert(rincian.galat); return; }

        const ok = await konfirmasi(
            'Periksa dulu sebelum disimpan',
            'Stok berikut akan dipotong. Periksa batch mana saja yang terkena.',
            'primary',
            rincian.html,
            'Ya, Simpan'
        );
        if (!ok) return;

        const btn = this.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
            const hasil = await prosesObatKeluar(nama, jumlah, kategori, tanggal, keterangan, batchIdManual);
            alert(`Obat keluar berhasil dicatat.\nKategori: ${kategori}\nJumlah: ${jumlah}\nNilai (harga beli FEFO): ${formatRp(hasil.totalNilai)}\nDiambil dari ${hasil.batchCount} batch.`);
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

/* Ringkasan konfirmasi Obat Keluar. Bagian paling berguna di sini bukan
   pengulangan isi form, melainkan RINCIAN BATCH: pemakai bisa melihat
   persis batch mana yang akan terpotong dan berapa, sebelum menekan
   Simpan. Perhitungannya memakai simulasiFefo() yang sama dengan
   pratinjau di form, jadi tidak mungkin berbeda. */
function rincianObatKeluar(nama, jumlah, kategori, tanggal, keterangan, batchIdManual) {
    let batches;
    if (batchIdManual) {
        const b = batchData.find(x => x.id === batchIdManual && x.stok_sisa > 0);
        if (!b) return { galat: 'Batch terpilih tidak ditemukan atau stoknya sudah habis.' };
        batches = batchBolehKeluar([b], kategori);
        if (batches.length === 0) {
            return { galat: `Batch ini sudah kadaluwarsa (exp ${formatTgl(b.tgl_expired)}), jadi tidak boleh keluar sebagai "${kategori}".\n\nKalau memang mau dibuang, ubah Kategori menjadi "Obat Expired".` };
        }
    } else {
        batches = batchBolehKeluar(sortFefo(batchData.filter(b => b.nama_obat === nama && b.stok_sisa > 0)), kategori);
    }

    const sim = simulasiFefo(batches, jumlah);
    if (sim.kurang > 0) {
        return { galat: `Stok tidak cukup. Diminta ${jumlah}, tersedia ${jumlah - sim.kurang}.` };
    }

    const satuan = sim.potongan.length ? (sim.potongan[0].batch.satuan || '') : '';
    const baris = [
        ['Kategori', `<strong>${esc(kategori)}</strong>`],
        ['Nama obat', `<strong>${esc(nama)}</strong>`],
        ['Jumlah keluar', `<strong>${jumlah}</strong> ${esc(satuan)}`],
        ['Tanggal', esc(formatTgl(tanggal))],
    ];
    if (keterangan) baris.push(['Keterangan', esc(keterangan)]);
    baris.push(['Nilai keluar', `<strong>${esc(formatRp(sim.totalNilai))}</strong>`]);

    let html = tabelRincian(baris);

    html += '<p class="judul-rincian">Batch yang akan terpotong</p>';
    html += '<table class="rincian-tabel rincian-batch"><thead><tr>' +
            '<th>Batch (exp / faktur)</th><th class="text-right">Ambil</th>' +
            '<th class="text-right">Sisa jadi</th><th class="text-right">Nilai</th>' +
            '</tr></thead><tbody>';
    sim.potongan.forEach(p => {
        html += `<tr>
            <td>${esc(formatTgl(p.batch.tgl_expired))}<br><small>${esc(p.batch.no_faktur) || '-'} · ${esc(p.batch.pbf) || '-'}</small></td>
            <td class="text-right"><strong>${p.ambil}</strong></td>
            <td class="text-right">${p.batch.stok_sisa} &rarr; ${p.batch.stok_sisa - p.ambil}</td>
            <td class="text-right">${esc(formatRp(p.nilai))}</td>
        </tr>`;
    });
    html += '</tbody></table>';

    if (sim.potongan.length > 1) {
        html += `<p class="catatan-konfirm"><i class="fa-solid fa-circle-info"></i> Jumlah ini melewati <strong>${sim.potongan.length} batch</strong> karena batch terdepan tidak mencukupi. Semuanya tercatat sebagai satu transaksi dan bisa dibatalkan sekaligus.</p>`;
    }
    return { html };
}

/* MESIN FEFO: mengurangi stok mulai dari batch yang paling dekat expired,
   bisa melintasi beberapa batch sekaligus. Nilai keluar = harga beli batch
   masing-masing.

   Batch kadaluwarsa DIBLOKIR untuk kategori selain pemusnahan. Sebelum ini
   penyaringnya cuma `stok_sisa > 0`, jadi obat yang sudah lewat tanggal bisa
   keluar sebagai "Resep Dokter" tanpa satu pun peringatan, lalu tercatat
   rapi seolah-olah normal. */
async function prosesObatKeluar(nama, jumlah, kategori, tanggal, keterangan, batchIdManual) {
    const today = awalHariIni();
    const pemusnahan = KATEGORI_PEMUSNAHAN.includes(kategori);

    let batches, stokSemua;
    if (batchIdManual) {
        const b = batchData.find(x => x.id === batchIdManual && x.stok_sisa > 0);
        if (!b) throw new Error('Batch terpilih tidak ditemukan / stok habis.');
        if (!pemusnahan && sudahExpired(b, today)) {
            throw new Error(
                `Batch ini sudah kadaluwarsa (exp ${formatTgl(b.tgl_expired)}), ` +
                `jadi tidak boleh keluar sebagai "${kategori}".\n\n` +
                `Kalau memang mau dibuang, ubah Kategori menjadi "Obat Expired".`
            );
        }
        batches = [b];
        stokSemua = b.stok_sisa;
    } else {
        const semua = sortFefo(batchData.filter(b => b.nama_obat === nama && b.stok_sisa > 0));
        stokSemua = semua.reduce((s, b) => s + b.stok_sisa, 0);
        batches = batchBolehKeluar(semua, kategori);
    }

    const tersedia = batches.reduce((s, b) => s + b.stok_sisa, 0);
    if (jumlah > tersedia) {
        const terkunci = stokSemua - tersedia;
        let pesan = `Stok tidak cukup. Diminta ${jumlah}, tersedia ${tersedia}.`;
        if (terkunci > 0) {
            pesan += `\n\n${terkunci} lagi ada di batch yang sudah kadaluwarsa dan sengaja ` +
                     `tidak ikut dihitung. Keluarkan batch itu lewat kategori "Obat Expired".`;
        }
        throw new Error(pesan);
    }

    let sisa = jumlah;
    let totalNilai = 0;
    const trxRows = [];
    const grupId = grupBaru();   // satu input = satu grup, walau terpecah lintas batch

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
            no_faktur: b.no_faktur, pbf: b.pbf, tanggal: tanggal, keterangan: keterangan,
            grup_id: grupId
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

// Navigasi cepat bulan laporan (tombol ‹ dan ›)
function geserBulanLaporan(delta) {
    const el = document.getElementById('laporanBulan');
    const [y, m] = (el.value || monthStr()).split('-').map(Number);
    el.value = monthStr(new Date(y, m - 1 + delta, 1));
    renderLaporanBulanan();
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

    const katTotal = {};
    KATEGORI_KELUAR.forEach(kat => katTotal[kat] = { qty: 0, rp: 0 });
    keluar.forEach(t => {
        const kat = KATEGORI_KELUAR.includes(t.kategori) ? t.kategori : 'Lainnya';
        katTotal[kat].qty += t.jumlah || 0;
        katTotal[kat].rp += parseFloat(t.total_nilai || 0);
    });

    const ul = document.getElementById('lapKategoriList');
    let html = '';
    KATEGORI_KELUAR.forEach(kat => {
        html += `<li>
            <span class="k-left"><span class="k-dot" style="background:${KATEGORI_WARNA[kat]}"></span>${kat} <span class="k-qty">(${katTotal[kat].qty} item)</span></span>
            <span class="k-rp">${formatRp(katTotal[kat].rp)}</span>
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

    // --- Label bulan terpilih pada judul-judul panel ---
    document.querySelectorAll('.lap-bulan-label').forEach(el => el.innerText = labelBulan(ym));

    // --- Rincian obat keluar per obat (lengkap per kategori) ---
    const keluarMap = {};
    keluar.forEach(t => {
        const k = t.nama_obat;
        if (!keluarMap[k]) keluarMap[k] = { qty: 0, rp: 0, satuan: t.satuan, kat: {} };
        keluarMap[k].qty += t.jumlah || 0;
        keluarMap[k].rp += parseFloat(t.total_nilai || 0);
        const kat = KATEGORI_KELUAR.includes(t.kategori) ? t.kategori : 'Lainnya';
        keluarMap[k].kat[kat] = (keluarMap[k].kat[kat] || 0) + parseFloat(t.total_nilai || 0);
    });
    const keluarBody = document.getElementById('lapKeluarBody');
    const keluarKeys = Object.keys(keluarMap).sort((a, b) => keluarMap[b].rp - keluarMap[a].rp);
    if (keluarKeys.length === 0) {
        keluarBody.innerHTML = '<tr><td colspan="7" class="text-center">Tidak ada obat keluar pada bulan ini</td></tr>';
    } else {
        keluarBody.innerHTML = keluarKeys.map(k => {
            const d = keluarMap[k];
            return `<tr>
                <td><strong>${esc(k)}</strong></td>
                <td class="text-right">${d.qty} <small>${esc(d.satuan || '')}</small></td>
                <td class="text-right">${formatRp(d.kat['Resep Dokter'] || 0)}</td>
                <td class="text-right">${formatRp(d.kat['Obat Expired'] || 0)}</td>
                <td class="text-right">${formatRp(d.kat['Obat Rusak'] || 0)}</td>
                <td class="text-right">${formatRp(d.kat['Lainnya'] || 0)}</td>
                <td class="text-right" style="font-weight:700;color:var(--danger)">${formatRp(d.rp)}</td>
            </tr>`;
        }).join('') + `
            <tr style="background:var(--bg);font-weight:800">
                <td>TOTAL</td>
                <td class="text-right">${keluarQty}</td>
                <td class="text-right">${formatRp(katTotal['Resep Dokter'].rp)}</td>
                <td class="text-right">${formatRp(katTotal['Obat Expired'].rp)}</td>
                <td class="text-right">${formatRp(katTotal['Obat Rusak'].rp)}</td>
                <td class="text-right">${formatRp(katTotal['Lainnya'].rp)}</td>
                <td class="text-right" style="color:var(--danger)">${formatRp(keluarRp)}</td>
            </tr>`;
    }

    // --- Detail semua transaksi bulan terpilih (data lengkap) ---
    const jenisFilter = document.getElementById('lapDetailJenis').value;
    let detail = jenisFilter ? trx.filter(t => t.jenis === jenisFilter) : trx;
    document.getElementById('lapDetailCount').innerText = `${detail.length} transaksi`;
    detail = detail.slice(0, 500); // pengaman tampilan
    const detailBody = document.getElementById('lapDetailBody');
    detailBody.innerHTML = detail.length === 0
        ? '<tr><td colspan="9" class="text-center">Tidak ada transaksi pada bulan ini</td></tr>'
        : detail.map(t => `
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
/* Usia transaksi dalam hari, dihitung dari created_at — waktu barisnya
   BENAR-BENAR ditulis, bukan kolom `tanggal` yang diisi manual. Kalau
   memakai `tanggal`, transaksi yang keliru diberi tanggal dua bulan lalu
   lalu disadari lima menit kemudian justru tidak bisa dibatalkan, padahal
   itu persis skenario yang fitur ini layani. */
function umurHariTransaksi(t) {
    if (!t || !t.created_at) return Infinity;
    return (Date.now() - new Date(t.created_at).getTime()) / 864e5;
}

// Kelompokkan seluruh transaksi per grup_id sekali saja, lalu dipakai
// ulang tiap baris — supaya tidak memindai transaksiData berkali-kali.
function petaGrup() {
    const peta = new Map();
    transaksiData.forEach(t => {
        if (!t.grup_id) return;
        if (!peta.has(t.grup_id)) peta.set(t.grup_id, []);
        peta.get(t.grup_id).push(t);
    });
    return peta;
}

function renderRiwayat() {
    const tbody = document.getElementById('tabelRiwayatBody');
    const jenis = document.getElementById('riwayatFilterJenis').value;
    const bulan = document.getElementById('riwayatFilterBulan').value;

    let list = transaksiData;
    if (jenis) list = list.filter(t => t.jenis === jenis);
    if (bulan) list = list.filter(t => (t.tanggal || '').startsWith(bulan));
    list = list.slice(0, 300); // batasi tampilan

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center">Tidak ada transaksi.</td></tr>';
        return;
    }

    /* Ukuran grup dihitung dari SELURUH transaksiData, bukan dari list
       yang sudah dipotong .slice(0, 300). Kalau dihitung dari list,
       grup yang kebetulan terpotong di batas 300 akan terlihat lebih
       kecil dari yang sebenarnya dan pemakai dibohongi soal berapa
       baris yang akan ikut terhapus. */
    const grup = petaGrup();

    tbody.innerHTML = list.map(t => {
        const anggota = t.grup_id ? (grup.get(t.grup_id) || [t]) : [t];
        const umur = umurHariTransaksi(t);
        const bisaBatal = t.grup_id && umur <= BATAS_BATAL_HARI;

        let aksi;
        if (!t.grup_id) {
            aksi = '<span class="aksi-mati" title="Kolom grup_id belum ada. Jalankan migrasi sql/012_pembatalan_transaksi_apotek.sql lebih dulu."><i class="fa-solid fa-circle-exclamation"></i></span>';
        } else if (bisaBatal) {
            const judul = anggota.length > 1
                ? `Batalkan transaksi ini (${anggota.length} baris sekaligus)`
                : 'Batalkan transaksi ini';
            aksi = `<button type="button" class="btn-batal-row" onclick="batalkanTransaksi('${t.grup_id}')" title="${judul}"><i class="fa-solid fa-rotate-left"></i></button>`;
        } else {
            aksi = `<span class="aksi-mati" title="Sudah ${Math.floor(umur)} hari, melewati batas ${BATAS_BATAL_HARI} hari. Gunakan Edit Batch untuk koreksi."><i class="fa-solid fa-lock"></i></span>`;
        }

        const tandaGrup = anggota.length > 1
            ? ` <span class="grup-tag" title="Satu input terpecah ke ${anggota.length} batch oleh FEFO">${anggota.indexOf(t) + 1}/${anggota.length}</span>`
            : '';

        return `
        <tr>
            <td style="font-family:monospace">${formatTgl(t.tanggal)}</td>
            <td><span class="badge ${t.jenis === 'MASUK' ? 'badge-masuk' : 'badge-keluar'}">${t.jenis}</span>${tandaGrup}</td>
            <td>${esc(t.kategori)}</td>
            <td><strong>${esc(t.nama_obat)}</strong></td>
            <td class="text-right">${t.jumlah} <small>${esc(t.satuan || '')}</small></td>
            <td class="text-right">${formatRp(t.harga_satuan)}</td>
            <td class="text-right" style="font-weight:600;color:${t.jenis === 'MASUK' ? 'var(--success)' : 'var(--danger)'}">${formatRp(t.total_nilai)}</td>
            <td><small>${esc(t.no_faktur) || '-'}<br>${esc(t.pbf) || '-'}</small></td>
            <td><small>${esc(t.keterangan) || '-'}</small></td>
            <td class="text-center">${aksi}</td>
        </tr>`;
    }).join('');
}

/* ============================================================
   PEMBATALAN TRANSAKSI (koreksi salah input)

   Hanya uuid grup yang dikirim ke handler; nama obat sengaja TIDAK
   ikut sebagai argumen onclick. Nama pasien/obat bisa mengandung
   apostrof yang memutus atribut onclick="..." — jebakan yang sudah
   pernah menggigit di modul lain. Datanya diambil ulang dari
   transaksiData di dalam fungsi.
   ============================================================ */
async function batalkanTransaksi(grupId) {
    const baris = transaksiData.filter(t => t.grup_id === grupId);
    if (baris.length === 0) {
        alert('Transaksi tidak ditemukan. Halaman mungkin sudah usang — muat ulang dulu.');
        await muatSemuaData();
        return;
    }

    const contoh = baris[0];
    const totalQty = baris.reduce((s, t) => s + (t.jumlah || 0), 0);
    const totalNilai = baris.reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0);
    const arah = contoh.jenis === 'MASUK'
        ? 'Stok akan DIKURANGI kembali sebanyak ' + totalQty + '.'
        : 'Stok akan DIKEMBALIKAN sebanyak ' + totalQty + '.';

    const info = [
        ['Jenis', `<strong>${esc(contoh.jenis)}</strong> · ${esc(contoh.kategori)}`],
        ['Nama obat', `<strong>${esc(contoh.nama_obat)}</strong>`],
        ['Tanggal', esc(formatTgl(contoh.tanggal))],
        ['Total jumlah', `<strong>${totalQty}</strong> ${esc(contoh.satuan || '')}`],
        ['Total nilai', esc(formatRp(totalNilai))],
        ['Baris terhapus', `${baris.length} baris`],
    ];
    if (contoh.keterangan) info.push(['Keterangan', esc(contoh.keterangan)]);

    let html = tabelRincian(info);
    if (baris.length > 1) {
        html += '<p class="judul-rincian">Semua baris dalam transaksi ini</p>';
        html += '<table class="rincian-tabel rincian-batch"><thead><tr><th>Batch (exp / faktur)</th><th class="text-right">Jumlah</th><th class="text-right">Nilai</th></tr></thead><tbody>';
        baris.forEach(t => {
            const b = batchData.find(x => x.id === t.batch_id);
            const label = b ? `${formatTgl(b.tgl_expired)}<br><small>${esc(b.no_faktur) || '-'} · ${esc(b.pbf) || '-'}</small>` : '<small>batch sudah dihapus</small>';
            html += `<tr><td>${label}</td><td class="text-right">${t.jumlah}</td><td class="text-right">${esc(formatRp(t.total_nilai))}</td></tr>`;
        });
        html += '</tbody></table>';
    }
    html += `<p class="catatan-konfirm"><i class="fa-solid fa-triangle-exclamation"></i> ${arah} Baris riwayat dihapus <strong>permanen</strong> dan tidak bisa dipulihkan. Laporan bulanan ikut terkoreksi.</p>`;

    const ok = await konfirmasi(
        'Batalkan transaksi ini?',
        'Periksa rincian di bawah. Pastikan ini benar-benar transaksi yang salah input.',
        'danger',
        html,
        'Ya, Batalkan'
    );
    if (!ok) return;

    try {
        const { data, error } = await db.rpc('batalkan_transaksi_apotek', {
            p_grup_id: grupId,
            p_batas_hari: BATAS_BATAL_HARI
        });
        if (error) throw error;

        const hasil = data || {};
        let pesan = `Transaksi dibatalkan. ${hasil.baris_dihapus || baris.length} baris riwayat dihapus dan stok sudah dipulihkan.`;
        if (hasil.batch_dihapus > 0) {
            pesan += `\n\n${hasil.batch_dihapus} batch ikut terhapus karena seluruh isinya berasal dari transaksi ini.`;
        }
        alert(pesan);
        await muatSemuaData();
    } catch (err) {
        const m = String(err.message || err);
        /* PGRST202 = fungsi tidak ada di skema. Penyebab paling mungkin
           adalah migrasi SQL belum dijalankan, dan pesan mentahnya sama
           sekali tidak menjelaskan itu. */
        if (m.includes('PGRST202') || m.includes('batalkan_transaksi_apotek') && m.includes('does not exist')) {
            alert('Fungsi pembatalan belum ada di database.\n\nJalankan sql/012_pembatalan_transaksi_apotek.sql di SQL Editor Supabase lebih dulu, lalu muat ulang halaman ini.');
        } else {
            alert('Pembatalan dibatalkan oleh database — tidak ada data yang berubah:\n\n' + m);
        }
    }
}
window.batalkanTransaksi = batalkanTransaksi;

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
            ['7. Setiap baris akan menjadi 1 batch stok, dibedakan per Tgl Expired / Faktur / PBF (sistem FEFO).'],
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

    const dilewati = importRows.length - validRows.length;
    const totalNilai = validRows.reduce((s, r) => s + r.jumlah * r.harga, 0);
    const totalQty = validRows.reduce((s, r) => s + r.jumlah, 0);
    const sudahLewat = validRows.filter(r => new Date(r.expired) <= awalHariIni());

    const ringkas = [
        ['Baris di-import', `<strong>${validRows.length}</strong> baris`],
        ['Total item', `${totalQty}`],
        ['Total nilai', `<strong>${esc(formatRp(totalNilai))}</strong>`],
    ];
    if (dilewati > 0) ringkas.push(['Dilewati', `<span class="tanda-awas">${dilewati} baris bermasalah</span>`]);

    let rincianHtml = tabelRincian(ringkas);
    if (sudahLewat.length > 0) {
        rincianHtml += `<p class="catatan-konfirm"><i class="fa-solid fa-triangle-exclamation"></i> <strong>${sudahLewat.length} baris</strong> punya tanggal expired yang sudah lewat: ${esc(sudahLewat.slice(0, 3).map(r => r.nama).join(', '))}${sudahLewat.length > 3 ? ', dan lainnya' : ''}.</p>`;
    }
    rincianHtml += '<p class="judul-rincian">5 baris pertama</p>';
    rincianHtml += '<table class="rincian-tabel rincian-batch"><thead><tr><th>Nama Obat</th><th class="text-right">Jumlah</th><th class="text-right">Harga</th><th>Expired</th></tr></thead><tbody>' +
        validRows.slice(0, 5).map(r => `<tr><td>${esc(r.nama)}</td><td class="text-right">${r.jumlah}</td><td class="text-right">${esc(formatRp(r.harga))}</td><td>${esc(formatTgl(r.expired))}</td></tr>`).join('') +
        '</tbody></table>';

    const ok = await konfirmasi(
        'Periksa dulu sebelum di-import',
        'Setiap baris akan menjadi batch stok baru dan tercatat sebagai transaksi masuk.',
        'primary',
        rincianHtml,
        'Ya, Import'
    );
    if (!ok) return;

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
        /* Tiap baris Excel = satu jenis obat = satu grup sendiri, jadi
           kesalahan pada satu baris bisa dibatalkan tanpa menyeret
           seluruh isi berkas import. */
        const trxRows = inserted.map(b => ({
            batch_id: b.id, nama_obat: b.nama_obat, satuan: b.satuan,
            jenis: 'MASUK', kategori: 'Import Stok Awal',
            jumlah: b.stok_awal, harga_satuan: b.harga_satuan,
            total_nilai: b.stok_awal * parseFloat(b.harga_satuan || 0),
            no_faktur: b.no_faktur, pbf: b.pbf, tanggal: b.tgl_masuk, keterangan: b.keterangan,
            grup_id: grupBaru()
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

/* ============================================================
   EXPORT KE EXCEL — DATA MENTAH + DATA OLAHAN SIAP PRESENTASI
   • Export rentang tanggal (tombol "Export Excel") : 5 sheet
     1. Ringkasan (eksekutif)   3. Rekap Bulanan       5. Riwayat Transaksi (mentah)
     2. Rekap per Obat          4. Stok Saat Ini (mentah)
   • Export laporan bulanan (tombol di tab Laporan) : 3 sheet
     1. Ringkasan   2. Rekap per Obat   3. Detail Transaksi (mentah)
   ============================================================ */

// Hitung agregat sekumpulan transaksi (dipakai sheet Ringkasan, Rekap per Obat, Rekap Bulanan)
function ringkasanTransaksi(trx) {
    const masuk = trx.filter(t => t.jenis === 'MASUK');
    const keluar = trx.filter(t => t.jenis === 'KELUAR');

    const perKat = {};
    KATEGORI_KELUAR.forEach(k => perKat[k] = { qty: 0, rp: 0 });
    keluar.forEach(t => {
        const k = KATEGORI_KELUAR.includes(t.kategori) ? t.kategori : 'Lainnya';
        perKat[k].qty += t.jumlah || 0;
        perKat[k].rp += parseFloat(t.total_nilai || 0);
    });

    const perObat = {};
    trx.forEach(t => {
        const n = t.nama_obat;
        if (!perObat[n]) perObat[n] = { satuan: t.satuan, beliQty: 0, beliRp: 0, keluarQty: 0, keluarRp: 0, kat: {} };
        if (t.jenis === 'MASUK') {
            perObat[n].beliQty += t.jumlah || 0;
            perObat[n].beliRp += parseFloat(t.total_nilai || 0);
        } else {
            perObat[n].keluarQty += t.jumlah || 0;
            perObat[n].keluarRp += parseFloat(t.total_nilai || 0);
            const k = KATEGORI_KELUAR.includes(t.kategori) ? t.kategori : 'Lainnya';
            perObat[n].kat[k] = (perObat[n].kat[k] || 0) + parseFloat(t.total_nilai || 0);
        }
    });

    return {
        masuk, keluar, perKat, perObat,
        beliRp: masuk.reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0),
        beliQty: masuk.reduce((s, t) => s + (t.jumlah || 0), 0),
        keluarRp: keluar.reduce((s, t) => s + parseFloat(t.total_nilai || 0), 0),
        keluarQty: keluar.reduce((s, t) => s + (t.jumlah || 0), 0)
    };
}

// Terapkan format ribuan (#,##0) ke semua sel angka agar rapi saat dibuka di Excel
function formatAngkaSheet(ws) {
    if (!ws['!ref']) return ws;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
            const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
            if (cell && cell.t === 'n') cell.z = '#,##0';
        }
    }
    return ws;
}

function pctStr(bagian, total) {
    if (!total) return '0%';
    return (bagian / total * 100).toFixed(1).replace('.', ',') + '%';
}

// SHEET 1: Ringkasan eksekutif — data olahan siap presentasi
function buatSheetRingkasan(judulPeriode, trx) {
    const r = ringkasanTransaksi(trx);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const h30 = new Date(today); h30.setDate(h30.getDate() + 30);
    const aktif = batchData.filter(b => b.stok_sisa > 0);
    const nilaiAset = aktif.reduce((s, b) => s + b.stok_sisa * parseFloat(b.harga_satuan || 0), 0);
    const jenisObat = new Set(aktif.map(b => b.nama_obat)).size;
    const menipis = aktif.filter(b => b.stok_sisa < 10);
    const expired = aktif.filter(b => new Date(b.tgl_expired) <= today);
    const segera = aktif.filter(b => { const e = new Date(b.tgl_expired); return e > today && e <= h30; });
    const nilaiBatch = list => list.reduce((s, b) => s + b.stok_sisa * parseFloat(b.harga_satuan || 0), 0);

    const rows = [];
    rows.push(['LAPORAN STOK OBAT — FARMASI KLINIK IMANUEL']);
    rows.push([`Periode: ${judulPeriode}`]);
    rows.push([`Dicetak: ${new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`]);
    rows.push([]);

    rows.push(['A. RINGKASAN TRANSAKSI PERIODE']);
    rows.push(['Uraian', 'Qty', 'Jml Transaksi', 'Nilai (Rp)']);
    rows.push(['Total Pembelian Obat (Masuk)', r.beliQty, r.masuk.length, r.beliRp]);
    rows.push(['Total Obat Keluar', r.keluarQty, r.keluar.length, r.keluarRp]);
    rows.push(['Selisih (Masuk − Keluar)', '', '', r.beliRp - r.keluarRp]);
    rows.push([]);

    rows.push(['B. OBAT KELUAR PER KATEGORI']);
    rows.push(['Kategori', 'Qty', 'Nilai (Rp)', '% dari Total Keluar']);
    KATEGORI_KELUAR.forEach(k => {
        const d = r.perKat[k];
        rows.push([k, d.qty, d.rp, pctStr(d.rp, r.keluarRp)]);
    });
    rows.push(['TOTAL KELUAR', r.keluarQty, r.keluarRp, r.keluarRp ? '100%' : '0%']);
    rows.push([]);

    const topBy = field => Object.keys(r.perObat)
        .filter(n => r.perObat[n][field] > 0)
        .sort((a, b) => r.perObat[b][field] - r.perObat[a][field])
        .slice(0, 10);

    rows.push(['C. TOP 10 PEMBELIAN OBAT (BERDASARKAN NILAI)']);
    rows.push(['Nama Obat', 'Satuan', 'Qty', 'Nilai (Rp)', '% dari Pembelian']);
    const topBeli = topBy('beliRp');
    if (topBeli.length === 0) rows.push(['Tidak ada pembelian pada periode ini']);
    topBeli.forEach(n => { const d = r.perObat[n]; rows.push([n, d.satuan || '-', d.beliQty, d.beliRp, pctStr(d.beliRp, r.beliRp)]); });
    rows.push([]);

    rows.push(['D. TOP 10 OBAT KELUAR (BERDASARKAN NILAI)']);
    rows.push(['Nama Obat', 'Satuan', 'Qty', 'Nilai (Rp)', '% dari Keluar']);
    const topKeluar = topBy('keluarRp');
    if (topKeluar.length === 0) rows.push(['Tidak ada obat keluar pada periode ini']);
    topKeluar.forEach(n => { const d = r.perObat[n]; rows.push([n, d.satuan || '-', d.keluarQty, d.keluarRp, pctStr(d.keluarRp, r.keluarRp)]); });
    rows.push([]);

    rows.push(['E. POSISI STOK SAAT INI & PERHATIAN']);
    rows.push(['Uraian', 'Jumlah', '', 'Nilai (Rp)']);
    rows.push(['Nilai Aset Obat Saat Ini', '', '', nilaiAset]);
    rows.push(['Jenis Obat Aktif', jenisObat, '', '']);
    rows.push(['Batch Aktif', aktif.length, '', '']);
    rows.push(['Batch Stok Menipis (< 10)', menipis.length, '', nilaiBatch(menipis)]);
    rows.push(['Batch Kadaluarsa (masih ada stok)', expired.length, '', nilaiBatch(expired)]);
    rows.push(['Batch Segera Expired (≤ 30 hari)', segera.length, '', nilaiBatch(segera)]);

    const perhatian = [...expired.map(b => [b, 'KADALUARSA']), ...segera.map(b => [b, 'Segera Exp'])];
    if (perhatian.length > 0) {
        rows.push([]);
        rows.push(['DAFTAR BATCH PERLU PERHATIAN (maks. 20 teratas)']);
        rows.push(['Nama Obat', 'Status', 'Tgl Expired', 'Sisa Stok', 'Nilai (Rp)']);
        perhatian.slice(0, 20).forEach(([b, st]) =>
            rows.push([b.nama_obat, st, b.tgl_expired, b.stok_sisa, b.stok_sisa * parseFloat(b.harga_satuan || 0)]));
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 38 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 }];
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } }
    ];
    return formatAngkaSheet(ws);
}

// SHEET 2: Rekap per Obat — data olahan (pembelian, keluar per kategori, posisi stok)
function buatSheetRekapObat(trx) {
    const r = ringkasanTransaksi(trx);

    const stokMap = {};
    batchData.forEach(b => {
        if (!stokMap[b.nama_obat]) stokMap[b.nama_obat] = { sisa: 0, nilai: 0 };
        stokMap[b.nama_obat].sisa += b.stok_sisa;
        stokMap[b.nama_obat].nilai += b.stok_sisa * parseFloat(b.harga_satuan || 0);
    });

    const names = Object.keys(r.perObat).sort((a, b) =>
        (r.perObat[b].beliRp + r.perObat[b].keluarRp) - (r.perObat[a].beliRp + r.perObat[a].keluarRp));

    const rows = names.map((n, i) => {
        const d = r.perObat[n];
        return {
            'No': i + 1, 'Nama Obat': n, 'Satuan': d.satuan || '-',
            'Pembelian (Qty)': d.beliQty, 'Pembelian (Rp)': d.beliRp,
            'Keluar Resep Dokter (Rp)': d.kat['Resep Dokter'] || 0,
            'Keluar Obat Expired (Rp)': d.kat['Obat Expired'] || 0,
            'Keluar Obat Rusak (Rp)': d.kat['Obat Rusak'] || 0,
            'Keluar Lainnya (Rp)': d.kat['Lainnya'] || 0,
            'Keluar (Qty)': d.keluarQty, 'Total Keluar (Rp)': d.keluarRp,
            'Sisa Stok Saat Ini': stokMap[n] ? stokMap[n].sisa : 0,
            'Nilai Stok Saat Ini (Rp)': stokMap[n] ? stokMap[n].nilai : 0
        };
    });

    if (rows.length > 0) {
        const tot = f => rows.reduce((s, x) => s + (x[f] || 0), 0);
        rows.push({}, {
            'Nama Obat': 'TOTAL',
            'Pembelian (Qty)': tot('Pembelian (Qty)'), 'Pembelian (Rp)': tot('Pembelian (Rp)'),
            'Keluar Resep Dokter (Rp)': tot('Keluar Resep Dokter (Rp)'),
            'Keluar Obat Expired (Rp)': tot('Keluar Obat Expired (Rp)'),
            'Keluar Obat Rusak (Rp)': tot('Keluar Obat Rusak (Rp)'),
            'Keluar Lainnya (Rp)': tot('Keluar Lainnya (Rp)'),
            'Keluar (Qty)': tot('Keluar (Qty)'), 'Total Keluar (Rp)': tot('Total Keluar (Rp)'),
            'Sisa Stok Saat Ini': tot('Sisa Stok Saat Ini'),
            'Nilai Stok Saat Ini (Rp)': tot('Nilai Stok Saat Ini (Rp)')
        });
    }

    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Info': 'Tidak ada transaksi pada periode ini' }]);
    ws['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 20 }];
    return formatAngkaSheet(ws);
}

// SHEET 3: Rekap Bulanan 12 bulan terakhir + baris TOTAL & Selisih
function buatSheetRekapBulanan() {
    const rekapRows = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = monthStr(d);
        const trx = trxBulan(ym);
        if (trx.length === 0) continue;
        const r = ringkasanTransaksi(trx);
        rekapRows.push({
            'Bulan': labelBulan(ym),
            'Pembelian (Rp)': r.beliRp, 'Pembelian (Qty)': r.beliQty,
            'Keluar Resep Dokter (Rp)': r.perKat['Resep Dokter'].rp,
            'Keluar Obat Expired (Rp)': r.perKat['Obat Expired'].rp,
            'Keluar Obat Rusak (Rp)': r.perKat['Obat Rusak'].rp,
            'Keluar Lainnya (Rp)': r.perKat['Lainnya'].rp,
            'Keluar (Qty)': r.keluarQty, 'Total Keluar (Rp)': r.keluarRp,
            'Selisih (Rp)': r.beliRp - r.keluarRp
        });
    }
    if (rekapRows.length > 0) {
        const tot = f => rekapRows.reduce((s, x) => s + (x[f] || 0), 0);
        rekapRows.push({}, {
            'Bulan': 'TOTAL',
            'Pembelian (Rp)': tot('Pembelian (Rp)'), 'Pembelian (Qty)': tot('Pembelian (Qty)'),
            'Keluar Resep Dokter (Rp)': tot('Keluar Resep Dokter (Rp)'),
            'Keluar Obat Expired (Rp)': tot('Keluar Obat Expired (Rp)'),
            'Keluar Obat Rusak (Rp)': tot('Keluar Obat Rusak (Rp)'),
            'Keluar Lainnya (Rp)': tot('Keluar Lainnya (Rp)'),
            'Keluar (Qty)': tot('Keluar (Qty)'), 'Total Keluar (Rp)': tot('Total Keluar (Rp)'),
            'Selisih (Rp)': tot('Selisih (Rp)')
        });
    }
    const ws = XLSX.utils.json_to_sheet(rekapRows.length ? rekapRows : [{ 'Info': 'Belum ada transaksi' }]);
    ws['!cols'] = [{ wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 14 }];
    return formatAngkaSheet(ws);
}

// SHEET 4 (data mentah): Stok saat ini per batch, urutan FEFO
function buatSheetStok() {
    const stokRows = [];
    const groups = {};
    batchData.filter(b => b.stok_sisa > 0).forEach(b => {
        if (!groups[b.nama_obat]) groups[b.nama_obat] = [];
        groups[b.nama_obat].push(b);
    });
    Object.keys(groups).sort().forEach(nama => {
        sortFefo(groups[nama]).forEach((b, idx) => {
            stokRows.push({
                'Nama Obat': b.nama_obat, 'Urutan FEFO': idx + 1, 'Satuan': b.satuan,
                'Sisa Stok': b.stok_sisa, 'Harga Satuan (Rp)': parseFloat(b.harga_satuan || 0),
                'Nilai (Rp)': b.stok_sisa * parseFloat(b.harga_satuan || 0),
                'Tanggal Masuk': b.tgl_masuk, 'Tanggal Expired': b.tgl_expired,
                'No Faktur': b.no_faktur || '-', 'PBF': b.pbf || '-', 'Keterangan': b.keterangan || '-'
            });
        });
    });
    const totalAset = stokRows.reduce((s, r) => s + r['Nilai (Rp)'], 0);
    if (stokRows.length > 0) stokRows.push({}, { 'Nama Obat': 'TOTAL NILAI ASET OBAT', 'Nilai (Rp)': totalAset });
    const ws = XLSX.utils.json_to_sheet(stokRows.length ? stokRows : [{ 'Info': 'Belum ada stok aktif' }]);
    ws['!cols'] = [{ wch: 28 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 20 }, { wch: 24 }];
    return formatAngkaSheet(ws);
}

// SHEET 5 (data mentah): daftar transaksi apa adanya
function buatSheetTransaksi(trxList) {
    const trxRows = trxList.map(t => ({
        'Tanggal': t.tanggal, 'Jenis': t.jenis, 'Kategori': t.kategori,
        'Nama Obat': t.nama_obat, 'Satuan': t.satuan || '-', 'Jumlah': t.jumlah,
        'Harga Satuan (Rp)': parseFloat(t.harga_satuan || 0), 'Total Nilai (Rp)': parseFloat(t.total_nilai || 0),
        'No Faktur': t.no_faktur || '-', 'PBF': t.pbf || '-', 'Keterangan': t.keterangan || '-'
    }));
    const ws = XLSX.utils.json_to_sheet(trxRows.length ? trxRows : [{ 'Info': 'Tidak ada transaksi pada periode ini' }]);
    ws['!cols'] = [{ wch: 12 }, { wch: 9 }, { wch: 17 }, { wch: 28 }, { wch: 10 }, { wch: 9 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 20 }, { wch: 24 }];
    return formatAngkaSheet(ws);
}

// EXPORT UTAMA (tombol "Export Excel" — rentang tanggal): 5 sheet
function exportToExcel() {
    const tglMulai = document.getElementById('exportMulai').value;
    const tglSelesai = document.getElementById('exportSelesai').value;
    if (!tglMulai || !tglSelesai) { alert('Pilih rentang tanggal terlebih dahulu!'); return; }

    const trxFiltered = transaksiData.filter(t => t.tanggal >= tglMulai && t.tanggal <= tglSelesai);
    const wb = XLSX.utils.book_new();

    // Data olahan — siap presentasi
    XLSX.utils.book_append_sheet(wb, buatSheetRingkasan(`${formatTgl(tglMulai)} s/d ${formatTgl(tglSelesai)}`, trxFiltered), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, buatSheetRekapObat(trxFiltered), 'Rekap per Obat');
    XLSX.utils.book_append_sheet(wb, buatSheetRekapBulanan(), 'Rekap Bulanan');

    // Data mentah
    XLSX.utils.book_append_sheet(wb, buatSheetStok(), 'Stok Saat Ini (Data)');
    XLSX.utils.book_append_sheet(wb, buatSheetTransaksi(trxFiltered), 'Riwayat Transaksi (Data)');

    XLSX.writeFile(wb, `Laporan_Stok_Farmasi_${tglMulai}_sd_${tglSelesai}.xlsx`);
    document.getElementById('modalExport').classList.remove('show');
}

// EXPORT LAPORAN 1 BULAN (tombol di tab Laporan Bulanan): 3 sheet
function exportLaporanBulan() {
    const ym = document.getElementById('laporanBulan').value || monthStr();
    const trx = trxBulan(ym);
    if (trx.length === 0) { alert(`Tidak ada transaksi pada ${labelBulan(ym)}, sehingga tidak ada laporan yang bisa di-download.`); return; }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, buatSheetRingkasan(labelBulan(ym), trx), 'Ringkasan');
    XLSX.utils.book_append_sheet(wb, buatSheetRekapObat(trx), 'Rekap per Obat');
    XLSX.utils.book_append_sheet(wb, buatSheetTransaksi(trx), 'Detail Transaksi (Data)');
    XLSX.writeFile(wb, `Laporan_Bulanan_Farmasi_${ym}.xlsx`);
}
