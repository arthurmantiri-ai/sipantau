/* ============================================================
   MASTER DATA — Logika halaman admin
   Klinik Imanuel · master_data.html
   ------------------------------------------------------------
   Mengelola tabel master_dokter & master_diagnosis:
   tambah, edit, setujui (review -> approved), nonaktif/aktif,
   dan hapus. Data kunjungan lama tidak ikut berubah.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://xbvnydbglqyqnhwddjvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhidm55ZGJnbHF5cW5od2RkanZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQwNTMsImV4cCI6MjA5NjMxMDA1M30.QRjVy7TSJi7vOeF3sZzsk1JSD0mg2NMhwBMlO4YrOv0';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let tab = 'diagnosis';          // 'diagnosis' | 'dokter'
let dataDiagnosis = [];
let dataDokter = [];
let editId = null;

/* ── Util ──────────────────────────────────────────────── */
function norm(s) {
    return String(s || '').toLowerCase().replace(/[.,;:()\/\\\-_]/g, ' ').replace(/\s+/g, ' ').trim();
}
function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ── Muat data ─────────────────────────────────────────── */
async function muatSemua() {
    const [rd, rk] = await Promise.all([
        db.from('master_diagnosis').select('*').order('nama'),
        db.from('master_dokter').select('*').order('nama')
    ]);
    if (rd.error) { alert('Gagal memuat diagnosis: ' + rd.error.message); }
    if (rk.error) { alert('Gagal memuat dokter: ' + rk.error.message); }
    dataDiagnosis = rd.data || [];
    dataDokter = rk.data || [];
    perbaruiBadge();
    render();
}

function perbaruiBadge() {
    const nd = dataDiagnosis.filter(x => x.status === 'review' && x.aktif).length;
    const nk = dataDokter.filter(x => x.status === 'review' && x.aktif).length;
    const bd = document.getElementById('reviewDiag');
    const bk = document.getElementById('reviewDok');
    bd.textContent = nd; bd.classList.toggle('show', nd > 0);
    bk.textContent = nk; bk.classList.toggle('show', nk > 0);
}

/* ── Tab ───────────────────────────────────────────────── */
function gantiTab(t) {
    tab = t;
    document.getElementById('tabDiagBtn').classList.toggle('active', t === 'diagnosis');
    document.getElementById('tabDokBtn').classList.toggle('active', t === 'dokter');
    render();
}

