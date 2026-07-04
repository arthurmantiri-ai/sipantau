/* ============================================================
   INPUT LAB RUTIN — KLINIK IMANUEL (logika halaman input)
   Butuh: lab_core.js (dimuat lebih dulu)
   Tabel Supabase: lab_rutin
   ============================================================ */

// --- KONFIGURASI SUPABASE ---
const SUPABASE_URL = 'https://xbvnydbglqyqnhwddjvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhidm55ZGJnbHF5cW5od2RkanZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQwNTMsImV4cCI6MjA5NjMxMDA1M30.QRjVy7TSJi7vOeF3sZzsk1JSD0mg2NMhwBMlO4YrOv0';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- STATE ---
let semuaData = [];              // seluruh isi tabel lab_rutin
let petaPasien = new Map();      // hasil labKelompokkan(semuaData)
let batchRows = [];              // baris tabel input batch

// --- ELEMEN SERING DIPAKAI ---
const elNama = document.getElementById('nama_pasien');
const elBpjs = document.getElementById('no_bpjs');
const elTelp = document.getElementById('no_telp');
const elLab = document.getElementById('lab_pemeriksa');
const elDiag = document.getElementById('diagnosa');
const elTgl = document.getElementById('tanggal_lab');

/* ============================================================
   INISIALISASI
   ============================================================ */
init();
async function init() {
    elTgl.value = labTodayStr();
    document.getElementById('batch_tanggal').value = labTodayStr();
    document.getElementById('batch_bulan').value = labMonthNow();
    updateAutoJadwal();

    // Tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });

    // Form satuan
    elDiag.addEventListener('change', updateAutoJadwal);
    elTgl.addEventListener('change', updateAutoJadwal);
    elNama.addEventListener('change', () => prefillDariPasienLama('nama'));
    elBpjs.addEventListener('change', () => prefillDariPasienLama('bpjs'));
    document.getElementById('formLab').addEventListener('submit', simpanSatuan);

    // Batch
    document.getElementById('btnMuatTerjadwal').addEventListener('click', muatPasienTerjadwal);
    document.getElementById('btnTambahBaris').addEventListener('click', tambahBarisManual);
    document.getElementById('btnSimpanBatch').addEventListener('click', simpanBatch);
    document.getElementById('cekSemua').addEventListener('change', e => {
        batchRows.forEach(r => { if (!r.kunciPilih) r.pilih = e.target.checked; });
        renderBatch();
    });

    await muatData();
}

async function muatData() {
    try {
        semuaData = await labAmbilSemua(db);
        petaPasien = labKelompokkan(semuaData);
        isiDatalist();
    } catch (err) {
        alert('Gagal memuat data lab dari server: ' + err.message +
            '\nPastikan tabel "lab_rutin" sudah dibuat (jalankan supabase_patch_lab_rutin.sql).');
    }
}

function isiDatalist() {
    const dlNama = document.getElementById('dlNama');
    const dlBpjs = document.getElementById('dlBpjs');
    const dlLab = document.getElementById('dlLab');
    const namaSet = new Map(); // nama tampil -> bpjs (untuk label)
    const bpjsSet = new Set();
    const labSet = new Set();

    for (const p of petaPasien.values()) {
        const t = p.latest;
        if (t.nama_pasien) namaSet.set(t.nama_pasien, t.no_bpjs || '');
        if (t.no_bpjs) bpjsSet.add(t.no_bpjs);
    }
    for (const r of semuaData) if (r.lab_pemeriksa) labSet.add(r.lab_pemeriksa);

    dlNama.innerHTML = [...namaSet.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([n, b]) => `<option value="${labEsc(n)}"${b ? ` label="BPJS ${labEsc(b)}"` : ''}></option>`).join('');
    dlBpjs.innerHTML = [...bpjsSet].sort()
        .map(b => `<option value="${labEsc(b)}"></option>`).join('');
    dlLab.innerHTML = [...labSet].sort()
        .map(l => `<option value="${labEsc(l)}"></option>`).join('');
}

