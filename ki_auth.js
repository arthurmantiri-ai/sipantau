/* ============================================================
   KI_AUTH — Mesin kata sandi modul
   Klinik Imanuel · dipakai bersama oleh:
     - pengaturan_akun.html  (mengatur / mengganti sandi)
     - admin_gate.js         (gerbang kategori Pengaturan Sistem)
     - stok_obat.js          (gerbang modul apotek)
     - pembukuan.html        (gerbang modul keuangan)
   ------------------------------------------------------------
   Berkas ini TIDAK melakukan hashing dan TIDAK pernah membaca
   tabel `sys_akun`. Semuanya lewat tiga fungsi Postgres
   (`security definer`) yang dipasang oleh sql/001_sys_akun.sql:

       ki_verifikasi(kunci, sandi)          → true | false | null
       ki_atur_sandi(kunci, lama, baru)     → kode teks
       ki_status_akun()                     → daftar tanpa hash

   Alasannya: hash tetap di dalam database. anon key tidak bisa
   dipakai mengunduh hash, dan tidak bisa dipakai MENIMPA sandi
   tanpa tahu sandi lamanya.

   BATAS YANG TETAP ADA
   Keputusan "boleh masuk atau tidak" masih diambil di browser,
   jadi orang yang membuka DevTools tetap bisa melewati gerbang
   halamannya. Yang sudah aman adalah sandinya sendiri, bukan
   pintunya. Pintu yang benar = Supabase Auth + RLS per peran.
   ============================================================ */
'use strict';

