/* ============================================================
   PEMBERSIHAN DATA — Logika halaman
   Klinik Imanuel · pembersihan_data.html
   ------------------------------------------------------------
   Mengumpulkan variasi penulisan dokter/diagnosis pada data
   kunjungan lama, menyarankan padanan baku dari master, lalu
   menerapkan perubahan massal. Selalu bisa unduh cadangan dulu.

   REVISI (perbaikan gagal-diam):
   - Update dilakukan per ID BARIS, bukan lagi .eq(kolom, nilaiLama).
     Nilai dengan spasi ekstra / spasi ganda tetap kena.
   - Varian dikelompokkan per kunci ternormalisasi, jadi
     "dr. Andi ", "dr.  Andi", "DR. ANDI" jadi satu baris tabel.
   - Laporan menghitung BARIS yang benar-benar berubah, bukan
     jumlah permintaan. Kalau 0 baris kena, langsung diperingatkan.
   - Ada uji izin tulis (deteksi RLS) sebelum apa pun ditulis.
   - Pemetaan berantai (A->B, B->C) diselesaikan sekali jalan,
     tidak bisa saling menimpa.
   - Dropdown dokter menampilkan seluruh master + opsi ketik manual.
   - Ada Pratinjau (tanpa menulis) dan Pulihkan Cadangan.
   ============================================================ */
'use strict';

const SUPABASE_URL = 'https://xbvnydbglqyqnhwddjvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhidm55ZGJnbHF5cW5od2RkanZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQwNTMsImV4cCI6MjA5NjMxMDA1M30.QRjVy7TSJi7vOeF3sZzsk1JSD0mg2NMhwBMlO4YrOv0';
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Konfigurasi tiap target pembersihan
const TARGET = {
    dokter_pu: { tabel: 'poli_umum', mode: 'tunggal', kolom: ['nama_dokter'],       jenis: 'dokter',    poli: 'Umum' },
    dokter_pg: { tabel: 'poli_gigi', mode: 'tunggal', kolom: ['nama_dokter_gigi'],  jenis: 'dokter',    poli: 'Gigi' },
    diag_pu:   { tabel: 'poli_umum', mode: 'gabung',  kolom: ['diagnosis'],         jenis: 'diagnosis' },
    diag_pg:   { tabel: 'poli_gigi', mode: 'multi',   kolom: ['diagnosa1','diagnosa2','diagnosa3','diagnosa4','diagnosa5'], jenis: 'diagnosis' }
};

const UKURAN_HALAMAN = 1000;   // paginasi baca
const UKURAN_BATCH   = 100;    // jumlah id per permintaan update
const PARALEL        = 6;      // permintaan update serentak

let masterSiap   = false;
let konfigAktif  = null;
let barisData    = [];   // baris mentah dari tabel (untuk cadangan & update)
let varian       = [];   // { kunci, nilai, ragam, jumlah, saran, status, sasaran[] }
let barisKosong  = 0;    // baris yang kolom targetnya kosong/NULL
let modeManual   = {};   // index varian -> true bila barisnya diketik bebas
let pilihanNilai = {};   // index varian -> nilai yang sedang dipilih/diketik

