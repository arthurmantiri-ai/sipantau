/* ============================================================
   PANTAUAN LAB RUTIN — PANEL DASHBOARD (Klinik Imanuel)
   Dimuat oleh dashboard.html SETELAH script utama & lab_core.js.
   Memakai global dashboard: db, exportToXlsx, konfirmasiHapus (ada fallback).
   Panel target: <div class="panel" id="panel-lab_rutin"></div>
   ============================================================ */

/* ---------- STATE ---------- */
let labRows = [];
let labSudahMuat = false;
let labSedangMuat = false;
let labSubTab = 'jadwal';            // jadwal | kepatuhan | riwayat
let labMode = 'bulan';               // bulan | terlambat
let labBulan = labMonthNow();
let labCariJadwalTeks = '';
let labCariKepatuhanTeks = '';
let labCariRiwayatTeks = '';
let labBulanRiwayat = '';
let labJadwalTampil = [];            // list terakhir yang dirender (untuk WA & export)
let labKepatuhanTampil = [];
let labRiwayatTampil = [];
let labEditAsli = null;              // baris asli saat edit
let labEditBaru = null;              // nilai form edit yang menunggu konfirmasi

/* ============================================================
   GAYA (disuntikkan, tercakup di #panel-lab_rutin & .lab-modal)
   ============================================================ */
(function labSuntikGaya() {
    const css = `
#panel-lab_rutin .lab-subtabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:2px solid var(--border); flex-wrap:wrap; }
#panel-lab_rutin .lab-subtab { background:none; border:none; padding:10px 16px; font-family:inherit; font-size:0.9rem; font-weight:600; color:var(--text-mid); cursor:pointer; border-bottom:3px solid transparent; margin-bottom:-2px; display:flex; align-items:center; gap:8px; transition:0.15s; }
#panel-lab_rutin .lab-subtab:hover { color:var(--primary); }
#panel-lab_rutin .lab-subtab.active { color:var(--primary); border-bottom-color:var(--primary-light); }
#panel-lab_rutin .stat-card.lab-klik { cursor:pointer; transition:0.15s; }
#panel-lab_rutin .stat-card.lab-klik:hover { box-shadow:var(--shadow); transform:translateY(-2px); }
#panel-lab_rutin .lab-aksi { display:flex; gap:5px; align-items:center; }
#panel-lab_rutin .lab-wa-mini { background:#25d366; color:#fff; border:none; padding:5px 10px; border-radius:6px; font-size:0.74rem; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:5px; white-space:nowrap; font-family:inherit; transition:0.15s; }
#panel-lab_rutin .lab-wa-mini:hover { background:#1ebe5d; }
#panel-lab_rutin .lab-wa-h1 { background:#128c7e; }
#panel-lab_rutin .lab-wa-h1:hover { background:#0f7a6e; }
#panel-lab_rutin .lab-wa-telat { background:var(--danger-soft); color:var(--danger); border:1px solid #ef9a9a; }
#panel-lab_rutin .lab-wa-telat:hover { background:#ffcdd2; }
#panel-lab_rutin .lab-tanpa-telp { font-size:0.75rem; color:var(--text-soft); font-style:italic; white-space:nowrap; }
#panel-lab_rutin .lab-note { font-size:0.78rem; color:var(--text-mid); margin:10px 2px 0; }
#panel-lab_rutin details.lab-details { margin-top:18px; }
#panel-lab_rutin details.lab-details summary { cursor:pointer; font-weight:600; font-size:0.9rem; color:var(--text-mid); padding:10px 4px; user-select:none; }
#panel-lab_rutin details.lab-details summary:hover { color:var(--primary); }
#panel-lab_rutin .lab-persen { font-family:'DM Mono', monospace; font-weight:700; }
.lab-modal { position:fixed; inset:0; background:rgba(15,40,35,0.5); display:none; align-items:center; justify-content:center; z-index:3000; padding:18px; }
.lab-modal.show { display:flex; animation:labModalIn 0.2s ease; }
@keyframes labModalIn { from { opacity:0; } to { opacity:1; } }
.lab-modal-card { background:var(--surface); border-radius:14px; max-width:660px; width:100%; max-height:88vh; overflow-y:auto; padding:24px 26px; box-shadow:0 24px 60px rgba(0,0,0,0.3); }
.lab-modal-card h3 { font-size:1.05rem; color:var(--text); display:flex; align-items:center; gap:9px; margin-bottom:4px; }
.lab-modal-card .lab-modal-sub { font-size:0.82rem; color:var(--text-mid); margin-bottom:16px; }
.lab-modal-tutup { float:right; background:none; border:none; font-size:1.15rem; color:var(--text-soft); cursor:pointer; padding:2px 6px; }
.lab-modal-tutup:hover { color:var(--danger); }
.lab-edit-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 14px; }
.lab-edit-grid .penuh { grid-column:1 / -1; }
.lab-edit-grid label { display:block; font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--text-mid); margin-bottom:5px; letter-spacing:0.03em; }
.lab-edit-grid input, .lab-edit-grid select, .lab-edit-grid textarea { width:100%; padding:9px 11px; border:1px solid var(--border); border-radius:8px; font-family:inherit; font-size:0.9rem; background:var(--surface2); }
.lab-edit-grid input:focus, .lab-edit-grid select:focus, .lab-edit-grid textarea:focus { outline:none; border-color:var(--primary-light); box-shadow:0 0 0 3px rgba(0,137,123,0.1); }
.lab-preview-jadwal { grid-column:1 / -1; background:#e0f2f1; border:1px solid #b2dfdb; border-radius:8px; padding:10px 13px; font-size:0.83rem; color:var(--primary); line-height:1.6; }
.lab-modal-footer { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
.lab-btn-batal { background:var(--surface2); color:var(--text-mid); border:1px solid var(--border); padding:9px 16px; border-radius:8px; cursor:pointer; font-family:inherit; font-weight:600; }
.lab-btn-simpan { background:var(--primary); color:#fff; border:none; padding:9px 18px; border-radius:8px; cursor:pointer; font-family:inherit; font-weight:600; display:inline-flex; align-items:center; gap:7px; }
.lab-btn-simpan:hover { background:var(--primary-mid); }
.lab-btn-simpan:disabled { opacity:0.6; cursor:wait; }
.lab-diff-list { list-style:none; margin:10px 0 0; }
.lab-diff-list li { padding:9px 12px; border:1px solid var(--border); border-radius:8px; margin-bottom:7px; font-size:0.86rem; background:var(--surface2); }
.lab-diff-list .lama { color:var(--danger); text-decoration:line-through; margin:0 6px; }
.lab-diff-list .baru { color:var(--success); font-weight:700; margin-left:6px; }
.lab-timeline { list-style:none; margin:6px 0 0; padding-left:4px; }
.lab-timeline > li { position:relative; padding:0 0 14px 22px; border-left:2px solid var(--border); margin-left:8px; }
.lab-timeline > li:last-child { border-left-color:transparent; }
.lab-timeline > li::before { content:''; position:absolute; left:-6px; top:3px; width:10px; height:10px; border-radius:50%; background:var(--primary-light); }
.lab-timeline .tl-tgl { font-weight:700; font-size:0.88rem; color:var(--text); }
.lab-timeline .tl-sub { font-size:0.79rem; color:var(--text-mid); margin-top:2px; }
.lab-timeline .tl-int { font-size:0.78rem; margin-top:7px; padding:6px 10px; border-radius:7px; display:inline-block; }
.lab-timeline .tl-int.ok { background:var(--success-soft); color:var(--success); }
.lab-timeline .tl-int.telat { background:var(--danger-soft); color:var(--danger); }
.lab-timeline .tl-int.jalan { background:var(--warn-soft); color:var(--warn); }
@media (max-width:640px){ .lab-edit-grid { grid-template-columns:1fr; } }
`;
    const s = document.createElement('style');
    s.id = 'labRutinStyle';
    s.textContent = css;
    document.head.appendChild(s);
})();

