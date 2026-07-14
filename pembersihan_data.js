/* ============================================================
   PEMBERSIHAN DATA — Logika halaman
   Klinik Imanuel · pembersihan_data.html
   ------------------------------------------------------------
   Mengumpulkan variasi penulisan dokter/diagnosis pada data
   kunjungan lama, menyarankan padanan baku dari master, lalu
   menerapkan perubahan massal. Selalu bisa unduh cadangan dulu.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://xbvnydbglqyqnhwddjvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhidm55ZGJnbHF5cW5od2RkanZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQwNTMsImV4cCI6MjA5NjMxMDA1M30.QRjVy7TSJi7vOeF3sZzsk1JSD0mg2NMhwBMlO4YrOv0';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Konfigurasi tiap target pembersihan
const TARGET = {
    dokter_pu: { tabel: 'poli_umum', mode: 'tunggal', kolom: ['nama_dokter'],       jenis: 'dokter',    poli: 'Umum' },
    dokter_pg: { tabel: 'poli_gigi', mode: 'tunggal', kolom: ['nama_dokter_gigi'],  jenis: 'dokter',    poli: 'Gigi' },
    diag_pu:   { tabel: 'poli_umum', mode: 'gabung',  kolom: ['diagnosis'],          jenis: 'diagnosis' },
    diag_pg:   { tabel: 'poli_gigi', mode: 'multi',   kolom: ['diagnosa1','diagnosa2','diagnosa3','diagnosa4','diagnosa5'], jenis: 'diagnosis' }
};

let masterSiap = false;
let konfigAktif = null;
let barisData = [];     // baris mentah dari tabel (untuk cadangan & update)
let varian = [];        // hasil analisis: { nilai, jumlah, saran, status }

/* ── Init master ───────────────────────────────────────── */
async function siapkanMaster() {
    if (masterSiap) return;
    await MasterLookup.init(db);
    masterSiap = true;
}

/* ── Ambil semua baris (paginasi) ──────────────────────── */
async function ambilSemua(tabel, kolomSelect) {
    let semua = [];
    let dari = 0;
    const langkah = 1000;
    while (true) {
        const { data, error } = await db.from(tabel)
            .select(kolomSelect)
            .range(dari, dari + langkah - 1);
        if (error) { alert('Gagal memuat data: ' + error.message); break; }
        if (!data || data.length === 0) break;
        semua = semua.concat(data);
        if (data.length < langkah) break;
        dari += langkah;
    }
    return semua;
}

/* ── Kumpulkan varian penulisan ────────────────────────── */
function kumpulkanVarian() {
    const k = konfigAktif;
    const peta = new Map();  // nilai asli -> jumlah kemunculan

    const catat = (nilai) => {
        const v = String(nilai || '').trim();
        if (!v) return;
        peta.set(v, (peta.get(v) || 0) + 1);
    };

    barisData.forEach(row => {
        if (k.mode === 'gabung') {
            // satu kolom berisi banyak diagnosis dipisah koma
            String(row[k.kolom[0]] || '').split(',').forEach(catat);
        } else if (k.mode === 'multi') {
            k.kolom.forEach(col => catat(row[col]));
        } else {
            catat(row[k.kolom[0]]);
        }
    });

    varian = Array.from(peta.entries()).map(([nilai, jumlah]) => {
        let saran = '';
        if (k.jenis === 'diagnosis') {
            const c = MasterLookup.cariKanonikDiagnosis(nilai);
            if (c) saran = MasterLookup.labelDiagnosis(c);
        } else {
            const c = MasterLookup.cariKanonikDokter(nilai);
            if (c) saran = c.nama;
        }
        let status;
        if (saran && saran === nilai) status = 'baku';
        else if (saran) status = 'saran';
        else status = 'manual';
        return { nilai: nilai, jumlah: jumlah, saran: saran, status: status };
    }).sort((a, b) => b.jumlah - a.jumlah);
}

