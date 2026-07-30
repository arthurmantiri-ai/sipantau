/* ============================================================
   ADMIN_GATE — Gerbang kategori "Pengaturan Sistem"
   Klinik Imanuel
   ------------------------------------------------------------
   CARA PAKAI — tiga tag di dalam <head>, urutannya wajib:

       <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
       <script src="ki_auth.js"></script>
       <script src="admin_gate.js"></script>

   Isi halaman disembunyikan sejak sebelum dilukis, jadi tidak
   ada kedipan. Sesi disimpan per tab: pindah antar halaman
   Pengaturan Sistem tidak perlu ketik sandi lagi, dan hangus
   saat tab ditutup atau setelah 15 menit tanpa aktivitas.

   Kalau skrip halaman perlu menunda pemuatan data sampai
   gerbang terbuka, bungkus init-nya:

       KiGate.saatTerbuka(function () { muatData(); });

   BATAS YANG HARUS DISADARI
   Ini pengunci sisi-klien. Orang yang membuka DevTools bisa
   melewatinya, dan anon key di dalam kode tetap bisa dipakai
   memukul PostgREST langsung. Gunanya menahan salah-klik dan
   staf yang tidak berkepentingan — bukan kendali akses.
   Kendali akses sungguhan = Supabase Auth + RLS per peran.
   ============================================================ */
'use strict';