/* ── Util teks ─────────────────────────────────────────── */
function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) { return escHtml(s).replace(/"/g, '&quot;'); }

// Kunci pengelompokan: samakan huruf besar/kecil, tanda baca, dan spasi.
// Dipakai HANYA untuk mengelompokkan varian — nilai asli tetap disimpan.
function kunciVarian(s) {
    return MasterLookup.norm(s);
}

// Bentuk tampil yang rapi untuk sebuah kelompok varian.
function rapatSpasi(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

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
    while (true) {
        const { data, error } = await db.from(tabel)
            .select(kolomSelect)
            .order('id', { ascending: true })
            .range(dari, dari + UKURAN_HALAMAN - 1);
        if (error) { alert('Gagal memuat data: ' + error.message); return null; }
        if (!data || data.length === 0) break;
        semua = semua.concat(data);
        if (data.length < UKURAN_HALAMAN) break;
        dari += UKURAN_HALAMAN;
    }
    return semua;
}

/* ── Pisah daftar diagnosis (mode 'gabung') ────────────────
   split(',') polos memecah nama yang memang mengandung koma,
   mis. "Diabetes mellitus, tipe 2 (E11)". Di sini potongan yang
   berdekatan dicoba disatukan dulu; kalau gabungannya dikenali
   master, diperlakukan sebagai satu diagnosis.                */
function pisahDaftar(teks) {
    const kasar = String(teks == null ? '' : teks).split(',').map(s => s.trim());
    const hasil = [];
    let i = 0;
    while (i < kasar.length) {
        let ambil = 1;
        let cocok = false;
        const sisa = kasar.length - i;
        for (let n = Math.min(3, sisa); n > 1; n--) {
            const potong = kasar.slice(i, i + n);
            // Semua potongan harus berisi. Kalau ada yang kosong (koma beruntun),
            // gabungannya tetap "cocok" di mata norm() karena koma dihapus —
            // itu pengenalan palsu, jadi ditolak di sini.
            if (potong.some(p => p === '')) continue;
            const gab = potong.join(', ').trim();
            if (MasterLookup.cariKanonikDiagnosis(gab)) {
                hasil.push(gab); ambil = n; cocok = true; break;
            }
        }
        if (!cocok) { if (kasar[i]) hasil.push(kasar[i]); ambil = 1; }
        i += ambil;
    }
    return hasil;
}

/* ── Kumpulkan varian penulisan ────────────────────────── */
function kumpulkanVarian() {
    const k = konfigAktif;
    const peta = new Map();   // kunci -> { kunci, ragam:Map(raw->n), jumlah, sasaran[] }
    barisKosong = 0;
    modeManual = {};
    pilihanNilai = {};

    const catat = (raw, id, col) => {
        const asli = String(raw == null ? '' : raw);
        if (!asli.trim()) return false;
        const kunci = kunciVarian(asli);
        if (!kunci) return false;
        if (!peta.has(kunci)) peta.set(kunci, { kunci: kunci, ragam: new Map(), jumlah: 0, sasaran: [] });
        const g = peta.get(kunci);
        // Sengaja disimpan APA ADANYA (belum dipangkas) supaya spasi tersembunyi
        // terlihat di tabel dan tidak salah dicap "sudah baku".
        g.ragam.set(asli, (g.ragam.get(asli) || 0) + 1);
        g.jumlah++;
        g.sasaran.push({ id: id, col: col, asli: asli });
        return true;
    };

    barisData.forEach(row => {
        if (k.mode === 'gabung') {
            const col = k.kolom[0];
            const token = pisahDaftar(row[col]);
            if (!token.length) { barisKosong++; return; }
            token.forEach(t => catat(t, row.id, col));
        } else if (k.mode === 'multi') {
            let ada = false;
            k.kolom.forEach(col => { if (catat(row[col], row.id, col)) ada = true; });
            if (!ada) barisKosong++;
        } else {
            const col = k.kolom[0];
            if (!catat(row[col], row.id, col)) barisKosong++;
        }
    });

    varian = Array.from(peta.values()).map(g => {
        // bentuk mentah yang paling sering dipakai jadi wakil tampilan
        const ragam = Array.from(g.ragam.entries()).sort((a, b) => b[1] - a[1]);
        const nilai = rapatSpasi(ragam[0][0]);

        let saran = '';
        if (k.jenis === 'diagnosis') {
            const c = MasterLookup.cariKanonikDiagnosis(nilai);
            if (c) saran = MasterLookup.labelDiagnosis(c);
        } else {
            const c = MasterLookup.cariKanonikDokter(nilai);
            if (c) saran = c.nama;
        }

        // 'baku' hanya jika SEMUA bentuk mentahnya sudah persis sama dengan saran
        const semuaPersis = saran && ragam.every(r => r[0] === saran);
        let status;
        if (semuaPersis) status = 'baku';
        else if (saran) status = 'saran';
        else status = 'manual';

        return {
            kunci: g.kunci,
            nilai: nilai,
            ragam: ragam,            // [[raw, n], ...]
            jumlah: g.jumlah,
            saran: saran,
            status: status,
            sasaran: g.sasaran
        };
    }).sort((a, b) => b.jumlah - a.jumlah || a.nilai.localeCompare(b.nilai, 'id'));
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
        const kolomSelect = ['id'].concat(konfigAktif.kolom).join(',');
        const data = await ambilSemua(konfigAktif.tabel, kolomSelect);
        if (data === null) { barisData = []; varian = []; renderTabel(); return; }
        barisData = data;
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
    const bedaSpasi = varian.filter(v => v.ragam.length > 1).length;

    let html =
        '<div class="rpill">Baris data: <b>' + totalBaris + '</b></div>' +
        '<div class="rpill">Nilai unik: <b>' + unik + '</b></div>' +
        '<div class="rpill ok">Sudah baku: <b>' + baku + '</b></div>' +
        '<div class="rpill warn">Perlu dipetakan: <b>' + perlu + '</b></div>';
    if (bedaSpasi) html += '<div class="rpill warn">Beda spasi/huruf: <b>' + bedaSpasi + '</b></div>';
    if (barisKosong) html += '<div class="rpill">Baris kosong: <b>' + barisKosong + '</b></div>';
    el.innerHTML = html;
    el.classList.add('show');
}

/* ── Render tabel ──────────────────────────────────────── */
function statBadge(status) {
    if (status === 'baku') return '<span class="stat stat-baku">Sudah baku</span>';
    if (status === 'saran') return '<span class="stat stat-saran">Ada saran</span>';
    return '<span class="stat stat-manual">Perlu dipilih</span>';
}

// Nilai yang harus tampil di kolom "Ganti Menjadi" untuk varian ke-i.
function nilaiTerpilih(v, i) {
    return (pilihanNilai[i] !== undefined) ? pilihanNilai[i] : (v.saran || '');
}

function selDokter(v, i) {
    const terpilih = nilaiTerpilih(v, i);
    const semua = MasterLookup.getDokter();
    const poli = konfigAktif.poli;
    const sepoli = semua.filter(d => !poli || d.poli === poli);
    const lain = poli ? semua.filter(d => d.poli !== poli) : [];

    const opt = (d) => '<option value="' + escAttr(d.nama) + '"' +
        (d.nama === terpilih ? ' selected' : '') + '>' + escHtml(d.nama) +
        (d.status === 'review' ? ' (review)' : '') + '</option>';

    let html = '<select id="peta_' + i + '" onchange="pilihDokter(' + i + ', this)">';
    html += '<option value=""' + (terpilih ? '' : ' selected') + '>— jangan ubah —</option>';

    // Nilai terpilih yang tidak ada di master aktif (mis. master-nya nonaktif,
    // beda poli, atau hasil ketikan manual) tetap ditawarkan supaya tidak hilang.
    if (terpilih && !semua.some(d => d.nama === terpilih)) {
        html += '<option value="' + escAttr(terpilih) + '" selected>' + escHtml(terpilih) + ' (di luar master aktif)</option>';
    }
    if (sepoli.length) {
        html += '<optgroup label="Poli ' + escAttr(poli || '-') + '">' + sepoli.map(opt).join('') + '</optgroup>';
    }
    if (lain.length) {
        html += '<optgroup label="Poli lain">' + lain.map(opt).join('') + '</optgroup>';
    }
    html += '<option value="__manual__">&#9998; Ketik manual...</option>';
    html += '</select>';
    return html;
}

// Simpan seluruh pilihan yang sedang tampil, supaya render ulang tidak menghapusnya.
function simpanSemuaPilihan() {
    varian.forEach((v, i) => {
        const el = document.getElementById('peta_' + i);
        if (!el) return;
        const val = String(el.value || '');
        if (val === '__manual__') return;
        pilihanNilai[i] = val;
    });
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
            kolPeta = '<input type="text" id="peta_' + i + '" value="' + escAttr(nilaiTerpilih(v, i)) +
                      '" placeholder="Ketik diagnosis baku...">';
        } else if (modeManual[i]) {
            kolPeta = '<input type="text" id="peta_' + i + '" value="' + escAttr(nilaiTerpilih(v, i)) +
                      '" placeholder="Ketik nama dokter..." oninput="simpanPilihan(' + i + ', this.value)">';
        } else {
            kolPeta = selDokter(v, i);
        }

        // Tampilkan bentuk-bentuk mentah yang digabung, supaya jelas apa yang kena
        let detail = '';
        if (v.ragam.length > 1) {
            detail = '<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">' +
                v.ragam.map(r => escHtml(JSON.stringify(r[0])) + ' ×' + r[1]).join(' · ') + '</div>';
        }

        return '<tr' + bakuKelas + '>' +
            '<td><span class="nilai-lama">' + escHtml(v.nilai) + '</span>' + detail + '</td>' +
            '<td><span class="jumlah-badge">' + v.jumlah + '×</span></td>' +
            '<td>' + statBadge(v.status) + '</td>' +
            '<td class="kol-peta">' + kolPeta + '</td>' +
            '</tr>';
    }).join('');

    if (isDiag) {
        varian.forEach((v, i) => MasterLookup.pasangDiagnosisAutocomplete('peta_' + i));
    }
}

