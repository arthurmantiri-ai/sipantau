/* ============================================================
   PEMBUKUAN CORE — KLINIK IMANUEL
   Mesin perhitungan murni: tanpa DOM, tanpa Supabase, tanpa
   state global. Semua fungsi menerima objek `db` dan
   mengembalikan angka. Bisa dijalankan di browser (window.KEU)
   maupun di Node untuk pengujian (require).

   Bentuk objek `db` yang diharapkan:
     db.meta.tahun        number   tahun buku
     db.saldoAwal         {kas, bankMandiri, deposito, piutang, stockObat}
     db.modalAwal         number
     db.hutangPendek      number
     db.hutangPanjang     number
     db.stockObat         { JAN:{akhir}, FEB:{akhir}, ... }
     db.jurnal            [{id,tgl,uraian,kategori,debet,kredit,akun,akunLawan}]
     db.inventaris        [{id,jenis,jumlah,tahun,tglPerolehan,nilaiBeli,manfaat,refJurnal}]

   ATURAN INTI — setiap baris jurnal menyeimbangkan dirinya sendiri:
     akunLawan kosong -> satu rekening bergerak, kategori menentukan
                         apakah itu pendapatan, biaya, atau belanja modal
     akunLawan terisi -> dua rekening bergerak berlawanan, nol efek
                         ke Laba/Rugi (murni pemindahan dana)
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KEU = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BULAN = ["JAN","FEB","MAR","APR","MEI","JUN","JUL","AGU","SEP","OKT","NOV","DES"];
  const AKUN_KAS = "Kas";
  const AKUN_BANK = ["Bank Mandiri", "Bank Mandiri Deposito"];
  const SEMUA_AKUN = [AKUN_KAS].concat(AKUN_BANK);

  const KAT_SETOR = "Setoran/Transfer ke Bank";
  const KAT_TARIK = "Tarik Tunai dari Bank";
  const KAT_PINDAH = "Pindah Dana Antar Rekening";
  const KAT_INVENTARIS = "Pembelian Inventaris";
  const KAT_TANPA = "(Tanpa Kategori)";

  const KATEGORI = [
    {grup:"Pendapatan dari BPJS Kesehatan", jenis:"in", items:["Kapitasi BPJS Kes","Kegiatan Kelompok","Pelayanan KB","Lab. GDP PRB-Prolanis","Protesa Gigi"]},
    {grup:"Pendapatan dari Klinik", jenis:"in", items:["Pendapatan Konsultasi","Pendapatan Obat","Tindakan Poli Gigi","Tindakan Poli Umum","Pendapatan Laboratorium","Protesa","Pendapatan Lain"]},
    {grup:"Pendapatan Bank", jenis:"in", items:["Bunga Bank"]},
    {grup:"Pembelian (HPP)", jenis:"out", items:["Pembelian Obat","Pembelian Alkes","Pembelian Medis","Pembelian Laboratorium","Pembelian Protesa"]},
    {grup:"Gaji & Jasa", jenis:"out", items:["Gaji Pegawai","Jasa Dokter"]},
    {grup:"Iuran & Potongan", jenis:"out", items:["Iuran BPJS TK + Kes","Potongan PPh Instansi"]},
    {grup:"Biaya Operasional", jenis:"out", items:["Biaya Administrasi","Biaya Transportasi","Biaya Konsumsi","Biaya Telepon, Listrik, Air","Biaya Perawatan","Biaya Lain","Biaya Admin & Pajak Bank"]},
    {grup:"Kerohanian", jenis:"out", items:["Kunjungan Orang Sakit","Kunjungan Kedukaan","Kunjungan Musibah"]},
    {grup:"Bidang Kesehatan", jenis:"out", items:["Donor Darah","Edukasi/Senam","Ret-ret Klinik","Seminar + Pelatihan"]},
    {grup:"Diakonia / P3K", jenis:"out", items:["Diakonia / Obat P3K"]},
    {grup:"Bidang Sekretariat", jenis:"out", items:["Pengurusan SIP/SIK","Fiskal Yayasan","PBB Marina/STNK"]},
    {grup:"Lain-lain", jenis:"out", items:["Subsidi YKI ke GK"]},
    {grup:"Pemindahan Dana & Belanja Modal", jenis:"mut", items:[KAT_SETOR, KAT_TARIK, KAT_PINDAH, KAT_INVENTARIS]},
  ];

  /* Kategori warisan yang tidak lagi bisa dipilih di form, tapi tetap
     dihitung kalau masih ada barisnya di database. "Penyusutan Inventaris"
     sekarang diturunkan dari daftar inventaris, bukan diinput manual. */
  const KATEGORI_WARISAN = {"Penyusutan Inventaris": "out"};

  const PETA_KATEGORI = (function () {
    const m = Object.create(null);
    KATEGORI.forEach(g => g.items.forEach(i => { m[i] = {grup: g.grup, jenis: g.jenis}; }));
    Object.keys(KATEGORI_WARISAN).forEach(k => { m[k] = {grup: "Lain-lain", jenis: KATEGORI_WARISAN[k]}; });
    return m;
  })();

  const ITEM_HPP = ["Pembelian Obat","Pembelian Alkes","Pembelian Medis","Pembelian Laboratorium","Pembelian Protesa"];

  const ITEM_BIAYA = (function () {
    const hpp = new Set(ITEM_HPP);
    const out = [];
    KATEGORI.forEach(g => { if (g.jenis === "out") g.items.forEach(i => { if (!hpp.has(i)) out.push(i); }); });
    Object.keys(KATEGORI_WARISAN).forEach(k => { if (KATEGORI_WARISAN[k] === "out" && !hpp.has(k)) out.push(k); });
    return out;
  })();

  /* Kategori tidak dikenal TIDAK PERNAH dibuang diam-diam. Ia jatuh ke
     ember KAT_TANPA dan ikut mengurangi laba, supaya Neraca tetap seimbang
     dan masalahnya kelihatan di layar, bukan hilang. */
  function catInfo(nama) {
    return PETA_KATEGORI[nama] || {grup: "Lain-lain", jenis: "out", takDikenal: true};
  }

  /* ---------- tanggal ---------- */
  const n2 = n => (n < 10 ? "0" : "") + n;
  const bulanOf = iso => BULAN[parseInt(String(iso || "").slice(5, 7), 10) - 1] || null;
  const tahunOf = iso => parseInt(String(iso || "").slice(0, 4), 10) || 0;
  const idxBulan = p => BULAN.indexOf(p);

  function akhirBulan(tahun, idx) {
    return tahun + "-" + n2(idx + 1) + "-" + n2(new Date(tahun, idx + 1, 0).getDate());
  }

  const BULAN_NAMA = {
    januari:1, jan:1, februari:2, feb:2, pebruari:2, maret:3, mar:3, april:4, apr:4,
    mei:5, juni:6, jun:6, juli:7, jul:7, agustus:8, agt:8, agu:8, ags:8,
    september:9, sep:9, sept:9, oktober:10, okt:10, november:11, nov:11, nop:11,
    desember:12, des:12
  };

  /* Mengubah kolom `tahun` yang bentuknya bebas menjadi tanggal perolehan.
     Bentuk yang ditemui di data nyata: "2023", "Juli 2024", "04 Mei 2026",
     "Dibawah tahun 2020". Yang terakhir sengaja mengembalikan null dan
     diperlakukan sebagai sudah habis disusutkan. */
  function parseTglPerolehan(teks) {
    const t = String(teks || "").trim();
    if (!t) return null;
    if (/dibawah|di bawah/i.test(t)) return null;

    let m = t.match(/^(\d{4})$/);
    if (m) return m[1] + "-01-01";

    m = t.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]+)[\s\-\/]+(\d{4})$/);
    if (m) {
      const bl = BULAN_NAMA[m[2].toLowerCase()];
      if (bl) return m[3] + "-" + n2(bl) + "-" + n2(parseInt(m[1], 10));
    }

    m = t.match(/^([A-Za-z]+)[\s\-\/]+(\d{4})$/);
    if (m) {
      const bl = BULAN_NAMA[m[1].toLowerCase()];
      if (bl) return m[2] + "-" + n2(bl) + "-01";
    }

    m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return t;

    return null;
  }

  function tglPerolehanOf(item) {
    if (item.tglPerolehan) return item.tglPerolehan;
    return parseTglPerolehan(item.tahun);
  }

  /* ---------- efek satu baris jurnal terhadap satu rekening ---------- */
  function efekAkun(j, akun) {
    const d = +j.debet || 0, k = +j.kredit || 0;
    const a = j.akun || AKUN_KAS;
    let v = 0;
    if (a === akun) v += d - k;
    if (j.akunLawan && j.akunLawan === akun) v += k - d;
    return v;
  }

  function saldoAwalAkun(db, akun) {
    const s = db.saldoAwal || {};
    if (akun === "Bank Mandiri Deposito") return +s.deposito || 0;
    if (akun === "Bank Mandiri") return +s.bankMandiri || 0;
    return +s.kas || 0;
  }

  function jurnalTahun(db) {
    const th = (db.meta && db.meta.tahun) || 0;
    return (db.jurnal || []).filter(j => tahunOf(j.tgl) === th);
  }

  function jurnalPeriode(db, p) {
    return jurnalTahun(db)
      .filter(j => bulanOf(j.tgl) === p)
      .sort((a, b) => String(a.tgl).localeCompare(String(b.tgl)) || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0));
  }

  /* Saldo rekening pada AKHIR periode (batas="akhir") atau pada AWAL
     periode sebelum transaksi bulan itu (batas="awal"). */
  function saldoAkun(db, akun, period, batas) {
    const idx = idxBulan(period);
    if (idx < 0) return saldoAwalAkun(db, akun);
    const kurang = batas === "awal" ? 0 : 1;
    let s = saldoAwalAkun(db, akun);
    for (const j of jurnalTahun(db)) {
      const bi = idxBulan(bulanOf(j.tgl));
      if (bi < 0) continue;
      if (bi < idx + kurang) s += efekAkun(j, akun);
    }
    return s;
  }

  /* Baris buku besar satu rekening untuk satu bulan, lengkap dengan saldo
     berjalan. Buku Bank sekarang TURUNAN dari jurnal, bukan tabel input. */
  function mutasiAkun(db, akun, period) {
    let s = saldoAkun(db, akun, period, "awal");
    const out = [];
    for (const j of jurnalPeriode(db, period)) {
      const v = efekAkun(j, akun);
      if (v === 0 && !(j.akun === akun || j.akunLawan === akun)) continue;
      s += v;
      out.push({
        id: j.id, tgl: j.tgl, uraian: j.uraian, kategori: j.kategori,
        debet: v > 0 ? v : 0, kredit: v < 0 ? -v : 0, saldo: s,
        lawan: j.akunLawan && j.akunLawan !== akun ? j.akunLawan : (j.akun !== akun ? j.akun : null)
      });
    }
    return out;
  }

  /* ---------- stock obat: dirantai antar bulan ---------- */
  function stockAkhirFor(db, period) {
    const idx = idxBulan(period);
    if (idx < 0) return +(db.saldoAwal || {}).stockObat || 0;
    const rec = (db.stockObat || {})[period];
    if (rec && rec.akhir != null && rec.akhir !== "") return +rec.akhir || 0;
    return stockAwalFor(db, period);
  }

  /* Stok awal TIDAK pernah diinput terpisah: bulan pertama memakai saldo
     awal tahun, bulan lain mewarisi stok akhir bulan sebelumnya. Rantai
     ini yang dulu putus dan bikin L/R dan Neraca memakai angka berbeda. */
  function stockAwalFor(db, period) {
    const idx = idxBulan(period);
    if (idx <= 0) return +(db.saldoAwal || {}).stockObat || 0;
    return stockAkhirFor(db, BULAN[idx - 1]);
  }

  /* ---------- penyusutan garis lurus, per bulan ---------- */
  /* Konvensi: penyusutan mulai berjalan pada bulan BERIKUTNYA setelah
     perolehan. Aset yang dibeli 25 Maret baru menyusut satu bulan pada
     akhir April. */
  function bulanBerlalu(tglPerolehan, tahun, idx) {
    if (!tglPerolehan) return null;
    const ty = tahunOf(tglPerolehan);
    const tm = parseInt(String(tglPerolehan).slice(5, 7), 10) - 1;
    return (tahun - ty) * 12 + (idx - tm);
  }

  function penyusutanAkum(item, tahun, idx) {
    const nilai = +item.nilaiBeli || 0;
    const manfaat = +item.manfaat || 4;
    const tgl = tglPerolehanOf(item);
    if (!tgl) return nilai;                       // tak terbaca -> anggap habis
    const n = bulanBerlalu(tgl, tahun, idx);
    if (n == null || n <= 0) return 0;
    const perBulan = manfaat > 0 ? nilai / (manfaat * 12) : 0;
    return Math.min(nilai, perBulan * n);
  }

  function penyusutanBulan(item, tahun, idx) {
    const skrg = penyusutanAkum(item, tahun, idx);
    const lalu = idx <= 0 ? penyusutanAkum(item, tahun - 1, 11) : penyusutanAkum(item, tahun, idx - 1);
    return Math.max(0, skrg - lalu);
  }

  function sudahDimiliki(item, tahun, idx) {
    const tgl = tglPerolehanOf(item);
    if (!tgl) return true;                        // warisan lama, sudah ada
    return String(tgl) <= akhirBulan(tahun, idx);
  }

  function inventarisPer(db, period) {
    const th = (db.meta && db.meta.tahun) || 0;
    const idx = Math.max(0, idxBulan(period));
    let nilai = 0, akum = 0, susutBulanIni = 0, jml = 0;
    for (const it of (db.inventaris || [])) {
      if (!sudahDimiliki(it, th, idx)) continue;
      jml++;
      nilai += +it.nilaiBeli || 0;
      akum += penyusutanAkum(it, th, idx);
      susutBulanIni += penyusutanBulan(it, th, idx);
    }
    return {jumlah: jml, nilai: nilai, akum: akum, buku: nilai - akum, susutBulanIni: susutBulanIni};
  }

  /* ---------- Laba / Rugi ---------- */
  function lrData(db, period) {
    const sum = Object.create(null);
    Object.keys(PETA_KATEGORI).forEach(k => { sum[k] = 0; });
    sum[KAT_TANPA] = 0;
    const takDikenal = [];

    for (const j of jurnalPeriode(db, period)) {
      if (j.akunLawan) continue;                  // pemindahan dana: nol efek L/R
      const info = catInfo(j.kategori);
      if (info.jenis === "mut") continue;         // belanja modal, bukan biaya
      const d = +j.debet || 0, k = +j.kredit || 0;
      if (info.takDikenal) {
        sum[KAT_TANPA] += k - d;
        takDikenal.push(j);
        continue;
      }
      sum[j.kategori] += info.jenis === "in" ? (d - k) : (k - d);
    }

    return {
      sum: sum,
      takDikenal: takDikenal,
      stockAwal: stockAwalFor(db, period),
      stockAkhir: stockAkhirFor(db, period),
      penyusutan: inventarisPer(db, period).susutBulanIni
    };
  }

  function lrTotals(db, period) {
    const d = lrData(db, period);
    let pendapatan = 0;
    KATEGORI.forEach(g => { if (g.jenis === "in") g.items.forEach(i => { pendapatan += d.sum[i] || 0; }); });
    const hpp = (d.stockAwal - d.stockAkhir) + ITEM_HPP.reduce((a, i) => a + (d.sum[i] || 0), 0);
    const biaya = ITEM_BIAYA.reduce((a, i) => a + (d.sum[i] || 0), 0) + d.penyusutan + d.sum[KAT_TANPA];
    return {pendapatan: pendapatan, hpp: hpp, biaya: biaya, laba: pendapatan - hpp - biaya, d: d};
  }

  function labaSampai(db, period) {
    const idx = Math.max(0, idxBulan(period));
    let t = 0;
    for (let i = 0; i <= idx; i++) t += lrTotals(db, BULAN[i]).laba;
    return t;
  }

  function labaTahun(db) { return labaSampai(db, "DES"); }

  /* ---------- Neraca ---------- */
  function neraca(db, period) {
    const kas = saldoAkun(db, AKUN_KAS, period);
    const bank = saldoAkun(db, "Bank Mandiri", period);
    const depo = saldoAkun(db, "Bank Mandiri Deposito", period);
    const piutang = +(db.saldoAwal || {}).piutang || 0;
    const stock = stockAkhirFor(db, period);
    const inv = inventarisPer(db, period);

    const aktivaLancar = kas + bank + depo + piutang + stock;
    const totalAktiva = aktivaLancar + inv.buku;

    const hutang = (+db.hutangPendek || 0) + (+db.hutangPanjang || 0);
    const labaYtd = labaSampai(db, period);
    const modal = (+db.modalAwal || 0) + labaYtd;
    const totalPasiva = hutang + modal;

    return {
      kas, bank, depo, piutang, stock,
      inventaris: inv.nilai, penyusutan: inv.akum, inventarisBuku: inv.buku,
      aktivaLancar, totalAktiva,
      hutangPendek: +db.hutangPendek || 0, hutangPanjang: +db.hutangPanjang || 0,
      modalAwal: +db.modalAwal || 0, labaYtd, modal, totalPasiva,
      selisih: totalAktiva - totalPasiva
    };
  }

  /* Selisih pembuka tahun. Kalau ini tidak nol, seluruh bulan akan
     ikut miring sebesar angka yang sama — bukan tanda jurnalnya salah,
     melainkan modal awal / saldo awal yang belum cocok. */
  function selisihPembuka(db) {
    const th = (db.meta && db.meta.tahun) || 0;
    const s = db.saldoAwal || {};
    let invNilai = 0, invAkum = 0;
    for (const it of (db.inventaris || [])) {
      const tgl = tglPerolehanOf(it);
      if (tgl && tahunOf(tgl) >= th) continue;    // dibeli tahun berjalan
      invNilai += +it.nilaiBeli || 0;
      invAkum += penyusutanAkum(it, th - 1, 11);
    }
    const aktiva = (+s.kas || 0) + (+s.bankMandiri || 0) + (+s.deposito || 0) +
                   (+s.piutang || 0) + (+s.stockObat || 0) + (invNilai - invAkum);
    const pasiva = (+db.hutangPendek || 0) + (+db.hutangPanjang || 0) + (+db.modalAwal || 0);
    return aktiva - pasiva;
  }

  /* Rincian penyebab selisih, untuk panel diagnosa di layar Neraca. */
  function diagnosaSelisih(db, period) {
    const n = neraca(db, period);
    const pembuka = selisihPembuka(db);
    const idx = Math.max(0, idxBulan(period));
    let tanpaKategori = 0, invTanpaJurnal = 0, jurnalTanpaInv = 0;

    for (let i = 0; i <= idx; i++) {
      const d = lrData(db, BULAN[i]);
      tanpaKategori += d.takDikenal.length;
      for (const j of jurnalPeriode(db, BULAN[i])) {
        if (j.kategori === KAT_INVENTARIS && !(db.inventaris || []).some(it => String(it.refJurnal) === String(j.id))) jurnalTanpaInv++;
      }
    }
    const th = (db.meta && db.meta.tahun) || 0;
    for (const it of (db.inventaris || [])) {
      const tgl = tglPerolehanOf(it);
      if (tgl && tahunOf(tgl) === th && !it.refJurnal) invTanpaJurnal++;
    }

    return {
      selisih: n.selisih,
      selisihPembuka: pembuka,
      selisihBerjalan: n.selisih - pembuka,
      jurnalTanpaKategori: tanpaKategori,
      jurnalInventarisTanpaAset: jurnalTanpaInv,
      asetTanpaJurnal: invTanpaJurnal
    };
  }

  return {
    BULAN, SEMUA_AKUN, AKUN_KAS, AKUN_BANK, KATEGORI, ITEM_HPP, ITEM_BIAYA,
    KAT_SETOR, KAT_TARIK, KAT_PINDAH, KAT_INVENTARIS, KAT_TANPA,
    catInfo, bulanOf, tahunOf, idxBulan, akhirBulan, parseTglPerolehan, tglPerolehanOf,
    efekAkun, saldoAwalAkun, jurnalTahun, jurnalPeriode, saldoAkun, mutasiAkun,
    stockAwalFor, stockAkhirFor,
    bulanBerlalu, penyusutanAkum, penyusutanBulan, inventarisPer,
    lrData, lrTotals, labaSampai, labaTahun,
    neraca, selisihPembuka, diagnosaSelisih
  };
});