var KiGate = (function () {

    const KUNCI_AKUN   = (window.KI_GATE_KUNCI || 'admin');
    const SLOT_SESI    = 'ki_gate_sesi';
    const IDLE_MENIT   = 15;
    const JEDA_SIMPAN  = 30000;   // paling cepat 30 detik sekali tulis sessionStorage
    const JUDUL        = 'Pengaturan Sistem';

    let terbuka   = false;
    let tertunda  = [];           // fungsi yang menunggu gerbang terbuka
    let salah     = 0;            // hitungan gagal dalam sesi tab ini
    let sesiMemori = null;        // cadangan bila sessionStorage tidak bisa dipakai
    let tulisTerakhir = 0;
    let pengaturWaktu = null;

    /* ── 1. Sembunyikan isi halaman SEKARANG (sinkron) ────── */

    document.documentElement.classList.add('ki-terkunci');
    (function suntikGaya() {
        const g = document.createElement('style');
        g.id = 'ki-gate-gaya';
        g.textContent = `
.ki-terkunci body > *:not(.ki-gate){display:none !important}
.ki-terkunci body{background:#f8fafc !important}
.ki-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;
  justify-content:center;padding:24px;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);
  font-family:'Inter',system-ui,-apple-system,Segoe UI,sans-serif;color:#1e293b}
.ki-gate *{box-sizing:border-box;margin:0}
.ki-gate-kartu{background:#fff;width:100%;max-width:420px;border-radius:16px;padding:36px 32px;
  box-shadow:0 25px 60px rgba(0,0,0,.4);text-align:center}
.ki-gate-ikon{width:56px;height:56px;margin:0 auto 16px;border-radius:14px;background:#eff6ff;
  color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:1.4rem}
.ki-gate-kartu h2{font-size:1.22rem;font-weight:700;margin-bottom:6px;letter-spacing:-.2px}
.ki-gate-kartu p.ki-gate-sub{color:#64748b;font-size:.88rem;line-height:1.55;margin-bottom:22px}
.ki-gate-kartu label{display:block;text-align:left;font-size:.82rem;font-weight:600;
  color:#334155;margin-bottom:7px}
.ki-gate-kartu input{width:100%;padding:12px 14px;border:1px solid #e2e8f0;border-radius:10px;
  font-size:.95rem;font-family:inherit;color:#1e293b;background:#fff;outline:none;transition:.18s}
.ki-gate-kartu input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.13)}
.ki-gate-kartu input:disabled{background:#f1f5f9;color:#94a3b8}
.ki-gate-pesan{min-height:20px;font-size:.82rem;font-weight:600;margin:10px 0 4px;text-align:left}
.ki-gate-pesan.salah{color:#dc2626}
.ki-gate-pesan.info{color:#64748b}
.ki-gate-btn{width:100%;padding:12px 18px;margin-top:8px;border:none;border-radius:10px;
  background:#2563eb;color:#fff;font-family:inherit;font-size:.94rem;font-weight:600;cursor:pointer;
  transition:background .18s}
.ki-gate-btn:hover:not(:disabled){background:#1d4ed8}
.ki-gate-btn:disabled{background:#93b4f5;cursor:default}
.ki-gate-kembali{display:inline-block;margin-top:18px;color:#64748b;font-size:.84rem;
  text-decoration:none;font-family:inherit}
.ki-gate-kembali:hover{color:#2563eb}
.ki-gate-catatan{margin-top:20px;padding-top:16px;border-top:1px solid #eef2f7;
  font-size:.74rem;color:#94a3b8;line-height:1.6;text-align:left}
.ki-gate-kartu:focus-visible,.ki-gate-btn:focus-visible,.ki-gate-kembali:focus-visible{
  outline:2px solid #2563eb;outline-offset:2px}
.ki-kunci-btn{position:fixed;right:16px;bottom:16px;z-index:900;padding:9px 15px;border:none;
  border-radius:999px;background:#1e293b;color:#fff;font-family:'Inter',system-ui,sans-serif;
  font-size:.8rem;font-weight:600;cursor:pointer;box-shadow:0 8px 22px -8px rgba(15,23,42,.6);
  display:flex;align-items:center;gap:7px;opacity:.82;transition:opacity .18s}
.ki-kunci-btn:hover{opacity:1}
@media (prefers-reduced-motion:reduce){.ki-gate *{transition:none !important}}
@media (max-width:420px){.ki-gate{padding:14px}.ki-gate-kartu{padding:28px 22px}}`;
        (document.head || document.documentElement).appendChild(g);
    })();

    /* ── 2. Sesi (per tab) ────────────────────────────────── */

    function bacaSesi() {
        try {
            const t = sessionStorage.getItem(SLOT_SESI);
            return t ? JSON.parse(t) : null;
        } catch (e) { return sesiMemori; }
    }

    function tulisSesi(s) {
        sesiMemori = s;
        try {
            if (s) sessionStorage.setItem(SLOT_SESI, JSON.stringify(s));
            else sessionStorage.removeItem(SLOT_SESI);
        } catch (e) { /* mode privat / storage diblokir → cukup di memori */ }
    }

    function sesiMasihSah() {
        const s = bacaSesi();
        if (!s || s.kunci !== KUNCI_AKUN) return false;
        if (typeof s.sampai !== 'number') return false;
        return Date.now() < s.sampai;
    }

    function perpanjang(paksa) {
        const now = Date.now();
        if (!paksa && now - tulisTerakhir < JEDA_SIMPAN) return;
        tulisTerakhir = now;
        tulisSesi({ kunci: KUNCI_AKUN, sampai: now + IDLE_MENIT * 60000 });
    }

    /* ── 3. Buka / kunci ──────────────────────────────────── */

    function buka() {
        terbuka = true;
        perpanjang(true);
        document.documentElement.classList.remove('ki-terkunci');
        const g = document.querySelector('.ki-gate');
        if (g) g.remove();
        pasangPemantauIdle();
        pasangTombolKunci();
        const antre = tertunda; tertunda = [];
        antre.forEach(fn => { try { fn(); } catch (e) { console.error('[admin_gate] init halaman gagal:', e); } });
    }

    function kunci(alasan) {
        terbuka = false;
        tulisSesi(null);
        if (pengaturWaktu) { clearInterval(pengaturWaktu); pengaturWaktu = null; }
        const tb = document.querySelector('.ki-kunci-btn');
        if (tb) tb.remove();
        document.documentElement.classList.add('ki-terkunci');
        if (!document.querySelector('.ki-gate')) gambarGerbang(alasan || '');
        else if (alasan) pesan(alasan, 'info');
    }

    function pasangPemantauIdle() {
        ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach(ev =>
            window.addEventListener(ev, () => { if (terbuka) perpanjang(false); }, { passive: true })
        );
        pengaturWaktu = setInterval(() => {
            if (terbuka && !sesiMasihSah()) kunci(`Sesi berakhir setelah ${IDLE_MENIT} menit tanpa aktivitas. Masukkan kata sandi lagi.`);
        }, 20000);
    }

    function pasangTombolKunci() {
        if (document.querySelector('.ki-kunci-btn')) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ki-kunci-btn';
        b.title = `Kunci halaman ini (otomatis terkunci setelah ${IDLE_MENIT} menit tanpa aktivitas)`;
        b.innerHTML = '<i class="fa-solid fa-lock" aria-hidden="true"></i> Kunci';
        b.addEventListener('click', () => kunci('Halaman dikunci.'));
        document.body.appendChild(b);
    }

    /* ── 4. Tampilan gerbang ──────────────────────────────── */

    function pesan(teks, jenis) {
        const el = document.querySelector('.ki-gate-pesan');
        if (!el) return;
        el.textContent = teks || '';
        el.className = 'ki-gate-pesan' + (jenis ? ' ' + jenis : '');
    }

    function gambarGerbang(pesanAwal) {
        const bungkus = document.createElement('div');
        bungkus.className = 'ki-gate';
        bungkus.setAttribute('role', 'dialog');
        bungkus.setAttribute('aria-modal', 'true');
        bungkus.setAttribute('aria-label', JUDUL + ' — terkunci');
        bungkus.innerHTML = `
<div class="ki-gate-kartu">
  <div class="ki-gate-ikon"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i></div>
  <h2>${JUDUL}</h2>
  <p class="ki-gate-sub">Halaman ini mengubah data baku yang dipakai seluruh modul. Masukkan kata sandi pengaturan sistem untuk melanjutkan.</p>
  <label for="kiGatePw">Kata sandi pengaturan sistem</label>
  <input type="password" id="kiGatePw" autocomplete="current-password" placeholder="Kata sandi">
  <div class="ki-gate-pesan"></div>
  <button type="button" class="ki-gate-btn" id="kiGateMasuk">Buka halaman</button>
  <a class="ki-gate-kembali" href="index.html">&larr; Kembali ke Beranda</a>
  <div class="ki-gate-catatan">
    Sesi berlaku selama tab ini terbuka dan berhenti setelah ${IDLE_MENIT} menit tanpa aktivitas.
    Kata sandi diatur di <b>Pengaturan Akun</b>.
  </div>
</div>`;
        document.body.appendChild(bungkus);

        const inp = bungkus.querySelector('#kiGatePw');
        const btn = bungkus.querySelector('#kiGateMasuk');
        btn.addEventListener('click', coba);
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') coba(); });
        setTimeout(() => inp.focus(), 60);
        if (pesanAwal) pesan(pesanAwal, 'info');
    }

    async function coba() {
        const inp = document.querySelector('#kiGatePw');
        const btn = document.querySelector('#kiGateMasuk');
        const pw = inp.value;
        if (!pw) { pesan('Kata sandi belum diisi.', 'salah'); inp.focus(); return; }

        btn.disabled = true; inp.disabled = true;
        pesan('Memeriksa…', 'info');

        // Perlambatan bertingkat supaya percobaan berulang tidak murah.
        const tunda = salah >= 3 ? Math.min(1000 * Math.pow(2, salah - 3), 8000) : 0;
        if (tunda) await new Promise(r => setTimeout(r, tunda));

        try {
            const benar = await KiAuth.verifikasi(KUNCI_AKUN, pw);
            if (benar) { salah = 0; buka(); return; }
            salah++;
            pesan(`Kata sandi salah.${salah >= 3 ? ' Jeda ditambahkan setiap percobaan gagal.' : ''}`, 'salah');
        } catch (e) {
            /* Gagal-tertutup: query gagal atau sandi belum diatur → tetap tertutup.
               Jangan pernah membuka halaman di cabang ini. */
            pesan(e.message, 'salah');
            console.error('[admin_gate]', e);
        } finally {
            btn.disabled = false; inp.disabled = false;
            inp.value = ''; inp.focus();
        }
    }

    /* ── 5. API untuk skrip halaman ───────────────────────── */

    function saatTerbuka(fn) {
        if (typeof fn !== 'function') return;
        if (terbuka) { fn(); return; }
        tertunda.push(fn);
    }

    /* Memuat skrip halaman baru SETELAH gerbang terbuka, berurutan sesuai
       daftar (urutan penting: master_lookup.js sebelum yang memakainya).

       Gunanya: kalau <script src> ditulis biasa di akhir <body>, skripnya
       tetap jalan dan menarik data meski layar kunci masih menutupi. Dengan
       cara ini halaman benar-benar diam sampai sandi benar. Skrip halaman
       tidak perlu diubah sama sekali. */
    function muatSkrip(daftar) {
        saatTerbuka(function () {
            daftar.reduce(function (rantai, src) {
                return rantai.then(function () {
                    return new Promise(function (selesai, gagal) {
                        const el = document.createElement('script');
                        el.src = src;
                        el.onload = selesai;
                        el.onerror = function () { gagal(new Error('Gagal memuat ' + src)); };
                        document.body.appendChild(el);
                    });
                });
            }, Promise.resolve()).catch(function (e) {
                console.error('[admin_gate]', e);
                alert(e.message + '. Muat ulang halaman, atau laporkan ke pengelola sistem.');
            });
        });
    }

    /* ── 6. Jalan ─────────────────────────────────────────── */

    function mulai() {
        if (typeof KiAuth === 'undefined') {
            document.documentElement.classList.remove('ki-terkunci');
            console.error('[admin_gate] ki_auth.js belum dimuat — gerbang tidak dipasang.');
            alert('Gerbang keamanan gagal dimuat (ki_auth.js tidak ditemukan). Laporkan ke pengelola sistem.');
            return;
        }
        try { KiAuth.init(); } catch (e) { console.error('[admin_gate]', e); }
        if (sesiMasihSah()) buka();
        else gambarGerbang('');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mulai);
    else mulai();

    return {
        saatTerbuka,
        muatSkrip,
        kunci,
        get terbuka() { return terbuka; },
        IDLE_MENIT,
        KUNCI_AKUN
    };
})();