function pilihDokter(i, el) {
    if (el.value !== '__manual__') { pilihanNilai[i] = String(el.value || ''); return; }

    const v = varian[i] || {};
    const awal = v.saran || v.nilai || '';
    const ketik = prompt('Tulis nama dokter yang benar untuk "' + (v.nilai || '') + '":', awal);
    if (ketik === null || !ketik.trim()) { el.value = pilihanNilai[i] || ''; return; }

    simpanSemuaPilihan();          // jangan sampai pilihan baris lain ikut hilang
    modeManual[i] = true;
    pilihanNilai[i] = ketik.trim();
    renderTabel();
}

function simpanPilihan(i, val) { pilihanNilai[i] = String(val == null ? '' : val); }

/* ── Susun rencana perubahan (murni, tanpa menulis) ─────── */
function hitungRencana(ganti) {
    const k = konfigAktif;
    const perubahan = new Map();   // id -> { kolom: nilaiBaru }
    const perVarian = new Map();   // kunci -> jumlah sel yang berubah

    const tandai = (kunci) => perVarian.set(kunci, (perVarian.get(kunci) || 0) + 1);
    const setSel = (id, col, nilai) => {
        const cur = perubahan.get(id) || {};
        cur[col] = nilai;
        perubahan.set(id, cur);
    };

    if (k.mode === 'gabung') {
        const col = k.kolom[0];
        barisData.forEach(row => {
            const asli = String(row[col] == null ? '' : row[col]);
            const token = pisahDaftar(asli);
            if (!token.length) return;
            let berubah = false;
            const baru = token.map(t => {
                const g = ganti.get(kunciVarian(t));
                if (g && g !== t) { berubah = true; tandai(kunciVarian(t)); return g; }
                return t;
            });
            if (!berubah) return;
            setSel(row.id, col, baru.join(', '));
        });
    } else {
        varian.forEach(v => {
            const baru = ganti.get(v.kunci);
            if (!baru) return;
            v.sasaran.forEach(s => {
                if (s.asli === baru) return;   // sudah persis sama, tidak perlu ditulis
                setSel(s.id, s.col, baru);
                tandai(v.kunci);
            });
        });
    }
    return { perubahan: perubahan, perVarian: perVarian };
}