/* ============================================================
   FORM SATUAN
   ============================================================ */
function updateAutoJadwal() {
    const j = labHitungJadwal(elDiag.value, elTgl.value);
    const el3 = document.getElementById('next3_tampil');
    const el6 = document.getElementById('next6_tampil');
    const g3 = document.getElementById('grup3');
    const g6 = document.getElementById('grup6');

    if (j.next3) { el3.value = labFmtTglPanjang(j.next3); el3.dataset.iso = j.next3; g3.classList.add('aktif'); }
    else {
        el3.dataset.iso = '';
        el3.value = elDiag.value === 'HPT' ? 'Tidak ada (hanya untuk DM / HPT+DM)' : '';
        g3.classList.remove('aktif');
    }
    if (j.next6) { el6.value = labFmtTglPanjang(j.next6); el6.dataset.iso = j.next6; g6.classList.add('aktif'); }
    else { el6.value = ''; el6.dataset.iso = ''; g6.classList.remove('aktif'); }
}

function prefillDariPasienLama(sumber) {
    let profil = null;
    if (sumber === 'bpjs') {
        const cari = String(elBpjs.value || '').replace(/\D/g, '');
        if (!cari) return;
        profil = [...petaPasien.values()].find(p => String(p.latest.no_bpjs || '').replace(/\D/g, '') === cari);
    } else {
        const cari = String(elNama.value || '').trim().toLowerCase();
        if (!cari) return;
        profil = [...petaPasien.values()].find(p => String(p.latest.nama_pasien || '').trim().toLowerCase() === cari);
    }
    if (!profil) return;
    const t = profil.latest;
    elNama.value = t.nama_pasien || elNama.value;
    if (t.no_bpjs) elBpjs.value = t.no_bpjs;
    if (t.no_telp) elTelp.value = t.no_telp;
    if (t.lab_pemeriksa && !elLab.value) elLab.value = t.lab_pemeriksa;
    if (t.diagnosa) { elDiag.value = t.diagnosa; updateAutoJadwal(); }
}

function cariKunci(nama, bpjs) {
    return labKunciPasien({ nama_pasien: nama, no_bpjs: bpjs });
}

function sudahAdaPadaTanggal(nama, bpjs, tanggal) {
    const kunci = cariKunci(nama, bpjs);
    return semuaData.some(r => labKunciPasien(r) === kunci && r.tanggal_lab === tanggal);
}

async function simpanSatuan(e) {
    e.preventDefault();
    const nama = elNama.value.trim();
    const bpjs = elBpjs.value.trim();
    const telp = elTelp.value.trim();
    const lab = elLab.value.trim();
    const diagnosa = elDiag.value;
    const tanggal = elTgl.value;

    if (!nama || !lab || !diagnosa || !tanggal) { alert('Mohon lengkapi kolom bertanda *.'); return; }
    if (!telp && !confirm('Nomor telp/WA kosong.\nTanpa nomor, fitur pengingat WhatsApp tidak bisa dipakai untuk pasien ini.\n\nTetap simpan?')) return;
    if (sudahAdaPadaTanggal(nama, bpjs, tanggal) &&
        !confirm(`Pasien ini sudah tercatat periksa lab pada ${labFmtTgl(tanggal)}.\nSimpan lagi sebagai data baru?`)) return;

    const j = labHitungJadwal(diagnosa, tanggal);
    const payload = {
        nama_pasien: nama,
        no_bpjs: bpjs || null,
        no_telp: telp || null,
        lab_pemeriksa: lab,
        diagnosa,
        tanggal_lab: tanggal,
        next_3bln: j.next3,
        next_6bln: j.next6,
        catatan: document.getElementById('catatan').value.trim() || null
    };

    const btn = document.getElementById('btnSimpanSatuan');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    const { error } = await db.from(LAB_TABLE).insert([payload]);
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Pemeriksaan';

    if (error) { alert('Gagal menyimpan: ' + error.message); return; }

    document.getElementById('hasilSatuan').innerHTML = `
        <div class="hasil-box">
            <h4><i class="fa-solid fa-circle-check"></i> Data tersimpan — ${labEsc(nama)} (${labEsc(diagnosa)})</h4>
            Pemeriksaan lab tanggal <strong>${labFmtTgl(tanggal)}</strong> di ${labEsc(lab)}.
            Jadwal berikutnya:<br>
            ${j.next3 ? `<span class="jadwal-chip"><i class="fa-solid fa-calendar-plus"></i> Kontrol 3 Bulan: ${labFmtTglPanjang(j.next3)}</span>` : ''}
            <span class="jadwal-chip"><i class="fa-solid fa-calendar-check"></i> Kontrol 6 Bulan: ${labFmtTglPanjang(j.next6)}</span>
        </div>`;

    // Kosongkan data pasien, pertahankan tanggal & lab untuk input beruntun
    elNama.value = ''; elBpjs.value = ''; elTelp.value = '';
    elDiag.value = ''; document.getElementById('catatan').value = '';
    updateAutoJadwal();
    elNama.focus();
    await muatData();
}