/* ============================================================
   KERANGKA PANEL
   ============================================================ */
function labInitPanel() {
    const panel = document.getElementById('panel-lab_rutin');
    if (!panel) { console.warn('[Lab Rutin] Elemen #panel-lab_rutin tidak ditemukan di dashboard.html — patch belum dipasang.'); return; }
    panel.innerHTML = `
        <div class="section-header">
            <div class="section-title">
                <div class="section-icon" style="background:#e0f2f1;color:var(--primary);"><i class="fa-solid fa-flask-vial"></i></div>
                <div>
                    <h2>Pantauan Lab Rutin</h2>
                    <p>Jadwal kontrol 3 &amp; 6 bulan pasien DM / HPT / HPT+DM</p>
                </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <a href="lab_rutin.html" class="btn-search" style="text-decoration:none;"><i class="fa-solid fa-plus"></i> Input Data</a>
                <button class="btn-reset" onclick="loadLabRutin(true)" title="Muat ulang data"><i class="fa-solid fa-rotate"></i></button>
            </div>
        </div>

        <div class="stats-grid">
            <div class="stat-card lab-klik" onclick="labKeBulanIni()" title="Lihat daftar jadwal bulan ini">
                <div class="stat-label">Jadwal Bulan Ini</div>
                <div class="stat-value" id="labStatBulanIni">–</div>
                <div class="stat-sub" id="labStatBulanIniSub">pasien harus periksa</div>
            </div>
            <div class="stat-card lab-klik" onclick="labKeTerlambat()" title="Lihat semua pasien terlambat">
                <div class="stat-label">Terlambat</div>
                <div class="stat-value" id="labStatTerlambat" style="color:var(--danger);">–</div>
                <div class="stat-sub">lewat jadwal, belum periksa</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Sudah Periksa Bulan Ini</div>
                <div class="stat-value" id="labStatSudah" style="color:var(--success);">–</div>
                <div class="stat-sub" id="labStatSudahSub">pasien</div>
            </div>
            <div class="stat-card">
                <div class="stat-label">Pasien Terpantau</div>
                <div class="stat-value" id="labStatPasien">–</div>
                <div class="stat-sub" id="labStatPasienSub">total data</div>
            </div>
        </div>

        <div class="lab-subtabs">
            <button class="lab-subtab active" data-sub="jadwal" onclick="labGantiSubTab('jadwal')"><i class="fa-solid fa-calendar-days"></i> Jadwal Pemeriksaan</button>
            <button class="lab-subtab" data-sub="kepatuhan" onclick="labGantiSubTab('kepatuhan')"><i class="fa-solid fa-user-check"></i> Kepatuhan Pasien</button>
            <button class="lab-subtab" data-sub="riwayat" onclick="labGantiSubTab('riwayat')"><i class="fa-solid fa-clock-rotate-left"></i> Riwayat Input</button>
        </div>

        <div id="labKonten"><div class="empty"><i class="fa-solid fa-flask-vial"></i><p>Memuat data lab rutin...</p></div></div>

        <div class="lab-modal" id="labModal" onclick="if(event.target===this) labTutupModal()">
            <div class="lab-modal-card" id="labModalIsi"></div>
        </div>`;
}