function bacaPemetaan() {
    const ganti = new Map();
    varian.forEach((v, i) => {
        const el = document.getElementById('peta_' + i);
        if (!el) return;
        let baru = String(el.value || '').trim();
        if (baru === '__manual__') baru = '';
        if (!baru) return;
        ganti.set(v.kunci, baru);
    });
    return ganti;
}

/* ── Kelompokkan jadi permintaan update per ID ──────────── */
function susunTugas(perubahan) {
    const kelompok = new Map();   // "kolom\0nilai" -> { col, nilai, ids[] }
    perubahan.forEach((kolMap, id) => {
        Object.keys(kolMap).forEach(col => {
            const kk = col + '\u0000' + kolMap[col];
            if (!kelompok.has(kk)) kelompok.set(kk, { col: col, nilai: kolMap[col], ids: [] });
            kelompok.get(kk).ids.push(id);
        });
    });

    const tugas = [];
    kelompok.forEach(g => {
        for (let i = 0; i < g.ids.length; i += UKURAN_BATCH) {
            const bagian = g.ids.slice(i, i + UKURAN_BATCH);
            tugas.push({ col: g.col, nilai: g.nilai, ids: bagian });
        }
    });
    return tugas;
}

/* ── Jalankan update (batasi paralelisme) ──────────────── */
async function jalankanTugas(tugas) {
    let diminta = 0, terkena = 0, gagal = 0;
    const pesanGagal = [];
    const progres = document.getElementById('progres');

    for (let i = 0; i < tugas.length; i += PARALEL) {
        const bagian = tugas.slice(i, i + PARALEL);
        const hasil = await Promise.all(bagian.map(async t => {
            try {
                const { data, error } = await db.from(konfigAktif.tabel)
                    .update({ [t.col]: t.nilai })
                    .in('id', t.ids)
                    .select('id');
                if (error) throw error;
                return { diminta: t.ids.length, terkena: (data || []).length };
            } catch (e) {
                return { diminta: t.ids.length, terkena: 0, pesan: (e && e.message) || String(e) };
            }
        }));
        hasil.forEach(r => {
            diminta += r.diminta;
            terkena += r.terkena;
            if (r.pesan) { gagal += r.diminta; if (pesanGagal.length < 3) pesanGagal.push(r.pesan); }
        });
        progres.textContent = 'Memproses ' + Math.min(i + PARALEL, tugas.length) + ' / ' + tugas.length + ' permintaan...';
    }
    return { diminta: diminta, terkena: terkena, gagal: gagal, pesanGagal: pesanGagal };
}