/* ── Muat target ───────────────────────────────────────── */
async function muatTarget() {
    const key = document.getElementById('target').value;
    if (!key) { alert('Pilih dulu data yang akan dibersihkan.'); return; }
    konfigAktif = TARGET[key];

    const btn = document.getElementById('btnMuat');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat...';

    try {
        await siapkanMaster();
        const kolomSelect = konfigAktif.mode === 'multi'
            ? ['id'].concat(konfigAktif.kolom).join(',')
            : ('id,' + konfigAktif.kolom[0]);
        barisData = await ambilSemua(konfigAktif.tabel, kolomSelect);
        kumpulkanVarian();
        renderRingkas();
        renderTabel();
        document.getElementById('btnCadangan').disabled = barisData.length === 0;
        document.getElementById('aksiBawah').classList.toggle('show', varian.length > 0);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Muat &amp; Analisis';
    }
}

/* ── Render ringkasan ──────────────────────────────────── */
function renderRingkas() {
    const el = document.getElementById('ringkas');
    const totalBaris = barisData.length;
    const unik = varian.length;
    const baku = varian.filter(v => v.status === 'baku').length;
    const perlu = varian.filter(v => v.status !== 'baku').length;
    el.innerHTML =
        '<div class="rpill">Baris data: <b>' + totalBaris + '</b></div>' +
        '<div class="rpill">Nilai unik: <b>' + unik + '</b></div>' +
        '<div class="rpill ok">Sudah baku: <b>' + baku + '</b></div>' +
        '<div class="rpill warn">Perlu dipetakan: <b>' + perlu + '</b></div>';
    el.classList.add('show');
}

/* ── Render tabel ──────────────────────────────────────── */
function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

function statBadge(status) {
    if (status === 'baku') return '<span class="stat stat-baku">Sudah baku</span>';
    if (status === 'saran') return '<span class="stat stat-saran">Ada saran</span>';
    return '<span class="stat stat-manual">Perlu dipilih</span>';
}

function renderTabel() {
    const isi = document.getElementById('isi');
    const kosong = document.getElementById('kosong');
    const bungkus = document.getElementById('tabelBungkus');
    bungkus.classList.add('show');

    if (!varian.length) {
        isi.innerHTML = '';
        isi.parentElement.style.display = 'none';
        kosong.style.display = 'block';
        return;
    }
    isi.parentElement.style.display = '';
    kosong.style.display = 'none';

    const isDiag = konfigAktif.jenis === 'diagnosis';
    isi.innerHTML = varian.map((v, i) => {
        const bakuKelas = v.status === 'baku' ? ' class="baris-baku"' : '';
        let kolPeta;
        if (isDiag) {
            kolPeta = '<input type="text" id="peta_' + i + '" value="' + escAttr(v.saran) + '" placeholder="Ketik diagnosis baku...">';
        } else {
            const opsi = MasterLookup.getDokter()
                .filter(d => !konfigAktif.poli || d.poli === konfigAktif.poli)
                .map(d => '<option value="' + escAttr(d.nama) + '"' + (d.nama === v.saran ? ' selected' : '') + '>' + escHtml(d.nama) + '</option>')
                .join('');
            kolPeta = '<select id="peta_' + i + '"><option value="">— jangan ubah —</option>' + opsi + '</select>';
        }
        return '<tr' + bakuKelas + '>' +
            '<td><span class="nilai-lama">' + escHtml(v.nilai) + '</span></td>' +
            '<td><span class="jumlah-badge">' + v.jumlah + '×</span></td>' +
            '<td>' + statBadge(v.status) + '</td>' +
            '<td class="kol-peta">' + kolPeta + '</td>' +
            '</tr>';
    }).join('');

    // Autocomplete untuk kolom diagnosis (boleh menambah entri baru berstatus review)
    if (isDiag) {
        varian.forEach((v, i) => MasterLookup.pasangDiagnosisAutocomplete('peta_' + i));
    }
}