/* ── Filter ────────────────────────────────────────────── */
function terfilter() {
    const sumber = tab === 'diagnosis' ? dataDiagnosis : dataDokter;
    const q = norm(document.getElementById('cari').value);
    const fs = document.getElementById('filterStatus').value;

    return sumber.filter(row => {
        // Status
        if (fs === 'nonaktif') { if (row.aktif) return false; }
        else if (fs === 'review') { if (!(row.status === 'review' && row.aktif)) return false; }
        else if (fs === 'approved') { if (!(row.status === 'approved' && row.aktif)) return false; }
        // Pencarian
        if (q) {
            const hay = [
                row.nama,
                row.kode_icd10 || '',
                (row.alias || []).join(' '),
                row.poli || ''
            ].map(norm).join(' ');
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    });
}

/* ── Render tabel ──────────────────────────────────────── */
function statPill(row) {
    if (!row.aktif) return '<span class="stat stat-off">Nonaktif</span>';
    if (row.status === 'review') return '<span class="stat stat-review">Perlu Review</span>';
    return '<span class="stat stat-approved">Disetujui</span>';
}

function tombolAksi(row) {
    let h = '<div class="aksi">';
    if (row.status === 'review' && row.aktif) {
        h += '<button class="btn-ic ok" title="Setujui" onclick="setujui(' + row.id + ')"><i class="fa-solid fa-check"></i></button>';
    }
    h += '<button class="btn-ic" title="Edit" onclick="bukaModal(' + row.id + ')"><i class="fa-solid fa-pen"></i></button>';
    h += '<button class="btn-ic" title="' + (row.aktif ? 'Nonaktifkan' : 'Aktifkan') + '" onclick="toggleAktif(' + row.id + ')">' +
         '<i class="fa-solid fa-' + (row.aktif ? 'eye-slash' : 'eye') + '"></i></button>';
    h += '<button class="btn-ic del" title="Hapus" onclick="hapus(' + row.id + ')"><i class="fa-solid fa-trash"></i></button>';
    h += '</div>';
    return h;
}

function render() {
    const kepala = document.getElementById('kepala');
    const isi = document.getElementById('isi');
    const kosong = document.getElementById('kosong');
    const baris = terfilter();

    if (tab === 'diagnosis') {
        kepala.innerHTML = '<th>Nama Diagnosis</th><th>Kode ICD-10</th><th>Status</th><th style="text-align:right;">Aksi</th>';
        isi.innerHTML = baris.map(row => {
            const alias = (row.alias && row.alias.length)
                ? '<div class="sel-alias">alias: ' + escHtml(row.alias.join(', ')) + '</div>' : '';
            const kode = row.kode_icd10
                ? '<span class="pill pill-kode">' + escHtml(row.kode_icd10) + '</span>'
                : '<span class="pill pill-none">—</span>';
            return '<tr>' +
                '<td><div class="sel-nama">' + escHtml(row.nama) + '</div>' + alias + '</td>' +
                '<td>' + kode + '</td>' +
                '<td>' + statPill(row) + '</td>' +
                '<td style="text-align:right;">' + tombolAksi(row) + '</td>' +
                '</tr>';
        }).join('');
    } else {
        kepala.innerHTML = '<th>Nama Dokter</th><th>Poli</th><th>Status</th><th style="text-align:right;">Aksi</th>';
        isi.innerHTML = baris.map(row =>
            '<tr>' +
            '<td><div class="sel-nama">' + escHtml(row.nama) + '</div></td>' +
            '<td>' + escHtml(row.poli || '-') + '</td>' +
            '<td>' + statPill(row) + '</td>' +
            '<td style="text-align:right;">' + tombolAksi(row) + '</td>' +
            '</tr>'
        ).join('');
    }

    const ada = baris.length > 0;
    isi.style.display = ada ? '' : 'none';
    kosong.style.display = ada ? 'none' : 'block';
}

/* ── Cari baris berdasarkan id di tab aktif ────────────── */
function cariRow(id) {
    const sumber = tab === 'diagnosis' ? dataDiagnosis : dataDokter;
    return sumber.find(r => r.id === id);
}

/* ── Modal tambah / edit ───────────────────────────────── */
function bukaModal(id) {
    editId = id;
    const isDiag = tab === 'diagnosis';
    document.getElementById('g_kode').style.display = isDiag ? '' : 'none';
    document.getElementById('g_alias').style.display = isDiag ? '' : 'none';
    document.getElementById('g_poli').style.display = isDiag ? 'none' : '';

    const judul = document.getElementById('modalJudul');
    const row = id != null ? cariRow(id) : null;

    if (row) {
        judul.textContent = isDiag ? 'Edit Diagnosis' : 'Edit Dokter';
        document.getElementById('f_nama').value = row.nama || '';
        document.getElementById('f_kode').value = row.kode_icd10 || '';
        document.getElementById('f_alias').value = (row.alias || []).join(', ');
        document.getElementById('f_poli').value = row.poli || 'Umum';
        document.getElementById('f_status').value = row.status || 'approved';
    } else {
        judul.textContent = isDiag ? 'Tambah Diagnosis' : 'Tambah Dokter';
        document.getElementById('f_nama').value = '';
        document.getElementById('f_kode').value = '';
        document.getElementById('f_alias').value = '';
        document.getElementById('f_poli').value = 'Umum';
        document.getElementById('f_status').value = 'approved';
    }
    document.getElementById('modalForm').classList.add('show');
    setTimeout(() => document.getElementById('f_nama').focus(), 50);
}

function tutupModal() {
    document.getElementById('modalForm').classList.remove('show');
    editId = null;
}

async function simpan() {
    const isDiag = tab === 'diagnosis';
    const nama = MasterLookup.rapikan(document.getElementById('f_nama').value);
    if (!nama) { alert('Nama wajib diisi.'); return; }
    const status = document.getElementById('f_status').value;

    let payload, tabel;
    if (isDiag) {
        const kode = document.getElementById('f_kode').value.trim().toUpperCase() || null;
        const alias = document.getElementById('f_alias').value
            .split(',').map(s => s.trim()).filter(Boolean);
        payload = { nama: nama, kode_icd10: kode, alias: alias, status: status };
        tabel = 'master_diagnosis';
    } else {
        payload = { nama: nama, poli: document.getElementById('f_poli').value, status: status };
        tabel = 'master_dokter';
    }

    let res;
    if (editId != null) {
        res = await db.from(tabel).update(payload).eq('id', editId);
    } else {
        res = await db.from(tabel).insert([payload]);
    }
    if (res.error) {
        if (res.error.code === '23505') alert('Nama "' + nama + '" sudah terdaftar.');
        else alert('Gagal menyimpan: ' + res.error.message);
        return;
    }
    tutupModal();
    await muatSemua();
}

/* ── Aksi baris ────────────────────────────────────────── */
async function setujui(id) {
    const tabel = tab === 'diagnosis' ? 'master_diagnosis' : 'master_dokter';
    const { error } = await db.from(tabel).update({ status: 'approved' }).eq('id', id);
    if (error) { alert('Gagal menyetujui: ' + error.message); return; }
    await muatSemua();
}

async function toggleAktif(id) {
    const row = cariRow(id);
    if (!row) return;
    const tabel = tab === 'diagnosis' ? 'master_diagnosis' : 'master_dokter';
    const { error } = await db.from(tabel).update({ aktif: !row.aktif }).eq('id', id);
    if (error) { alert('Gagal mengubah status aktif: ' + error.message); return; }
    await muatSemua();
}

async function hapus(id) {
    const row = cariRow(id);
    if (!row) return;
    const ok = confirm('Hapus "' + row.nama + '" dari master?\n\n' +
        'Data kunjungan lama yang sudah tersimpan TIDAK ikut berubah. ' +
        'Bila hanya ingin menyembunyikan dari pilihan, gunakan Nonaktifkan.');
    if (!ok) return;
    const tabel = tab === 'diagnosis' ? 'master_diagnosis' : 'master_dokter';
    const { error } = await db.from(tabel).delete().eq('id', id);
    if (error) { alert('Gagal menghapus: ' + error.message); return; }
    await muatSemua();
}

/* ── Init ──────────────────────────────────────────────── */
document.getElementById('cari').addEventListener('input', render);
document.getElementById('filterStatus').addEventListener('change', render);
document.getElementById('modalForm').addEventListener('mousedown', function (e) {
    if (e.target === this) tutupModal();
});
muatSemua();