/* ── Uji izin tulis (deteksi RLS) ───────────────────────── */
async function cekIzinTulis() {
    const k = konfigAktif;
    const contoh = barisData.find(r => r && r.id != null);
    if (!contoh) return { ok: true };

    const col = k.kolom[0];
    const nilai = (contoh[col] === undefined) ? null : contoh[col];   // tulis balik nilai yang sama
    const { data, error } = await db.from(k.tabel)
        .update({ [col]: nilai })
        .eq('id', contoh.id)
        .select('id');

    if (error) return { ok: false, pesan: 'Database menolak permintaan: ' + error.message };
    if (!data || data.length === 0) {
        return {
            ok: false,
            pesan: 'Uji tulis tidak mengenai satu baris pun.\n\n' +
                   'Hampir pasti Row Level Security pada tabel "' + k.tabel + '" memblokir UPDATE ' +
                   '(policy SELECT ada, policy UPDATE tidak). Jalankan di SQL Editor Supabase:\n\n' +
                   'create policy "' + k.tabel + '_all" on public.' + k.tabel +
                   ' for all to anon, authenticated using (true) with check (true);'
        };
    }
    return { ok: true };
}

/* ── Pratinjau (tidak menulis apa pun) ──────────────────── */
function pratinjau() {
    if (!konfigAktif) { alert('Muat data dulu.'); return; }
    const ganti = bacaPemetaan();
    if (!ganti.size) { alert('Belum ada pemetaan yang dipilih.'); return; }

    const { perubahan, perVarian } = hitungRencana(ganti);
    if (!perubahan.size) {
        alert('Pemetaan terbaca, tetapi tidak ada baris yang perlu berubah.\n\n' +
              'Biasanya karena nilai tujuan sama persis dengan nilai yang sekarang. ' +
              'Kalau bentuk baku di Master Data masih salah tulis, perbaiki dulu di sana ' +
              'atau pakai opsi "Ketik manual".');
        return;
    }

    const rincian = [];
    varian.forEach(v => {
        const baru = ganti.get(v.kunci);
        const n = perVarian.get(v.kunci) || 0;
        if (baru && n) rincian.push('• ' + JSON.stringify(v.nilai) + '  →  ' + JSON.stringify(baru) + '   (' + n + ' sel)');
    });

    console.table(Array.from(perubahan.entries()).slice(0, 50).map(([id, kol]) => ({ id: id, ...kol })));
    alert('PRATINJAU — belum ada yang ditulis.\n\n' +
        'Tabel      : ' + konfigAktif.tabel + '\n' +
        'Baris kena : ' + perubahan.size + '\n\n' +
        rincian.slice(0, 25).join('\n') +
        (rincian.length > 25 ? '\n… dan ' + (rincian.length - 25) + ' pemetaan lain' : '') +
        '\n\n50 baris pertama dicetak ke Console (F12).');
}