/* ── Unduh cadangan ────────────────────────────────────── */
function unduhCadangan() {
    if (!barisData.length) { alert('Belum ada data untuk dicadangkan.'); return; }
    const isi = JSON.stringify(barisData, null, 2);
    const blob = new Blob([isi], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const tgl = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = 'cadangan_' + konfigAktif.tabel + '_' + konfigAktif.kolom.join('-') + '_' + tgl + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* ── Jalankan update berkelompok (batasi paralelisme) ──── */
async function jalankanKelompok(tugas, ukuran) {
    let selesai = 0, gagal = 0;
    const progres = document.getElementById('progres');
    for (let i = 0; i < tugas.length; i += ukuran) {
        const bagian = tugas.slice(i, i + ukuran);
        const hasil = await Promise.all(bagian.map(fn => fn().catch(() => ({ __gagal: true }))));
        hasil.forEach(r => { if (r && r.__gagal) gagal++; else selesai++; });
        progres.textContent = 'Memproses ' + Math.min(i + ukuran, tugas.length) + ' / ' + tugas.length + '...';
    }
    return { selesai: selesai, gagal: gagal };
}

/* ── Terapkan perubahan ────────────────────────────────── */
async function terapkan() {
    const k = konfigAktif;
    // Bangun peta: nilai lama -> nilai baru (hanya yang benar-benar berubah)
    const peta = new Map();
    varian.forEach((v, i) => {
        const el = document.getElementById('peta_' + i);
        if (!el) return;
        const baru = String(el.value || '').trim();
        if (baru && baru !== v.nilai) peta.set(v.nilai, baru);
    });

    if (peta.size === 0) { alert('Tidak ada perubahan untuk diterapkan.'); return; }

    const ok = confirm('Terapkan ' + peta.size + ' pemetaan ke tabel "' + k.tabel + '"?\n\n' +
        'Perubahan bersifat permanen. Pastikan Anda sudah mengunduh cadangan.');
    if (!ok) return;

    const btn = document.getElementById('btnTerap');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';

    try {
        let ringkas;
        if (k.mode === 'tunggal' || k.mode === 'multi') {
            // Update per (nilai lama, kolom): set kolom = nilai baru di mana kolom = nilai lama
            const tugas = [];
            peta.forEach((baru, lama) => {
                k.kolom.forEach(col => {
                    tugas.push(async () => {
                        const { data, error } = await db.from(k.tabel)
                            .update({ [col]: baru })
                            .eq(col, lama)
                            .select('id');
                        if (error) throw error;
                        return { n: (data || []).length };
                    });
                });
            });
            ringkas = await jalankanKelompok(tugas, 12);
        } else {
            // mode 'gabung': satu kolom berisi daftar dipisah koma.
            // Ganti token per baris, tulis ulang hanya baris yang berubah.
            const col = k.kolom[0];
            const tugas = [];
            barisData.forEach(row => {
                const asli = String(row[col] || '');
                const token = asli.split(',').map(s => s.trim()).filter(Boolean);
                let berubah = false;
                const baru = token.map(t => {
                    const g = peta.get(t);
                    if (g && g !== t) { berubah = true; return g; }
                    return t;
                });
                if (!berubah) return;
                const nilaiBaru = baru.join(', ');
                tugas.push(async () => {
                    const { error } = await db.from(k.tabel)
                        .update({ [col]: nilaiBaru })
                        .eq('id', row.id);
                    if (error) throw error;
                    return { n: 1 };
                });
            });
            ringkas = await jalankanKelompok(tugas, 12);
        }

        document.getElementById('progres').textContent = '';
        alert('Selesai.\nBerhasil diproses: ' + ringkas.selesai + '\nGagal: ' + ringkas.gagal +
            '\n\nData akan dimuat ulang untuk verifikasi.');
        await muatTarget();
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Terapkan Perubahan';
    }
}