/* ============================================================
   INPUT BATCH (EVENT)
   ============================================================ */
function muatPasienTerjadwal() {
    const ym = document.getElementById('batch_bulan').value;
    if (!ym) { alert('Pilih bulan jadwal terlebih dahulu.'); return; }
    const tanggalEvent = document.getElementById('batch_tanggal').value;

    const jadwal = labJadwalMendatang(semuaData).filter(j => j.due.startsWith(ym));
    if (!jadwal.length) {
        alert(`Tidak ada pasien dengan jadwal lab pada ${labLabelBulan(ym)}.\n(Pasien yang sudah periksa lagi otomatis pindah ke jadwal berikutnya.)`);
        return;
    }

    let tambah = 0, lewati = 0;
    for (const j of jadwal) {
        if (batchRows.some(r => r.key && r.key === j.key)) { lewati++; continue; }
        const status = labStatusJadwal(j.due);
        const sudahDiTglEvent = tanggalEvent ? sudahAdaPadaTanggal(j.nama, j.no_bpjs, tanggalEvent) : false;
        batchRows.push({
            pilih: !sudahDiTglEvent,
            kunciPilih: sudahDiTglEvent,           // sudah diinput di tanggal event → jangan ikut tersimpan lagi
            sumber: 'jadwal',
            key: j.key,
            nama: j.nama,
            bpjs: j.no_bpjs,
            telp: j.no_telp,
            diagnosa: j.diagnosa,
            info: `${j.jenis} • jatuh tempo ${labFmtTgl(j.due)}` +
                  (status.kode === 'terlambat' ? ` <span class="tag-telat">(${status.label})</span>` : ''),
            sudahDiTglEvent
        });
        tambah++;
    }
    renderBatch();
    if (lewati) alert(`${tambah} pasien dimuat. ${lewati} pasien dilewati karena sudah ada di tabel.`);
}

function tambahBarisManual() {
    batchRows.push({ pilih: true, kunciPilih: false, sumber: 'manual', key: null, nama: '', bpjs: '', telp: '', diagnosa: '', info: '<em>Baris manual</em>', sudahDiTglEvent: false });
    renderBatch();
    const badan = document.getElementById('batchBody');
    const barisAkhir = badan.querySelector('tr:last-child input.cell-input');
    if (barisAkhir) barisAkhir.focus();
}

function ubahBatch(i, field, val) {
    if (!batchRows[i]) return;
    batchRows[i][field] = val;
    perbaruiFooterBatch();
    const tr = document.querySelector(`#batchBody tr[data-i="${i}"]`);
    if (tr) {
        const valid = barisValid(batchRows[i]);
        tr.classList.toggle('baris-invalid', batchRows[i].pilih && !valid);
        tr.querySelectorAll('.cell-nama').forEach(el => el.classList.toggle('invalid', !batchRows[i].nama.trim()));
        tr.querySelectorAll('.cell-diag').forEach(el => el.classList.toggle('invalid', !batchRows[i].diagnosa));
    }
}