/* ============================================================
   MUAT DATA & STATISTIK
   ============================================================ */
async function loadLabRutin(paksa) {
    const panel = document.getElementById('panel-lab_rutin');
    if (!panel || labSedangMuat) return;
    if (labSudahMuat && !paksa) { labRenderKonten(); return; }
    labSedangMuat = true;
    try {
        labRows = await labAmbilSemua(db);
        labSudahMuat = true;
        labHitungStatistik();
        labRenderKonten();
    } catch (err) {
        document.getElementById('labKonten').innerHTML =
            `<div class="empty"><i class="fa-solid fa-triangle-exclamation"></i>
             <p>Gagal memuat data: ${labEsc(err.message)}<br>
             <small>Pastikan tabel <strong>lab_rutin</strong> sudah dibuat (jalankan <code>supabase_patch_lab_rutin.sql</code> di Supabase SQL Editor).</small></p></div>`;
    } finally {
        labSedangMuat = false;
    }
}

function labHitungStatistik() {
    const today = labTodayStr();
    const ymNow = labMonthNow();
    const jadwal = labJadwalMendatang(labRows);

    const pasienBulanIni = new Set(jadwal.filter(j => j.due.startsWith(ymNow)).map(j => j.key));
    const pasienTelat = new Set(jadwal.filter(j => j.due < today).map(j => j.key));
    const pasienSudah = new Set(labRows.filter(r => String(r.tanggal_lab).startsWith(ymNow)).map(r => labKunciPasien(r)));
    const semuaPasien = new Set(labRows.map(r => labKunciPasien(r)));

    document.getElementById('labStatBulanIni').textContent = pasienBulanIni.size;
    document.getElementById('labStatBulanIniSub').textContent = `harus periksa • ${labLabelBulan(ymNow)}`;
    document.getElementById('labStatTerlambat').textContent = pasienTelat.size;
    document.getElementById('labStatSudah').textContent = pasienSudah.size;
    document.getElementById('labStatSudahSub').textContent = `pasien • ${labLabelBulan(ymNow)}`;
    document.getElementById('labStatPasien').textContent = semuaPasien.size;
    document.getElementById('labStatPasienSub').textContent = `${labRows.length} data pemeriksaan`;
}

function labKeBulanIni() { labMode = 'bulan'; labBulan = labMonthNow(); labGantiSubTab('jadwal'); }
function labKeTerlambat() { labMode = 'terlambat'; labGantiSubTab('jadwal'); }

function labGantiSubTab(nama) {
    labSubTab = nama;
    document.querySelectorAll('#panel-lab_rutin .lab-subtab').forEach(b =>
        b.classList.toggle('active', b.dataset.sub === nama));
    labRenderKonten();
}

function labRenderKonten() {
    if (!labSudahMuat) return;
    if (labSubTab === 'jadwal') labRenderJadwal();
    else if (labSubTab === 'kepatuhan') labRenderKepatuhan();
    else labRenderRiwayat();
}

/* ============================================================
   SUB-TAB 1 — JADWAL PEMERIKSAAN
   ============================================================ */