var KiAuth = (function () {

    const SUPABASE_URL = 'https://xbvnydbglqyqnhwddjvm.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhidm55ZGJnbHF5cW5od2RkanZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQwNTMsImV4cCI6MjA5NjMxMDA1M30.QRjVy7TSJi7vOeF3sZzsk1JSD0mg2NMhwBMlO4YrOv0';

    const MIN_PANJANG_PW = 8;
    const MAKS_BYTE_PW   = 72;   // batas keras bcrypt: kelebihannya dipotong diam-diam
    const PANJANG_BEBAS_RAGAM = 16;  // sepanjang ini, tidak wajib campur jenis karakter

    const KUNCI_SAH = ['admin', 'farmasi', 'keuangan'];

    const LABEL = {
        admin:    'Pengaturan Sistem',
        farmasi:  'Stok Obat (Apotek)',
        keuangan: 'Pembukuan Keuangan'
    };

    const KETERANGAN = {
        admin:    'Membuka Master Data, Item & Harga, Pembersihan Data, dan halaman ini.',
        farmasi:  'Membuka modul stok obat apotek.',
        keuangan: 'Membuka modul pembukuan keuangan.'
    };

    // Kode dari ki_atur_sandi → pesan untuk dibaca orang.
    const PESAN_KODE = {
        kunci_tidak_dikenal:  'Kunci akun tidak dikenali.',
        sandi_terlalu_pendek: `Kata sandi baru minimal ${MIN_PANJANG_PW} karakter.`,
        sandi_lama_salah:     'Kata sandi lama salah.',
        sandi_sama:           'Kata sandi baru sama dengan yang sekarang.'
    };

    let klien = null;

    /* ── Klien Supabase ───────────────────────────────────── */

    // Boleh dititipkan klien yang sudah ada di halaman (mis. `db` / `supa`)
    // supaya tidak ada dua koneksi. Kalau tidak, dibuat sendiri.
    function init(klienLuar) {
        if (klienLuar) { klien = klienLuar; return klien; }
        return db();
    }

    function db() {
        if (klien) return klien;
        if (typeof supabase === 'undefined' || !supabase.createClient) {
            throw new Error('Pustaka Supabase belum dimuat. Pastikan <script> supabase-js ada sebelum ki_auth.js.');
        }
        klien = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        return klien;
    }

    /* ── Penerjemah galat RPC ─────────────────────────────── */

    function galatRpc(error, namaFungsi) {
        const t = (error && error.message) || 'galat tidak diketahui';
        // Fungsi belum ada = migrasi SQL belum dijalankan. Ini kekeliruan
        // urutan deploy yang paling sering terjadi, jadi disebut terang-terangan.
        if (/could not find|does not exist|schema cache|PGRST202/i.test(t)) {
            return new Error(
                `Fungsi ${namaFungsi} belum ada di database. ` +
                'Jalankan sql/001_sys_akun.sql di Supabase SQL Editor dulu, baru muat ulang halaman ini.'
            );
        }
        return new Error(`Gagal menghubungi database: ${t}`);
    }

    /* ── Verifikasi ───────────────────────────────────────── */

    /* true  = sandi benar
       false = sandi salah
       Melempar error bila: kunci belum diatur, atau query gagal.
       SENGAJA melempar, bukan mengembalikan false — supaya pemanggil
       gagal-tertutup. Jangan diubah menjadi `return false` pada error:
       itu tidak apa-apa untuk gerbang, tapi menyamarkan "belum diatur"
       menjadi "sandi salah" dan bikin orang mencari sandi yang tidak ada. */
    async function verifikasi(kunci, pw) {
        const { data, error } = await db().rpc('ki_verifikasi', {
            p_kunci: kunci, p_sandi: pw == null ? '' : String(pw)
        });
        if (error) throw galatRpc(error, 'ki_verifikasi');
        if (data === null || data === undefined) {
            throw new Error(
                `Kata sandi untuk "${label(kunci)}" belum diatur di database. ` +
                'Buka Pengaturan Akun untuk mengaturnya.'
            );
        }
        return data === true;
    }

    /* ── Atur / ganti sandi ───────────────────────────────── */

    // pwLama boleh null hanya bila kunci itu memang belum pernah diatur.
    async function atur(kunci, pwLama, pwBaru) {
        const nilai = kekuatan(pwBaru);
        if (!nilai.ok) throw new Error(nilai.pesan);

        const { data, error } = await db().rpc('ki_atur_sandi', {
            p_kunci: kunci,
            p_sandi_lama: pwLama == null ? null : String(pwLama),
            p_sandi_baru: String(pwBaru)
        });
        if (error) throw galatRpc(error, 'ki_atur_sandi');
        if (data === 'ok') return true;
        throw new Error(PESAN_KODE[data] || `Gagal menyimpan (kode: ${data}).`);
    }

    /* ── Status ───────────────────────────────────────────── */

    // [{kunci, sudah_diatur, diperbarui}] — hash tidak pernah ikut.
    async function status() {
        const { data, error } = await db().rpc('ki_status_akun');
        if (error) throw galatRpc(error, 'ki_status_akun');
        const peta = {};
        (data || []).forEach(r => { peta[r.kunci] = r; });
        // Kunci yang belum ada barisnya tetap dilaporkan, supaya UI bisa
        // menampilkan "belum diatur" alih-alih menyembunyikannya.
        return KUNCI_SAH.map(k => peta[k] || { kunci: k, sudah_diatur: false, diperbarui: null });
    }

    /* ── Pemeriksaan kekuatan sandi ───────────────────────── */
    /* Ini hanya untuk memberi tahu pemakai lebih cepat. Penjaga yang
       sungguhan ada di ki_atur_sandi (panjang minimum diperiksa di DB). */

    function jumlahByte(s) {
        try { return new TextEncoder().encode(s).length; }
        catch (e) { return s.length; }
    }

    function kekuatan(pw) {
        if (typeof pw !== 'string' || pw.length === 0) {
            return { ok: false, tingkat: 'kosong', pesan: 'Kata sandi belum diisi.' };
        }
        if (pw.length < MIN_PANJANG_PW) {
            return { ok: false, tingkat: 'lemah', pesan: `Minimal ${MIN_PANJANG_PW} karakter (sekarang ${pw.length}).` };
        }
        if (jumlahByte(pw) > MAKS_BYTE_PW) {
            return { ok: false, tingkat: 'lemah', pesan: `Terlalu panjang — maksimal ${MAKS_BYTE_PW} byte. Huruf beraksen dan emoji memakan lebih dari satu byte.` };
        }
        if (/^\s|\s$/.test(pw)) {
            return { ok: false, tingkat: 'lemah', pesan: 'Jangan diawali atau diakhiri spasi — mudah salah ketik.' };
        }
        const kelas = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;

        /* Panjang mengalahkan kerumitan. Kalimat sandi panjang yang semuanya
           huruf kecil ("kucing tidur di atap seng") lebih sulit ditebak
           daripada "Passw0rd!", jadi syarat campur jenis karakter hanya
           berlaku untuk sandi pendek. */
        if (pw.length < PANJANG_BEBAS_RAGAM && kelas < 2) {
            return { ok: false, tingkat: 'lemah',
                     pesan: `Campur dua jenis karakter (huruf besar, angka, atau simbol), atau pakai kalimat sandi minimal ${PANJANG_BEBAS_RAGAM} karakter.` };
        }

        // Menahan 'aaaaaaaa' dan '12121212' yang lolos hitungan panjang.
        const ragamHuruf = new Set(pw.toLowerCase()).size;
        if (ragamHuruf < 5) {
            return { ok: false, tingkat: 'lemah', pesan: 'Terlalu banyak karakter yang berulang.' };
        }

        const rendah = pw.toLowerCase();
        const mudah = ['password', 'imanuel', 'klinik', 'farmasi', 'keuangan', 'apotek',
                       'admin', 'qwerty', '12345678', 'farmasiimanuel', 'adminimanuel2026'];
        if (mudah.includes(rendah)) {
            return { ok: false, tingkat: 'lemah', pesan: 'Terlalu mudah ditebak — ini termasuk daftar sandi yang pertama dicoba orang.' };
        }

        if (pw.length >= PANJANG_BEBAS_RAGAM) return { ok: true, tingkat: 'kuat', pesan: 'Kuat — panjangnya yang bekerja.' };
        if (kelas >= 3 && pw.length >= 12) return { ok: true, tingkat: 'kuat', pesan: 'Kuat.' };
        if (kelas >= 3 || pw.length >= 12) return { ok: true, tingkat: 'sedang', pesan: 'Cukup. Menambah panjang lebih menolong daripada menambah simbol.' };
        return { ok: true, tingkat: 'pas', pesan: 'Memenuhi syarat minimum.' };
    }

    /* ── Label ────────────────────────────────────────────── */

    function label(kunci) { return LABEL[kunci] || kunci; }
    function keterangan(kunci) { return KETERANGAN[kunci] || ''; }

    return {
        init, db,
        verifikasi, atur, status,
        kekuatan, label, keterangan,
        KUNCI_SAH, LABEL, MIN_PANJANG_PW, MAKS_BYTE_PW, PANJANG_BEBAS_RAGAM,
        _galatRpc: galatRpc, _jumlahByte: jumlahByte
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = KiAuth;