/* ── Terapkan perubahan ────────────────────────────────── */
async function terapkan() {
    if (!konfigAktif) { alert('Muat data dulu.'); return; }
    const k = konfigAktif;

    const ganti = bacaPemetaan();
    if (!ganti.size) { alert('Tidak ada perubahan untuk diterapkan.'); return; }

    const { perubahan } = hitungRencana(ganti);
    if (!perubahan.size) {
        alert('Tidak ada baris yang perlu berubah.\n\n' +
              'Nilai tujuan sama persis dengan nilai sekarang. Kalau bentuk baku di ' +
              'Master Data masih salah tulis, perbaiki dulu di Master Data, ' +
              'atau pakai opsi "Ketik manual" pada kolom Ganti Menjadi.');
        return;
    }

    const ok = confirm('Terapkan ' + ganti.size + ' pemetaan pada ' + perubahan.size +
        ' baris tabel "' + k.tabel + '"?\n\n' +
        'Perubahan bersifat permanen. Pastikan Anda sudah mengunduh cadangan.');
    if (!ok) return;

    const btn = document.getElementById('btnTerap');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memproses...';
    const progres = document.getElementById('progres');

    try {
        progres.textContent = 'Memeriksa izin tulis...';
        const izin = await cekIzinTulis();
        if (!izin.ok) { alert('DIBATALKAN — tidak ada data yang diubah.\n\n' + izin.pesan); return; }

        const tugas = susunTugas(perubahan);
        const hasil = await jalankanTugas(tugas);

        let pesan = 'Selesai.\n\n' +
            'Sel diminta berubah : ' + hasil.diminta + '\n' +
            'Sel benar-benar berubah : ' + hasil.terkena + '\n' +
            'Permintaan gagal : ' + hasil.gagal;

        if (hasil.gagal) pesan += '\n\nContoh galat:\n- ' + hasil.pesanGagal.join('\n- ');
        if (!hasil.gagal && hasil.terkena < hasil.diminta) {
            pesan += '\n\nPERHATIAN: ada sel yang tidak tersentuh walau tidak ada galat. ' +
                     'Biasanya baris sudah diubah orang lain, atau policy RLS membatasi sebagian baris.';
        }
        if (hasil.terkena === 0) {
            pesan += '\n\nTIDAK ADA data yang berubah. Periksa policy RLS tabel "' + k.tabel + '".';
        }
        pesan += '\n\nData akan dimuat ulang untuk verifikasi.';

        progres.textContent = '';
        alert(pesan);
        await muatTarget();
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Terapkan Perubahan';
    }
}