function labRenderJadwal() {
    const wadah = document.getElementById('labKonten');
    const today = labTodayStr();
    const semuaJadwal = labJadwalMendatang(labRows);
    const cari = labCariJadwalTeks.trim().toLowerCase();

    let daftar = labMode === 'terlambat'
        ? semuaJadwal.filter(j => j.due < today)
        : semuaJadwal.filter(j => j.due.startsWith(labBulan));
    if (cari) daftar = daftar.filter(j =>
        j.nama.toLowerCase().includes(cari) || String(j.no_bpjs).includes(cari));
    labJadwalTampil = daftar;

    const judul = labMode === 'terlambat'
        ? `Semua Pasien Terlambat (lewat jadwal, belum periksa)`
        : `Harus Periksa — ${labLabelBulan(labBulan)}`;

    const barisTabel = daftar.map((j, i) => {
        const st = labStatusJadwal(j.due, today);
        const adaTelp = !!labWaNomor(j.no_telp);
        const tombolWa = adaTelp ? `
            <button class="lab-wa-mini" onclick="labWa(${i},'h7')" title="Kirim pengingat jadwal (dipakai ± H-7)"><i class="fa-brands fa-whatsapp"></i> H-7</button>
            <button class="lab-wa-mini lab-wa-h1" onclick="labWa(${i},'h1')" title="Kirim pengingat puasa (dipakai H-1)"><i class="fa-brands fa-whatsapp"></i> H-1 Puasa</button>
            ${st.kode === 'terlambat' ? `<button class="lab-wa-mini lab-wa-telat" onclick="labWa(${i},'telat')" title="Kirim pesan susulan (jadwal terlewat)"><i class="fa-brands fa-whatsapp"></i> Susulan</button>` : ''}`
            : `<span class="lab-tanpa-telp">tanpa no. telp</span>`;
        return `<tr>
            <td>${i + 1}</td>
            <td class="td-name">${labEsc(j.nama)}</td>
            <td class="td-mono">${labEsc(j.no_bpjs || '-')}</td>
            <td class="td-mono">${labEsc(j.no_telp || '-')}</td>
            <td><span class="badge badge-teal">${labEsc(j.diagnosa)}</span></td>
            <td>${j.jenisKode === 3 ? '<span class="badge badge-blue">3 Bulan</span>' : '<span class="badge badge-gray">6 Bulan</span>'}</td>
            <td class="td-date">${labFmtTgl(j.due)}</td>
            <td class="td-date" title="Pemeriksaan terakhir">${labFmtTgl(j.tanggalTerakhir)}</td>
            <td><span class="badge ${st.cls}">${st.label}</span></td>
            <td><div class="lab-aksi">${tombolWa}</div></td>
        </tr>`;
    }).join('');

    // Pasien yang SUDAH periksa pada bulan terpilih (hanya mode bulan)
    let sudahHtml = '';
    if (labMode === 'bulan') {
        const sudah = labRows.filter(r => String(r.tanggal_lab).startsWith(labBulan))
            .sort((a, b) => String(b.tanggal_lab).localeCompare(String(a.tanggal_lab)));
        sudahHtml = `
        <details class="lab-details">
            <summary><i class="fa-solid fa-circle-check" style="color:var(--success);margin-right:6px"></i>
                Sudah periksa pada ${labLabelBulan(labBulan)} — ${sudah.length} data</summary>
            ${sudah.length ? `<div class="table-wrap" style="margin-top:8px;"><div class="table-scroll"><table>
                <thead><tr><th>Tgl Periksa</th><th>Nama</th><th>Diagnosa</th><th>Lab</th><th>Kontrol 3 Bln</th><th>Kontrol 6 Bln</th></tr></thead>
                <tbody>${sudah.map(r => `<tr>
                    <td class="td-date">${labFmtTgl(r.tanggal_lab)}</td>
                    <td class="td-name">${labEsc(r.nama_pasien)}</td>
                    <td><span class="badge badge-teal">${labEsc(r.diagnosa)}</span></td>
                    <td>${labEsc(r.lab_pemeriksa || '-')}</td>
                    <td class="td-date">${labFmtTgl(r.next_3bln)}</td>
                    <td class="td-date">${labFmtTgl(r.next_6bln)}</td>
                </tr>`).join('')}</tbody>
            </table></div></div>` : `<p class="lab-note">Belum ada pemeriksaan pada bulan ini.</p>`}
        </details>`;
    }

    wadah.innerHTML = `
        <div class="filter-bar">
            <div class="filter-group" style="max-width:190px;">
                <label>Mode</label>
                <select class="filter-control" onchange="labSetMode(this.value)">
                    <option value="bulan" ${labMode === 'bulan' ? 'selected' : ''}>Per Bulan</option>
                    <option value="terlambat" ${labMode === 'terlambat' ? 'selected' : ''}>Semua Terlambat</option>
                </select>
            </div>
            <div class="filter-group" style="max-width:190px;">
                <label>Bulan Jadwal</label>
                <input type="month" class="filter-control" value="${labBulan}" ${labMode === 'terlambat' ? 'disabled' : ''} onchange="labSetBulan(this.value)">
            </div>
            <div class="filter-group">
                <label>Cari Nama / BPJS</label>
                <input type="text" class="filter-control" value="${labEsc(labCariJadwalTeks)}" placeholder="Ketik nama atau nomor..." oninput="labCariJadwal(this.value)">
            </div>
            <button class="btn-reset" onclick="labKeBulanIni()" title="Kembali ke bulan berjalan">Bulan Ini</button>
            <button class="btn-export" onclick="labExportJadwal()"><i class="fa-solid fa-file-excel"></i> Export</button>
        </div>

        <div class="table-wrap">
            <div class="table-scroll">
                <table>
                    <thead><tr>
                        <th>#</th><th>Nama Pasien</th><th>No. BPJS</th><th>No. Telp</th><th>Diagnosa</th>
                        <th>Kontrol</th><th>Tgl Jadwal</th><th>Terakhir Periksa</th><th>Status</th><th>Ingatkan via WA</th>
                    </tr></thead>
                    <tbody>${barisTabel || `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-soft);">
                        ${labMode === 'terlambat' ? 'Tidak ada pasien terlambat. 🎉' : `Tidak ada jadwal pemeriksaan pada ${labLabelBulan(labBulan)}.`}
                    </td></tr>`}</tbody>
                </table>
            </div>
        </div>
        <p class="lab-note"><strong>${judul}</strong> — ${daftar.length} jadwal.
            Tombol <em>H-7</em> mengingatkan jadwal seminggu sebelumnya; <em>H-1 Puasa</em> mengingatkan puasa 10–12 jam sehari sebelum pemeriksaan.
            Pasien yang sudah periksa otomatis berpindah ke jadwal berikutnya.</p>
        ${sudahHtml}`;
}

