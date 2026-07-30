/* ============================================================
   PENGATURAN AKUN — Logika halaman
   Klinik Imanuel · pengaturan_akun.html
   ------------------------------------------------------------
   Menampilkan status tiga kata sandi modul dan mengubahnya.
   Semua sentuhan ke database lewat KiAuth (ki_auth.js), yang
   memanggil fungsi Postgres — halaman ini tidak pernah melihat
   hash, dan tidak pernah menyimpan sandi ke mana pun.
   ============================================================ */
'use strict';

/* Ikon per kunci akun */
const IKON = {
    admin:    'fa-sliders',
    farmasi:  'fa-boxes-stacked',
    keuangan: 'fa-book-open'
};

/* Sandi benih dari migrasi. Kalau ini masih berlaku, kartunya
   ditandai merah — supaya tidak diam-diam dipakai berbulan-bulan. */
const SANDI_BENIH = {
    admin:   'AdminImanuel2026',
    farmasi: 'farmasiimanuel'
};

let statusAkun = [];
let kunciAktif = null;      // kunci yang sedang diubah di modal
let perluLama  = true;      // apakah modal meminta sandi lama

/* ── Utilitas ─────────────────────────────────────────────── */

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatWaktu(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleDateString('id-ID', {
        day: 'numeric', month: 'long', year: 'numeric'
    }) + ', ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

let jedaToast = null;
function toast(teks, galat) {
    const t = document.getElementById('toast');
    t.innerHTML = `<i class="fa-solid ${galat ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i><span>${esc(teks)}</span>`;
    t.className = 'toast show' + (galat ? ' galat' : '');
    clearTimeout(jedaToast);
    jedaToast = setTimeout(() => { t.className = 'toast' + (galat ? ' galat' : ''); }, 3600);
}

/* ── Muat & gambar daftar akun ────────────────────────────── */

async function muatStatus() {
    const wadah = document.getElementById('daftarAkun');
    wadah.innerHTML = '<div class="kosong"><i class="fa-solid fa-spinner fa-spin"></i>Memuat status akun…</div>';
    try {
        statusAkun = await KiAuth.status();
        await tandaiSandiBenih();
        gambarDaftar();
    } catch (e) {
        console.error('[pengaturan_akun]', e);
        wadah.innerHTML = `<div class="kosong galat">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <b>Status akun tidak bisa dibaca.</b><br>${esc(e.message)}
        </div>`;
    }
}

/* Cek apakah sandi benih dari migrasi masih dipakai. Kalau iya, ini
   perlu kelihatan mencolok. Pemeriksaan lewat RPC yang sama seperti
   login biasa — halaman ini tetap tidak pernah membaca hash. */
async function tandaiSandiBenih() {
    for (const baris of statusAkun) {
        baris.masihBenih = false;
        const benih = SANDI_BENIH[baris.kunci];
        if (!benih || !baris.sudah_diatur) continue;
        try {
            baris.masihBenih = await KiAuth.verifikasi(baris.kunci, benih);
        } catch (e) {
            /* Bukan hal penting kalau gagal — kartunya cuma tidak dapat
               tanda merah. Jangan sampai menggagalkan seluruh halaman. */
            console.warn('[pengaturan_akun] gagal memeriksa sandi benih', baris.kunci, e.message);
        }
    }
}

function gambarDaftar() {
    const wadah = document.getElementById('daftarAkun');

    wadah.innerHTML = statusAkun.map(a => {
        const waktu = formatWaktu(a.diperbarui);

        let lencana;
        if (!a.sudah_diatur) {
            lencana = '<span class="lencana lencana-belum">Belum diatur</span>';
        } else if (a.masihBenih) {
            lencana = '<span class="lencana lencana-awal">Masih sandi awal</span>';
        } else {
            lencana = '<span class="lencana lencana-ok">Aktif</span>';
        }

        let barisWaktu = '';
        if (a.masihBenih) {
            barisWaktu = '<div class="akun-waktu" style="color:#dc2626;font-weight:600">' +
                         'Sandi bawaan dari pemasangan masih berlaku — ganti sekarang.</div>';
        } else if (waktu) {
            barisWaktu = `<div class="akun-waktu">Terakhir diubah ${esc(waktu)}</div>`;
        }

        return `
        <div class="akun">
            <div class="akun-ikon"><i class="fa-solid ${IKON[a.kunci] || 'fa-key'}"></i></div>
            <div class="akun-teks">
                <div class="akun-nama">${esc(KiAuth.label(a.kunci))} ${lencana}</div>
                <div class="akun-ket">${esc(KiAuth.keterangan(a.kunci))}</div>
                ${barisWaktu}
            </div>
            <button type="button" class="btn-ganti" data-kunci="${esc(a.kunci)}">
                <i class="fa-solid fa-key"></i> ${a.sudah_diatur ? 'Ganti sandi' : 'Atur sandi'}
            </button>
        </div>`;
    }).join('');

    // Nilai diambil dari atribut data, bukan disisipkan ke onclick —
    // supaya tanda kutip pada teks tidak pernah bisa merusak markup.
    wadah.querySelectorAll('.btn-ganti').forEach(b => {
        b.addEventListener('click', () => bukaModal(b.dataset.kunci));
    });
}

/* ── Modal ────────────────────────────────────────────────── */

function bukaModal(kunci) {
    const baris = statusAkun.find(a => a.kunci === kunci);
    if (!baris) return;

    kunciAktif = kunci;
    perluLama = !!baris.sudah_diatur;

    document.getElementById('modalJudul').textContent =
        (perluLama ? 'Ganti kata sandi — ' : 'Atur kata sandi — ') + KiAuth.label(kunci);
    document.getElementById('modalSub').textContent = KiAuth.keterangan(kunci);
    document.getElementById('grupLama').style.display = perluLama ? '' : 'none';

    ['pwLama', 'pwBaru', 'pwUlang'].forEach(id => {
        const el = document.getElementById(id);
        el.value = '';
        el.type = 'password';
        el.disabled = false;
    });
    document.querySelectorAll('.pw-lihat i').forEach(i => { i.className = 'fa-solid fa-eye'; });
    perbaruiUkur();
    pesan('', '');
    document.getElementById('btnSimpan').disabled = false;

    document.getElementById('modalSandi').classList.add('show');
    setTimeout(() => document.getElementById(perluLama ? 'pwLama' : 'pwBaru').focus(), 60);
}

function tutupModal() {
    document.getElementById('modalSandi').classList.remove('show');
    // Jangan tinggalkan sandi di dalam DOM setelah modal ditutup.
    ['pwLama', 'pwBaru', 'pwUlang'].forEach(id => { document.getElementById(id).value = ''; });
    kunciAktif = null;
}

function pesan(teks, jenis) {
    const el = document.getElementById('modalPesan');
    el.textContent = teks || '';
    el.className = 'modal-pesan' + (jenis ? ' ' + jenis : '');
}

function perbaruiUkur() {
    const pw = document.getElementById('pwBaru').value;
    const ukur = document.getElementById('ukur');
    const teks = document.getElementById('ukurTeks');
    if (!pw) {
        ukur.dataset.tingkat = 'kosong';
        teks.textContent = '';
        return;
    }
    const h = KiAuth.kekuatan(pw);
    ukur.dataset.tingkat = h.tingkat;
    teks.textContent = h.pesan;
}

/* ── Simpan ───────────────────────────────────────────────── */

async function simpan() {
    if (!kunciAktif) return;

    const lama  = document.getElementById('pwLama').value;
    const baru  = document.getElementById('pwBaru').value;
    const ulang = document.getElementById('pwUlang').value;

    if (perluLama && !lama) {
        pesan('Kata sandi sekarang belum diisi.', 'salah');
        document.getElementById('pwLama').focus();
        return;
    }
    const nilai = KiAuth.kekuatan(baru);
    if (!nilai.ok) {
        pesan(nilai.pesan, 'salah');
        document.getElementById('pwBaru').focus();
        return;
    }
    if (baru !== ulang) {
        pesan('Ulangan kata sandi tidak sama.', 'salah');
        document.getElementById('pwUlang').focus();
        return;
    }

    const btn = document.getElementById('btnSimpan');
    btn.disabled = true;
    ['pwLama', 'pwBaru', 'pwUlang'].forEach(id => { document.getElementById(id).disabled = true; });
    pesan('Menyimpan…', 'info');

    try {
        await KiAuth.atur(kunciAktif, perluLama ? lama : null, baru);
        const nama = KiAuth.label(kunciAktif);
        tutupModal();
        toast(`Kata sandi ${nama} berhasil diganti.`);
        await muatStatus();
    } catch (e) {
        pesan(e.message, 'salah');
        console.error('[pengaturan_akun]', e);
    } finally {
        btn.disabled = false;
        ['pwLama', 'pwBaru', 'pwUlang'].forEach(id => { document.getElementById(id).disabled = false; });
    }
}

/* ── Pemasangan ───────────────────────────────────────────── */

function pasang() {
    document.getElementById('btnBatal').addEventListener('click', tutupModal);
    document.getElementById('btnSimpan').addEventListener('click', simpan);
    document.getElementById('pwBaru').addEventListener('input', perbaruiUkur);

    // Tombol mata: tampilkan / sembunyikan isi kolom sandi.
    document.querySelectorAll('.pw-lihat').forEach(b => {
        b.addEventListener('click', () => {
            const inp = document.getElementById(b.dataset.untuk);
            const buka = inp.type === 'password';
            inp.type = buka ? 'text' : 'password';
            b.querySelector('i').className = 'fa-solid ' + (buka ? 'fa-eye-slash' : 'fa-eye');
            b.setAttribute('aria-label', buka ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
        });
    });

    // Enter menyimpan, Esc menutup.
    ['pwLama', 'pwBaru', 'pwUlang'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); simpan(); }
        });
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('modalSandi').classList.contains('show')) tutupModal();
    });

    // Klik latar gelap menutup modal, klik di dalam kartu tidak.
    document.getElementById('modalSandi').addEventListener('click', e => {
        if (e.target.id === 'modalSandi') tutupModal();
    });

    muatStatus();
}

/* Tunggu gerbang admin terbuka dulu — tidak ada gunanya menembak
   database untuk halaman yang masih tertutup. */
if (typeof KiGate !== 'undefined') KiGate.saatTerbuka(pasang);
else document.addEventListener('DOMContentLoaded', pasang);
