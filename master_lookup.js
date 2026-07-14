/* ============================================================
   MASTER LOOKUP — Modul bersama Master Data Dokter & Diagnosis
   Klinik Imanuel
   ------------------------------------------------------------
   Fungsi:
   1. Memuat master_dokter & master_diagnosis dari Supabase.
   2. Mengisi <select> dokter dari master (mengganti teks bebas).
      Jika elemen target masih <input>, otomatis diubah menjadi
      <select> dengan id/name/class/required yang sama.
   3. Memasang autocomplete diagnosis pada <input> teks:
      pencarian mencocokkan nama, alias/singkatan, dan kode ICD-10,
      lalu menyimpan bentuk baku "Nama (KODE)".
   4. Entri baru dari form otomatis berstatus 'review' untuk
      ditinjau admin lewat master_data.html.

   Cara pakai (di <script> halaman, setelah `db` dibuat):

     MasterLookup.init(db).then(() => {
         MasterLookup.isiDokterSelect('nama_dokter', { poli: 'Umum' });
         ['diagnosa1','diagnosa2','diagnosa3','diagnosa4','diagnosa5']
             .forEach(id => MasterLookup.pasangDiagnosisAutocomplete(id));
     });
   ============================================================ */
'use strict';

const MasterLookup = (() => {

    let db = null;
    let dokter = [];      // baris master_dokter (aktif saja)
    let diagnosis = [];   // baris master_diagnosis (aktif saja)

    const config = {
        sertakanKode: true,           // simpan sebagai "Nama (KODE)" jika kode tersedia
        izinkanTambahDiagnosis: true, // entri baru dari form -> status 'review'
        izinkanTambahDokter: true,    // opsi "Dokter belum terdaftar..." pada dropdown
        maksHasil: 8
    };

    /* ── Util teks ─────────────────────────────────────────── */

    function norm(s) {
        return String(s || '')
            .toLowerCase()
            .replace(/[.,;:()\/\\\-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function rapikan(s) {
        const bersih = String(s || '').replace(/\s+/g, ' ').trim();
        return bersih.split(' ').map(kata => {
            // Singkatan medis (GERD, ISPA, DM, TB, dst.) dibiarkan apa adanya
            if (/^[A-Z0-9.\-+\/]+$/.test(kata) && kata.length <= 6) return kata;
            return kata.charAt(0).toUpperCase() + kata.slice(1).toLowerCase();
        }).join(' ');
    }

    function escHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function escAttr(s) {
        return escHtml(s).replace(/"/g, '&quot;');
    }

    function labelDiagnosis(d) {
        return (config.sertakanKode && d.kode_icd10)
            ? d.nama + ' (' + d.kode_icd10 + ')'
            : d.nama;
    }

    /* ── Muat data master ──────────────────────────────────── */

    async function init(client) {
        db = client;
        await Promise.all([muatDokter(), muatDiagnosis()]);
    }

    async function muatDokter() {
        const { data, error } = await db.from('master_dokter')
            .select('*').eq('aktif', true).order('nama');
        if (error) { console.error('MasterLookup (dokter):', error.message); return; }
        dokter = data || [];
    }

    async function muatDiagnosis() {
        const { data, error } = await db.from('master_diagnosis')
            .select('*').eq('aktif', true).order('nama');
        if (error) { console.error('MasterLookup (diagnosis):', error.message); return; }
        diagnosis = data || [];
    }

    /* ── Pencarian ─────────────────────────────────────────── */

    function cariDiagnosis(q) {
        const nq = norm(q);
        if (!nq) return diagnosis.slice(0, config.maksHasil);
        const skor = (d) => {
            const nn = norm(d.nama);
            const nk = norm(d.kode_icd10 || '');
            const na = (d.alias || []).map(norm);
            if (nn === nq || nk === nq || na.indexOf(nq) !== -1) return 0;
            if (nn.startsWith(nq) || (nk && nk.startsWith(nq)) || na.some(a => a.startsWith(nq))) return 1;
            if (nn.indexOf(nq) !== -1 || (nk && nk.indexOf(nq) !== -1) || na.some(a => a.indexOf(nq) !== -1)) return 2;
            return -1;
        };
        return diagnosis
            .map(d => ({ d: d, s: skor(d) }))
            .filter(x => x.s >= 0)
            .sort((a, b) => a.s - b.s || a.d.nama.localeCompare(b.d.nama))
            .slice(0, config.maksHasil)
            .map(x => x.d);
    }

    // Pencocokan persis (ternormalisasi) — dipakai alat pembersihan & blur.
    function cariKanonikDiagnosis(teks) {
        const nq = norm(teks);
        if (!nq) return null;
        return diagnosis.find(d =>
            norm(d.nama) === nq ||
            norm(labelDiagnosis(d)) === nq ||
            norm(d.kode_icd10 || '') === nq ||
            (d.alias || []).some(a => norm(a) === nq)
        ) || null;
    }

    function cariKanonikDokter(teks) {
        const nq = norm(teks);
        if (!nq) return null;
        return dokter.find(d => norm(d.nama) === nq) || null;
    }

    /* ── Penambahan entri baru dari form (status: review) ──── */

    async function tambahDiagnosisBaru(namaMentah) {
        const nama = rapikan(namaMentah);
        if (!nama) return null;
        const ada = diagnosis.find(d => norm(d.nama) === norm(nama));
        if (ada) return ada;
        const { data, error } = await db.from('master_diagnosis')
            .insert([{ nama: nama, status: 'review' }])
            .select().single();
        if (error) {
            if (error.code === '23505') {
                alert('Diagnosis "' + nama + '" sudah terdaftar di master (kemungkinan nonaktif). Silakan hubungi admin.');
            } else {
                alert('Gagal menambah diagnosis baru: ' + error.message);
            }
            return null;
        }
        diagnosis.push(data);
        diagnosis.sort((a, b) => a.nama.localeCompare(b.nama));
        return data;
    }

    async function tambahDokterBaru(namaMentah, poli) {
        const nama = rapikan(namaMentah);
        if (!nama) return null;
        const ada = dokter.find(d => norm(d.nama) === norm(nama));
        if (ada) return ada;
        const { data, error } = await db.from('master_dokter')
            .insert([{ nama: nama, poli: poli || 'Umum', status: 'review' }])
            .select().single();
        if (error) {
            if (error.code === '23505') {
                alert('Dokter "' + nama + '" sudah terdaftar di master (kemungkinan nonaktif). Silakan hubungi admin.');
            } else {
                alert('Gagal menambah dokter baru: ' + error.message);
            }
            return null;
        }
        dokter.push(data);
        dokter.sort((a, b) => a.nama.localeCompare(b.nama));
        return data;
    }

    /* ── Dropdown dokter ───────────────────────────────────── */

    function isiDokterSelect(target, opsi) {
        opsi = opsi || {};
        const poli = opsi.poli || null;
        let el = (typeof target === 'string') ? document.getElementById(target) : target;
        if (!el) { console.warn('MasterLookup: elemen dokter tidak ditemukan:', target); return; }

        // Jika masih <input> teks bebas, ganti menjadi <select> dengan atribut sama
        if (el.tagName === 'INPUT') {
            const sel = document.createElement('select');
            sel.id = el.id;
            sel.name = el.name || el.id;
            sel.className = el.className;
            sel.required = el.required;
            el.parentNode.replaceChild(sel, el);
            el = sel;
        }

        const renderOpsi = (terpilih) => {
            const daftar = dokter.filter(d => !poli || d.poli === poli);
            let html = '<option value="" disabled' + (terpilih ? '' : ' selected') + '>Pilih Dokter...</option>';
            html += daftar.map(d =>
                '<option value="' + escAttr(d.nama) + '">' + escHtml(d.nama) +
                (d.status === 'review' ? ' (review)' : '') + '</option>'
            ).join('');
            if (config.izinkanTambahDokter) {
                html += '<option value="__tambah__">+ Dokter belum terdaftar...</option>';
            }
            el.innerHTML = html;
            if (terpilih) el.value = terpilih;
        };

        renderOpsi(null);

        el.addEventListener('change', async function () {
            if (this.value !== '__tambah__') return;
            const namaBaru = prompt('Nama dokter baru (akan ditandai untuk review admin):');
            this.value = '';
            if (!namaBaru || !namaBaru.trim()) return;
            const d = await tambahDokterBaru(namaBaru, poli || 'Umum');
            if (d) renderOpsi(d.nama);
        });
    }

    /* ── Autocomplete diagnosis ────────────────────────────── */

    function pasangDiagnosisAutocomplete(target) {
        const input = (typeof target === 'string') ? document.getElementById(target) : target;
        if (!input || input.dataset.mlAktif === '1') return;
        input.dataset.mlAktif = '1';
        input.setAttribute('autocomplete', 'off');

        const wrap = document.createElement('div');
        wrap.className = 'ml-wrap';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);

        const panel = document.createElement('div');
        panel.className = 'ml-panel';
        wrap.appendChild(panel);

        let hasil = [];
        let tampilTambah = false;
        let aktifIdx = -1;

        const totalItem = () => hasil.length + (tampilTambah ? 1 : 0);

        function tutup() {
            panel.classList.remove('show');
            panel.innerHTML = '';
            hasil = [];
            tampilTambah = false;
            aktifIdx = -1;
        }

        function pilih(d) {
            input.value = labelDiagnosis(d);
            tutup();
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }

        async function pilihTambah() {
            const teks = input.value;
            tutup();
            const baru = await tambahDiagnosisBaru(teks);
            if (baru) pilih(baru);
        }

        function sorot(nama, q) {
            const t = String(q || '').trim();
            if (!t) return escHtml(nama);
            const idx = nama.toLowerCase().indexOf(t.toLowerCase());
            if (idx === -1) return escHtml(nama);
            return escHtml(nama.slice(0, idx)) +
                   '<mark>' + escHtml(nama.slice(idx, idx + t.length)) + '</mark>' +
                   escHtml(nama.slice(idx + t.length));
        }

        function render() {
            const q = input.value;
            const nq = norm(q);
            hasil = cariDiagnosis(q);
            const adaPersis = !!cariKanonikDiagnosis(q);
            tampilTambah = !!(config.izinkanTambahDiagnosis && nq && !adaPersis);
            if (aktifIdx >= totalItem()) aktifIdx = -1;

            let html = hasil.map((d, i) => {
                const alias = (d.alias && d.alias.length)
                    ? '<span class="ml-alias">alias: ' + escHtml(d.alias.join(', ')) + '</span>' : '';
                const badge = d.status === 'review' ? '<span class="ml-review">review</span>' : '';
                const kode = d.kode_icd10 ? '<span class="ml-kode">' + escHtml(d.kode_icd10) + '</span>' : '';
                return '<div class="ml-item' + (i === aktifIdx ? ' active' : '') + '" data-i="' + i + '">' +
                       '<span class="ml-nama">' + sorot(d.nama, q) + badge + alias + '</span>' + kode +
                       '</div>';
            }).join('');

            if (!hasil.length && !tampilTambah) {
                html += '<div class="ml-empty">Tidak ada yang cocok di daftar master.</div>';
            }
            if (tampilTambah) {
                html += '<div class="ml-item ml-add' + (aktifIdx === hasil.length ? ' active' : '') + '" data-add="1">' +
                        '<span><i class="fa-solid fa-plus"></i> Tambah "<b>' + escHtml(rapikan(q)) + '</b>" (review admin)</span>' +
                        '</div>';
            }
            panel.innerHTML = html;
            panel.classList.add('show');
        }

        input.addEventListener('input', () => { aktifIdx = -1; render(); });
        input.addEventListener('focus', render);
        input.addEventListener('blur', () => {
            // Kanonisasi otomatis: "cc" yang diketik lalu ditinggal -> "Common Cold (J00)"
            const c = cariKanonikDiagnosis(input.value);
            if (c) input.value = labelDiagnosis(c);
            setTimeout(tutup, 180);
        });

        input.addEventListener('keydown', (e) => {
            if (!panel.classList.contains('show')) return;
            const total = totalItem();
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                aktifIdx = (aktifIdx + 1) % Math.max(total, 1);
                render();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                aktifIdx = (aktifIdx - 1 + total) % Math.max(total, 1);
                render();
            } else if (e.key === 'Enter') {
                if (total === 0) return;
                e.preventDefault(); // jangan submit form saat memilih dari daftar
                const idx = aktifIdx >= 0 ? aktifIdx : 0;
                if (idx < hasil.length) pilih(hasil[idx]);
                else if (tampilTambah) pilihTambah();
            } else if (e.key === 'Escape') {
                tutup();
            }
        });

        panel.addEventListener('mousedown', (e) => {
            e.preventDefault(); // pertahankan fokus pada input
            const item = e.target.closest('.ml-item');
            if (!item) return;
            if (item.dataset.add === '1') { pilihTambah(); return; }
            const i = parseInt(item.dataset.i, 10);
            if (!isNaN(i) && hasil[i]) pilih(hasil[i]);
        });
    }

    /* ── API publik ────────────────────────────────────────── */

    return {
        init: init,
        config: config,
        muatDokter: muatDokter,
        muatDiagnosis: muatDiagnosis,
        isiDokterSelect: isiDokterSelect,
        pasangDiagnosisAutocomplete: pasangDiagnosisAutocomplete,
        cariDiagnosis: cariDiagnosis,
        cariKanonikDiagnosis: cariKanonikDiagnosis,
        cariKanonikDokter: cariKanonikDokter,
        tambahDiagnosisBaru: tambahDiagnosisBaru,
        tambahDokterBaru: tambahDokterBaru,
        labelDiagnosis: labelDiagnosis,
        rapikan: rapikan,
        norm: norm,
        getDokter: () => dokter.slice(),
        getDiagnosis: () => diagnosis.slice()
    };
})();