function labSetMode(v) { labMode = v; labRenderJadwal(); }
function labSetBulan(v) { if (v) { labBulan = v; labRenderJadwal(); } }
function labCariJadwal(v) {
    labCariJadwalTeks = v;
    clearTimeout(labCariJadwal._t);
    labCariJadwal._t = setTimeout(() => {
        labRenderJadwal();
        const inp = document.querySelector('#labKonten .filter-bar input[type="text"]');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 300);
}

function labWa(i, tipe) {
    const j = labJadwalTampil[i];
    if (!j) return;
    const tgl = labFmtTglPanjang(j.due);
    let pesan;
    if (tipe === 'h1') pesan = labPesanH1(j.nama, tgl);
    else if (tipe === 'telat') pesan = labPesanTerlambat(j.nama, tgl);
    else pesan = labPesanH7(j.nama, j.jenis, tgl);
    const link = labWaLink(j.no_telp, pesan);
    if (!link) { alert('Nomor telp pasien ini tidak valid.'); return; }
    window.open(link, '_blank');
}

function labExportJadwal() {
    if (!labJadwalTampil.length) { alert('Tidak ada data untuk diexport.'); return; }
    const today = labTodayStr();
    const rows = labJadwalTampil.map(j => ({
        'Nama Pasien': j.nama,
        'No BPJS': j.no_bpjs || '',
        'No Telp': j.no_telp || '',
        'Diagnosa': j.diagnosa,
        'Jenis Kontrol': j.jenis,
        'Tanggal Jadwal': j.due,
        'Terakhir Periksa': j.tanggalTerakhir,
        'Status': labStatusJadwal(j.due, today).label,
        'Lab Terakhir': j.lab_pemeriksa || ''
    }));
    const nama = labMode === 'terlambat' ? `jadwal_lab_terlambat_${today}` : `jadwal_lab_${labBulan}`;
    labKeExcel(rows, nama);
}

/* ============================================================
   SUB-TAB 2 — KEPATUHAN PASIEN
   ============================================================ */
function labRenderKepatuhan() {
    const wadah = document.getElementById('labKonten');
    const today = labTodayStr();
    const cari = labCariKepatuhanTeks.trim().toLowerCase();

    let daftar = [...labKelompokkan(labRows).values()].map(p => ({
        profil: p,
        kep: labHitungKepatuhan(p.records, today)
    }));
    if (cari) daftar = daftar.filter(d =>
        String(d.profil.latest.nama_pasien).toLowerCase().includes(cari) ||
        String(d.profil.latest.no_bpjs || '').includes(cari));
    daftar.sort((a, b) =>
        a.kep.badge.urut - b.kep.badge.urut ||
        (a.kep.persen ?? 101) - (b.kep.persen ?? 101) ||
        String(a.profil.latest.nama_pasien).localeCompare(String(b.profil.latest.nama_pasien)));
    labKepatuhanTampil = daftar;

    const baris = daftar.map((d, i) => {
        const t = d.profil.latest;
        const k = d.kep;
        const stBerikut = k.dueBerjalan ? labStatusJadwal(k.dueBerjalan, today) : null;
        return `<tr>
            <td>${i + 1}</td>
            <td class="td-name">${labEsc(t.nama_pasien)}</td>
            <td class="td-mono">${labEsc(t.no_bpjs || '-')}</td>
            <td><span class="badge badge-teal">${labEsc(t.diagnosa)}</span></td>
            <td style="text-align:center;">${k.jumlah}×</td>
            <td class="td-date">${labFmtTgl(t.tanggal_lab)}</td>
            <td class="td-date">${labFmtTgl(k.dueBerjalan)} ${stBerikut && stBerikut.kode === 'terlambat' ? `<span class="badge badge-red" style="margin-left:4px;">${stBerikut.label}</span>` : ''}</td>
            <td style="text-align:center;">${k.total ? `${k.tepat}/${k.total}` : '-'}</td>
            <td style="text-align:center;" class="lab-persen">${k.persen === null ? '-' : k.persen + '%'}</td>
            <td><span class="badge ${k.badge.cls}">${k.badge.label}</span></td>
            <td><button class="btn-edit" onclick="labBukaDetail(${i})" title="Lihat riwayat & penilaian"><i class="fa-solid fa-eye"></i> Detail</button></td>
        </tr>`;
    }).join('');

    wadah.innerHTML = `
        <div class="filter-bar">
            <div class="filter-group">
                <label>Cari Nama / BPJS</label>
                <input type="text" class="filter-control" value="${labEsc(labCariKepatuhanTeks)}" placeholder="Ketik nama atau nomor..." oninput="labCariKepatuhan(this.value)">
            </div>
            <button class="btn-export" onclick="labExportKepatuhan()"><i class="fa-solid fa-file-excel"></i> Export</button>
        </div>
        <div class="table-wrap">
            <div class="table-scroll">
                <table>
                    <thead><tr>
                        <th>#</th><th>Nama Pasien</th><th>No. BPJS</th><th>Diagnosa</th><th>Jml Periksa</th>
                        <th>Terakhir</th><th>Jadwal Berikut</th><th>Tepat Waktu</th><th>%</th><th>Status</th><th></th>
                    </tr></thead>
                    <tbody>${baris || `<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--text-soft);">Belum ada data pasien.</td></tr>`}</tbody>
                </table>
            </div>
        </div>
        <p class="lab-note">Pemeriksaan dihitung <strong>tepat waktu</strong> bila dilakukan paling lambat
            ${LAB_GRACE_HARI} hari setelah jadwal (3 bulan untuk DM/HPT+DM, 6 bulan untuk HPT).
            <strong>Rutin</strong> ≥ 80% • <strong>Cukup Rutin</strong> 50–79% • <strong>Kurang Rutin</strong> &lt; 50%.</p>`;
}

function labCariKepatuhan(v) {
    labCariKepatuhanTeks = v;
    clearTimeout(labCariKepatuhan._t);
    labCariKepatuhan._t = setTimeout(() => {
        labRenderKepatuhan();
        const inp = document.querySelector('#labKonten .filter-bar input[type="text"]');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 300);
}

function labBukaDetail(i) {
    const d = labKepatuhanTampil[i];
    if (!d) return;
    const t = d.profil.latest;
    const k = d.kep;
    const records = d.profil.records;

    const itemTimeline = records.map((r, idx) => {
        const int = k.detail.find(x => x.ke === idx + 2); // interval dari pemeriksaan ini menuju pemeriksaan berikutnya
        return `<li>
            <div class="tl-tgl">${labFmtTglPanjang(r.tanggal_lab)} <span class="badge badge-teal" style="margin-left:6px;">${labEsc(r.diagnosa)}</span></div>
            <div class="tl-sub">${labEsc(r.lab_pemeriksa || '-')}
                ${r.catatan ? ` • ${labEsc(r.catatan)}` : ''}<br>
                Jadwal berikutnya: ${r.next_3bln ? `3 bln → ${labFmtTgl(r.next_3bln)}, ` : ''}6 bln → ${labFmtTgl(r.next_6bln)}</div>
            ${int ? `<div class="tl-int ${int.ok ? 'ok' : 'telat'}">
                <i class="fa-solid ${int.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
                Pemeriksaan berikutnya: jadwal ${labFmtTgl(int.jadwal)} → datang ${labFmtTgl(int.aktual)} (${int.status})
            </div>` : ''}
        </li>`;
    }).join('');

    const berjalan = k.dueBerjalan ? (() => {
        const st = labStatusJadwal(k.dueBerjalan);
        const telat = st.kode === 'terlambat';
        return `<li>
            <div class="tl-tgl" style="color:var(--text-mid);">Jadwal berjalan: ${labFmtTglPanjang(k.dueBerjalan)}</div>
            <div class="tl-int ${telat ? (k.pendingTelat ? 'telat' : 'jalan') : 'jalan'}">
                <i class="fa-solid ${telat ? 'fa-triangle-exclamation' : 'fa-hourglass-half'}"></i> ${st.label}${telat && !k.pendingTelat ? ' (masih dalam toleransi)' : ''}
            </div>
        </li>` })() : '';

    document.getElementById('labModalIsi').innerHTML = `
        <button class="lab-modal-tutup" onclick="labTutupModal()"><i class="fa-solid fa-xmark"></i></button>
        <h3><i class="fa-solid fa-user-check" style="color:var(--primary);"></i> ${labEsc(t.nama_pasien)}</h3>
        <div class="lab-modal-sub">
            BPJS: ${labEsc(t.no_bpjs || '-')} • Telp: ${labEsc(t.no_telp || '-')} • ${k.jumlah}× pemeriksaan
            &nbsp;<span class="badge ${k.badge.cls}">${k.badge.label}${k.persen !== null ? ` — ${k.persen}%` : ''}</span>
        </div>
        <ul class="lab-timeline">${itemTimeline}${berjalan}</ul>
        <p class="lab-note" style="margin-top:14px;">Toleransi keterlambatan penilaian: ${LAB_GRACE_HARI} hari setelah jadwal.</p>`;
    document.getElementById('labModal').classList.add('show');
}

function labExportKepatuhan() {
    if (!labKepatuhanTampil.length) { alert('Tidak ada data untuk diexport.'); return; }
    const rows = labKepatuhanTampil.map(d => ({
        'Nama Pasien': d.profil.latest.nama_pasien,
        'No BPJS': d.profil.latest.no_bpjs || '',
        'No Telp': d.profil.latest.no_telp || '',
        'Diagnosa': d.profil.latest.diagnosa,
        'Jumlah Periksa': d.kep.jumlah,
        'Terakhir Periksa': d.profil.latest.tanggal_lab,
        'Jadwal Berikut': d.kep.dueBerjalan || '',
        'Tepat Waktu': d.kep.total ? `${d.kep.tepat}/${d.kep.total}` : '-',
        'Persen': d.kep.persen === null ? '' : d.kep.persen,
        'Status': d.kep.badge.label
    }));
    labKeExcel(rows, `kepatuhan_lab_${labTodayStr()}`);
}

/* ============================================================
   SUB-TAB 3 — RIWAYAT INPUT (edit & hapus)
   ============================================================ */
function labRenderRiwayat() {
    const wadah = document.getElementById('labKonten');
    const cari = labCariRiwayatTeks.trim().toLowerCase();
    const MAKS = 400;

    let daftar = [...labRows].sort((a, b) =>
        String(b.tanggal_lab).localeCompare(String(a.tanggal_lab)) || (b.id - a.id));
    if (labBulanRiwayat) daftar = daftar.filter(r => String(r.tanggal_lab).startsWith(labBulanRiwayat));
    if (cari) daftar = daftar.filter(r =>
        String(r.nama_pasien).toLowerCase().includes(cari) || String(r.no_bpjs || '').includes(cari));
    labRiwayatTampil = daftar;
    const tampil = daftar.slice(0, MAKS);

    const baris = tampil.map(r => `<tr>
        <td class="td-date">${labFmtTgl(r.tanggal_lab)}</td>
        <td class="td-name">${labEsc(r.nama_pasien)}</td>
        <td class="td-mono">${labEsc(r.no_bpjs || '-')}</td>
        <td class="td-mono">${labEsc(r.no_telp || '-')}</td>
        <td><span class="badge badge-teal">${labEsc(r.diagnosa)}</span></td>
        <td>${labEsc(r.lab_pemeriksa || '-')}</td>
        <td class="td-date">${labFmtTgl(r.next_3bln)}</td>
        <td class="td-date">${labFmtTgl(r.next_6bln)}</td>
        <td title="${labEsc(r.catatan || '')}">${r.catatan ? labEsc(String(r.catatan).slice(0, 28)) + (String(r.catatan).length > 28 ? '…' : '') : '-'}</td>
        <td><div class="lab-aksi">
            <button class="btn-edit" onclick="labBukaEdit(${r.id})" title="Edit data"><i class="fa-solid fa-pen"></i></button>
            <button class="btn-hapus" onclick="labHapusData(${r.id}, '${labEscJs(r.nama_pasien)}')" title="Hapus data"><i class="fa-solid fa-trash-can"></i></button>
        </div></td>
    </tr>`).join('');

    wadah.innerHTML = `
        <div class="filter-bar">
            <div class="filter-group">
                <label>Cari Nama / BPJS</label>
                <input type="text" class="filter-control" value="${labEsc(labCariRiwayatTeks)}" placeholder="Ketik nama atau nomor..." oninput="labCariRiwayat(this.value)">
            </div>
            <div class="filter-group" style="max-width:190px;">
                <label>Bulan Periksa</label>
                <input type="month" class="filter-control" value="${labBulanRiwayat}" onchange="labSetBulanRiwayat(this.value)">
            </div>
            <button class="btn-reset" onclick="labSetBulanRiwayat('')">Semua Bulan</button>
        </div>
        <div class="table-wrap">
            <div class="table-scroll">
                <table>
                    <thead><tr>
                        <th>Tgl Lab</th><th>Nama Pasien</th><th>No. BPJS</th><th>No. Telp</th><th>Diagnosa</th>
                        <th>Lab Pemeriksa</th><th>Kontrol 3 Bln</th><th>Kontrol 6 Bln</th><th>Catatan</th><th>Aksi</th>
                    </tr></thead>
                    <tbody>${baris || `<tr><td colspan="10" style="text-align:center;padding:32px;color:var(--text-soft);">Tidak ada data yang cocok.</td></tr>`}</tbody>
                </table>
            </div>
        </div>
        <p class="lab-note">${daftar.length} data${daftar.length > MAKS ? ` — ditampilkan ${MAKS} teratas, persempit dengan filter` : ''}.
            Mengubah <em>diagnosa</em> atau <em>tanggal lab</em> akan menghitung ulang jadwal kontrol otomatis.</p>`;
}

function labCariRiwayat(v) {
    labCariRiwayatTeks = v;
    clearTimeout(labCariRiwayat._t);
    labCariRiwayat._t = setTimeout(() => {
        labRenderRiwayat();
        const inp = document.querySelector('#labKonten .filter-bar input[type="text"]');
        if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }, 300);
}
function labSetBulanRiwayat(v) { labBulanRiwayat = v || ''; labRenderRiwayat(); }

function labHapusData(id, nama) {
    if (typeof konfirmasiHapus === 'function') {
        konfirmasiHapus(LAB_TABLE, id, nama, labSetelahHapus);
    } else if (confirm(`Hapus data lab "${nama}"? Tindakan ini tidak dapat dibatalkan.`)) {
        db.from(LAB_TABLE).delete().eq('id', id).then(({ error }) => {
            if (error) alert('Gagal menghapus: ' + error.message);
            else labSetelahHapus();
        });
    }
}
function labSetelahHapus() { loadLabRutin(true); }

/* ---------- Modal EDIT (dengan konfirmasi ringkasan perubahan) ---------- */
const LAB_LABEL_FIELD = {
    nama_pasien: 'Nama Pasien', no_bpjs: 'No. BPJS', no_telp: 'No. Telp',
    lab_pemeriksa: 'Lab Pemeriksa', diagnosa: 'Diagnosa', tanggal_lab: 'Tanggal Lab', catatan: 'Catatan'
};

function labBukaEdit(id, pakaiDraft) {
    const r = labRows.find(x => x.id === id);
    if (!r) return;
    labEditAsli = { ...r };
    const v = (pakaiDraft && labEditBaru) ? labEditBaru : r;
    document.getElementById('labModalIsi').innerHTML = `
        <button class="lab-modal-tutup" onclick="labTutupModal()"><i class="fa-solid fa-xmark"></i></button>
        <h3><i class="fa-solid fa-pen-to-square" style="color:var(--info);"></i> Edit Data Lab Rutin</h3>
        <div class="lab-modal-sub">ID #${r.id} • diinput ${labFmtTgl(String(r.created_at).slice(0, 10))}</div>
        <div class="lab-edit-grid" id="labFormEdit">
            <div><label>Nama Pasien *</label><input id="le_nama" value="${labEsc(v.nama_pasien)}"></div>
            <div><label>No. BPJS</label><input id="le_bpjs" value="${labEsc(v.no_bpjs || '')}"></div>
            <div><label>No. Telp / WA</label><input id="le_telp" value="${labEsc(v.no_telp || '')}"></div>
            <div><label>Lab Pemeriksa *</label><input id="le_lab" value="${labEsc(v.lab_pemeriksa || '')}"></div>
            <div><label>Diagnosa *</label>
                <select id="le_diag" onchange="labEditPreview()">
                    ${LAB_DIAGNOSA_LIST.map(d => `<option value="${d}" ${v.diagnosa === d ? 'selected' : ''}>${d}</option>`).join('')}
                </select></div>
            <div><label>Tanggal Lab *</label><input type="date" id="le_tgl" value="${v.tanggal_lab}" onchange="labEditPreview()"></div>
            <div class="penuh"><label>Catatan</label><textarea id="le_catatan" rows="2">${labEsc(v.catatan || '')}</textarea></div>
            <div class="lab-preview-jadwal" id="labPreviewJadwal"></div>
        </div>
        <div class="lab-modal-footer">
            <button class="lab-btn-batal" onclick="labTutupModal()">Batal</button>
            <button class="lab-btn-simpan" onclick="labEditKeDiff()"><i class="fa-solid fa-floppy-disk"></i> Simpan Perubahan</button>
        </div>`;
    labEditPreview();
    document.getElementById('labModal').classList.add('show');
}

function labEditPreview() {
    const diag = document.getElementById('le_diag').value;
    const tgl = document.getElementById('le_tgl').value;
    const j = labHitungJadwal(diag, tgl);
    document.getElementById('labPreviewJadwal').innerHTML =
        `<i class="fa-solid fa-wand-magic-sparkles"></i> Jadwal otomatis setelah disimpan:
         ${j.next3 ? `<strong>3 bln → ${labFmtTgl(j.next3)}</strong> • ` : ''}<strong>6 bln → ${labFmtTgl(j.next6)}</strong>`;
}

function labAmbilFormEdit() {
    return {
        nama_pasien: document.getElementById('le_nama').value.trim(),
        no_bpjs: document.getElementById('le_bpjs').value.trim() || null,
        no_telp: document.getElementById('le_telp').value.trim() || null,
        lab_pemeriksa: document.getElementById('le_lab').value.trim(),
        diagnosa: document.getElementById('le_diag').value,
        tanggal_lab: document.getElementById('le_tgl').value,
        catatan: document.getElementById('le_catatan').value.trim() || null
    };
}

function labEditKeDiff() {
    const baru = labAmbilFormEdit();
    if (!baru.nama_pasien || !baru.lab_pemeriksa || !baru.diagnosa || !baru.tanggal_lab) {
        alert('Nama, lab pemeriksa, diagnosa, dan tanggal wajib diisi.'); return;
    }
    const berubah = Object.keys(LAB_LABEL_FIELD).filter(f =>
        String(labEditAsli[f] ?? '') !== String(baru[f] ?? ''));
    if (!berubah.length) { alert('Tidak ada perubahan.'); return; }

    labEditBaru = baru;
    const j = labHitungJadwal(baru.diagnosa, baru.tanggal_lab);
    const jadwalBerubah = (labEditAsli.next_3bln || null) !== (j.next3 || null) || labEditAsli.next_6bln !== j.next6;

    document.getElementById('labModalIsi').innerHTML = `
        <button class="lab-modal-tutup" onclick="labTutupModal()"><i class="fa-solid fa-xmark"></i></button>
        <h3><i class="fa-solid fa-list-check" style="color:var(--warn);"></i> Konfirmasi Perubahan</h3>
        <div class="lab-modal-sub">Periksa kembali sebelum disimpan — ${labEsc(labEditAsli.nama_pasien)} (ID #${labEditAsli.id})</div>
        <ul class="lab-diff-list">
            ${berubah.map(f => `<li><strong>${LAB_LABEL_FIELD[f]}:</strong>
                <span class="lama">${labEsc(labEditAsli[f] ?? '—') || '—'}</span> →
                <span class="baru">${labEsc(baru[f] ?? '—') || '—'}</span></li>`).join('')}
            ${jadwalBerubah ? `<li><strong>Jadwal Kontrol (otomatis):</strong>
                <span class="lama">${labEditAsli.next_3bln ? '3 bln ' + labFmtTgl(labEditAsli.next_3bln) + ', ' : ''}6 bln ${labFmtTgl(labEditAsli.next_6bln)}</span> →
                <span class="baru">${j.next3 ? '3 bln ' + labFmtTgl(j.next3) + ', ' : ''}6 bln ${labFmtTgl(j.next6)}</span></li>` : ''}
        </ul>
        <div class="lab-modal-footer">
            <button class="lab-btn-batal" onclick="labBukaEdit(${labEditAsli.id}, true)"><i class="fa-solid fa-arrow-left"></i> Kembali</button>
            <button class="lab-btn-simpan" id="labBtnKonfirmEdit" onclick="labEditSimpan()"><i class="fa-solid fa-check"></i> Konfirmasi &amp; Simpan</button>
        </div>`;
}

async function labEditSimpan() {
    if (!labEditBaru || !labEditAsli) return;
    const baru = { ...labEditBaru };
    const j = labHitungJadwal(baru.diagnosa, baru.tanggal_lab);
    baru.next_3bln = j.next3;
    baru.next_6bln = j.next6;

    const btn = document.getElementById('labBtnKonfirmEdit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';

    const { error } = await db.from(LAB_TABLE).update(baru).eq('id', labEditAsli.id);
    if (error) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Konfirmasi &amp; Simpan';
        alert('Gagal menyimpan: ' + error.message);
        return;
    }
    labTutupModal();
    await loadLabRutin(true);
}

function labTutupModal() {
    document.getElementById('labModal').classList.remove('show');
    labEditAsli = null;
    labEditBaru = null;
}

/* ============================================================
   EXPORT EXCEL (pakai helper dashboard bila ada)
   ============================================================ */
function labKeExcel(rows, namaFile) {
    if (typeof exportToXlsx === 'function') { exportToXlsx(rows, namaFile); return; }
    if (typeof XLSX === 'undefined') { alert('Library Excel belum termuat.'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, namaFile + '.xlsx');
}

/* ============================================================
   INISIALISASI
   ============================================================ */
labInitPanel();

// Dukungan tautan langsung: dashboard.html#lab_rutin
if (location.hash === '#lab_rutin' && document.getElementById('panel-lab_rutin')) {
    try {
        if (typeof showPanel === 'function') showPanel('lab_rutin');
        loadLabRutin(true);
    } catch (e) { console.warn('[Lab Rutin] Gagal membuka panel dari hash:', e); }
}