function togglePilih(i, checked) {
    if (!batchRows[i]) return;
    batchRows[i].pilih = checked;
    const tr = document.querySelector(`#batchBody tr[data-i="${i}"]`);
    if (tr) {
        tr.classList.toggle('baris-nonaktif', !checked);
        tr.classList.toggle('baris-invalid', checked && !barisValid(batchRows[i]));
    }
    perbaruiFooterBatch();
}

function hapusBaris(i) {
    batchRows.splice(i, 1);
    renderBatch();
}

function barisValid(r) { return !!(r.nama.trim() && r.diagnosa); }

function renderBatch() {
    const badan = document.getElementById('batchBody');
    if (!batchRows.length) {
        badan.innerHTML = `<tr><td colspan="7" class="batch-kosong">
            <i class="fa-solid fa-users-viewfinder"></i>
            Muat pasien terjadwal per bulan, atau tambah baris manual.
        </td></tr>`;
        perbaruiFooterBatch();
        return;
    }
    badan.innerHTML = batchRows.map((r, i) => `
        <tr data-i="${i}" class="${!r.pilih ? 'baris-nonaktif' : (!barisValid(r) ? 'baris-invalid' : '')}">
            <td><input type="checkbox" ${r.pilih ? 'checked' : ''} onchange="togglePilih(${i}, this.checked)" title="Ikut disimpan"></td>
            <td><input class="cell-input cell-nama ${!r.nama.trim() ? 'invalid' : ''}" value="${labEsc(r.nama)}" placeholder="Nama pasien" oninput="ubahBatch(${i},'nama',this.value)" list="dlNama" onchange="prefillBarisBatch(${i})"></td>
            <td><input class="cell-input" value="${labEsc(r.bpjs)}" placeholder="No. BPJS" oninput="ubahBatch(${i},'bpjs',this.value)"></td>
            <td><input class="cell-input" value="${labEsc(r.telp)}" placeholder="08xx..." oninput="ubahBatch(${i},'telp',this.value)"></td>
            <td>
                <select class="cell-input cell-diag ${!r.diagnosa ? 'invalid' : ''}" onchange="ubahBatch(${i},'diagnosa',this.value)">
                    <option value="" ${!r.diagnosa ? 'selected' : ''} disabled>Pilih...</option>
                    ${LAB_DIAGNOSA_LIST.map(d => `<option value="${d}" ${r.diagnosa === d ? 'selected' : ''}>${d}</option>`).join('')}
                </select>
            </td>
            <td class="info-jadwal">${r.info}${r.sudahDiTglEvent ? ' <span class="tag-sudah">Sudah diinput tgl ini</span>' : ''}</td>
            <td><button type="button" class="btn-hapus-baris" onclick="hapusBaris(${i})" title="Buang baris"><i class="fa-solid fa-xmark"></i></button></td>
        </tr>`).join('');
    perbaruiFooterBatch();
}

function prefillBarisBatch(i) {
    const r = batchRows[i];
    if (!r || r.sumber !== 'manual') return;
    const cari = String(r.nama || '').trim().toLowerCase();
    if (!cari) return;
    const profil = [...petaPasien.values()].find(p => String(p.latest.nama_pasien || '').trim().toLowerCase() === cari);
    if (!profil) return;
    const t = profil.latest;
    r.bpjs = t.no_bpjs || r.bpjs;
    r.telp = t.no_telp || r.telp;
    r.diagnosa = t.diagnosa || r.diagnosa;
    r.key = profil.key;
    renderBatch();
}