/* ── Unduh cadangan ────────────────────────────────────── */
function unduhCadangan() {
    if (!barisData.length) { alert('Belum ada data untuk dicadangkan.'); return; }
    const bungkus = {
        _meta: {
            tabel: konfigAktif.tabel,
            kolom: konfigAktif.kolom,
            mode: konfigAktif.mode,
            waktu: new Date().toISOString(),
            jumlah: barisData.length
        },
        baris: barisData
    };
    const blob = new Blob([JSON.stringify(bungkus, null, 2)], { type: 'application/json' });
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

/* ── Pulihkan dari cadangan ────────────────────────────── */
function bacaCadangan(teks) {
    const j = JSON.parse(teks);
    const baris = Array.isArray(j) ? j : (j && j.baris);
    if (!Array.isArray(baris) || !baris.length) throw new Error('Isi cadangan kosong atau bukan format yang dikenal.');
    if (j && j._meta && j._meta.tabel && j._meta.tabel !== konfigAktif.tabel) {
        throw new Error('Cadangan ini milik tabel "' + j._meta.tabel + '", sedangkan target sekarang "' + konfigAktif.tabel + '".');
    }
    const perlu = konfigAktif.kolom;
    const contoh = baris[0];
    if (contoh.id === undefined) throw new Error('Cadangan tidak memuat kolom "id", tidak bisa dipulihkan.');
    const hilang = perlu.filter(c => contoh[c] === undefined);
    if (hilang.length === perlu.length) {
        throw new Error('Cadangan tidak memuat kolom ' + perlu.join('/') + '. Pilih target yang sesuai dulu.');
    }
    return baris;
}

async function pulihkanCadangan(file) {
    if (!konfigAktif) { alert('Pilih dan muat target dulu, supaya jelas tabel mana yang dipulihkan.'); return; }
    let baris;
    try {
        baris = bacaCadangan(await file.text());
    } catch (e) {
        alert('Cadangan tidak bisa dibaca:\n\n' + e.message);
        return;
    }

    const ok = confirm('PULIHKAN ' + baris.length + ' baris pada tabel "' + konfigAktif.tabel + '"?\n\n' +
        'Kolom ' + konfigAktif.kolom.join(', ') + ' akan dikembalikan ke isi cadangan. ' +
        'Perubahan setelah cadangan dibuat akan hilang.');
    if (!ok) return;

    const perubahan = new Map();
    baris.forEach(r => {
        if (r.id == null) return;
        const kol = {};
        konfigAktif.kolom.forEach(c => { if (r[c] !== undefined) kol[c] = r[c]; });
        if (Object.keys(kol).length) perubahan.set(r.id, kol);
    });

    const progres = document.getElementById('progres');
    try {
        progres.textContent = 'Memeriksa izin tulis...';
        const izin = await cekIzinTulis();
        if (!izin.ok) { alert('DIBATALKAN — tidak ada data yang diubah.\n\n' + izin.pesan); return; }

        const hasil = await jalankanTugas(susunTugas(perubahan));
        progres.textContent = '';
        alert('Pemulihan selesai.\n\nSel diminta: ' + hasil.diminta +
              '\nSel berubah: ' + hasil.terkena + '\nGagal: ' + hasil.gagal);
        await muatTarget();
    } finally {
        progres.textContent = '';
    }
}

/* ── Tombol tambahan (disuntik dari JS, HTML tidak diubah) ─ */
function pasangTombolTambahan() {
    const bar = document.querySelector('.toolbar');
    if (bar && !document.getElementById('btnPulih')) {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.id = 'fileCadangan'; inp.style.display = 'none';
        inp.addEventListener('change', function () {
            if (this.files && this.files[0]) pulihkanCadangan(this.files[0]);
            this.value = '';
        });

        const b = document.createElement('button');
        b.className = 'btn'; b.id = 'btnPulih'; b.type = 'button';
        b.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Pulihkan Cadangan';
        b.addEventListener('click', () => inp.click());

        bar.appendChild(b);
        bar.appendChild(inp);
    }

    const aksi = document.querySelector('.aksi-bawah');
    const terap = document.getElementById('btnTerap');
    if (aksi && terap && !document.getElementById('btnPratinjau')) {
        const grup = document.createElement('div');
        grup.style.display = 'flex';
        grup.style.gap = '10px';
        grup.style.flexWrap = 'wrap';

        const p = document.createElement('button');
        p.className = 'btn'; p.id = 'btnPratinjau'; p.type = 'button';
        p.innerHTML = '<i class="fa-solid fa-eye"></i> Pratinjau';
        p.addEventListener('click', pratinjau);

        aksi.insertBefore(grup, terap);
        grup.appendChild(p);
        grup.appendChild(terap);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pasangTombolTambahan);
} else {
    pasangTombolTambahan();
}

/* ── Ekspor untuk pengujian (Node) ─────────────────────── */
if (typeof window === 'undefined' && typeof module !== 'undefined' && module.exports) {
    module.exports = {
        pisahDaftar, hitungRencana, susunTugas, kunciVarian, rapatSpasi, bacaCadangan,
        _uji: {
            set: (s) => {
                if (s.konfigAktif !== undefined) konfigAktif = s.konfigAktif;
                if (s.barisData !== undefined) barisData = s.barisData;
                if (s.varian !== undefined) varian = s.varian;
            },
            kumpulkan: () => { kumpulkanVarian(); return varian; },
            barisKosong: () => barisKosong,
            cekIzinTulis: cekIzinTulis,
            jalankanTugas: jalankanTugas
        }
    };
}