function perbaruiFooterBatch() {
    const terpilih = batchRows.filter(r => r.pilih);
    const valid = terpilih.filter(barisValid);
    const info = document.getElementById('batchInfo');
    const btn = document.getElementById('btnSimpanBatch');
    if (!batchRows.length) {
        info.textContent = 'Belum ada baris.';
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Simpan Semua';
        return;
    }
    const invalid = terpilih.length - valid.length;
    info.innerHTML = `<strong>${valid.length}</strong> dari ${batchRows.length} baris siap disimpan` +
        (invalid ? ` — <span style="color:var(--danger);font-weight:600">${invalid} baris belum lengkap (nama/diagnosa)</span>` : '');
    btn.disabled = valid.length === 0;
    btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Simpan Semua (${valid.length})`;
}

async function simpanBatch() {
    const tanggal = document.getElementById('batch_tanggal').value;
    const lab = document.getElementById('batch_lab').value.trim();
    if (!tanggal) { alert('Isi Tanggal Pemeriksaan (Event) terlebih dahulu.'); return; }
    if (!lab) { alert('Isi Lab Pemeriksa terlebih dahulu.'); return; }

    const siap = batchRows.filter(r => r.pilih && barisValid(r));
    if (!siap.length) { alert('Tidak ada baris valid yang dipilih.'); return; }

    // Cegah data ganda: pasien yang sudah punya catatan pada tanggal event dilewati
    const payloads = [], dilewati = [];
    for (const r of siap) {
        if (sudahAdaPadaTanggal(r.nama, r.bpjs, tanggal)) { dilewati.push(r.nama); continue; }
        const j = labHitungJadwal(r.diagnosa, tanggal);
        payloads.push({
            nama_pasien: r.nama.trim(),
            no_bpjs: r.bpjs.trim() || null,
            no_telp: r.telp.trim() || null,
            lab_pemeriksa: lab,
            diagnosa: r.diagnosa,
            tanggal_lab: tanggal,
            next_3bln: j.next3,
            next_6bln: j.next6,
            catatan: 'Input batch (event)'
        });
    }
    if (!payloads.length) {
        alert('Semua pasien terpilih sudah memiliki data pada tanggal tersebut. Tidak ada yang disimpan.');
        return;
    }

    const tanpaTelp = payloads.filter(p => !p.no_telp).length;
    let pesan = `Simpan ${payloads.length} data pemeriksaan lab dengan tanggal ${labFmtTglPanjang(tanggal)}?\n` +
        `Jadwal kontrol 3 & 6 bulan tiap pasien akan dihitung otomatis.`;
    if (dilewati.length) pesan += `\n\n${dilewati.length} pasien dilewati (sudah ada data di tanggal ini): ${dilewati.join(', ')}`;
    if (tanpaTelp) pesan += `\n\nCatatan: ${tanpaTelp} pasien tanpa no. telp (pengingat WA tidak tersedia).`;
    if (!confirm(pesan)) return;

    const btn = document.getElementById('btnSimpanBatch');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Menyimpan...';
    const { error } = await db.from(LAB_TABLE).insert(payloads);
    btn.disabled = false;

    if (error) {
        perbaruiFooterBatch();
        alert('Gagal menyimpan: ' + error.message);
        return;
    }

    document.getElementById('hasilBatch').innerHTML = `
        <div class="hasil-box">
            <h4><i class="fa-solid fa-circle-check"></i> ${payloads.length} data pemeriksaan tersimpan — ${labFmtTgl(tanggal)} (${labEsc(lab)})</h4>
            <ul>${payloads.map(p => `<li><strong>${labEsc(p.nama_pasien)}</strong> (${labEsc(p.diagnosa)}) —
                ${p.next_3bln ? `3 bln: ${labFmtTgl(p.next_3bln)}, ` : ''}6 bln: ${labFmtTgl(p.next_6bln)}</li>`).join('')}
            </ul>
            ${dilewati.length ? `<p style="margin-top:8px;color:var(--warn)"><i class="fa-solid fa-triangle-exclamation"></i> Dilewati (sudah ada): ${labEsc(dilewati.join(', '))}</p>` : ''}
        </div>`;

    batchRows = [];
    renderBatch();
    await muatData();
}

// Render awal tabel batch (keadaan kosong)
renderBatch();
