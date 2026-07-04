/* ============================================================
   PANTAUAN LAB RUTIN — KLINIK IMANUEL (helper bersama)
   Dipakai oleh: lab_rutin.js (halaman input) & lab_dashboard.js (dashboard)
   Tabel Supabase: lab_rutin
   Aturan jadwal:
     • Semua diagnosa      → kontrol 6 bulan setelah tanggal lab terakhir
     • DM & HPT+DM (ekstra)→ kontrol 3 bulan setelah tanggal lab terakhir
   ============================================================ */

const LAB_TABLE = 'lab_rutin';
const LAB_GRACE_HARI = 14; // toleransi keterlambatan (hari) untuk penilaian kepatuhan
const LAB_DIAGNOSA_LIST = ['DM', 'HPT', 'HPT+DM'];
const LAB_BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

/* ---------- Utilitas dasar ---------- */
function labEsc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function labEscJs(s) {
    return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
function labTodayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function labMonthNow() { return labTodayStr().slice(0, 7); }
function labLabelBulan(ym) {
    if (!ym) return '-';
    const [y, m] = ym.split('-');
    return `${LAB_BULAN_ID[parseInt(m, 10) - 1]} ${y}`;
}
function labParseTgl(str) {
    // Parse 'YYYY-MM-DD' sebagai tanggal lokal (hindari geser zona waktu)
    if (!str) return null;
    const [y, m, d] = String(str).slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d);
}
function labFmtTgl(str) {
    const d = labParseTgl(str);
    if (!d || isNaN(d)) return '-';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}
function labFmtTglPanjang(str) {
    const d = labParseTgl(str);
    if (!d || isNaN(d)) return '-';
    return d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
function labSelisihHari(dari, sampai) {
    // positif = 'sampai' lebih lambat dari 'dari'
    const a = labParseTgl(dari), b = labParseTgl(sampai);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
}

/* ---------- Penambahan bulan dengan penjepit akhir bulan ----------
   Contoh: 31 Jan + 3 bulan → 30 Apr (bukan meluber ke Mei)          */
function labAddMonths(tglStr, n) {
    const d = labParseTgl(tglStr);
    if (!d) return null;
    const totalBulan = d.getMonth() + n;
    const tahun = d.getFullYear() + Math.floor(totalBulan / 12);
    const bulan = ((totalBulan % 12) + 12) % 12;
    const hariMaks = new Date(tahun, bulan + 1, 0).getDate();
    const hari = Math.min(d.getDate(), hariMaks);
    return `${tahun}-${String(bulan + 1).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
}

/* ---------- Aturan jadwal ---------- */
function labPerluKontrol3(diagnosa) {
    return diagnosa === 'DM' || diagnosa === 'HPT+DM';
}
function labHitungJadwal(diagnosa, tanggalLab) {
    if (!tanggalLab) return { next3: null, next6: null };
    return {
        next3: labPerluKontrol3(diagnosa) ? labAddMonths(tanggalLab, 3) : null,
        next6: labAddMonths(tanggalLab, 6)
    };
}

/* ---------- Identitas pasien ----------
   Kunci utama: nomor BPJS (angka saja). Cadangan: nama (huruf kecil). */
function labKunciPasien(row) {
    const bpjs = String(row.no_bpjs || '').replace(/\D/g, '');
    if (bpjs) return 'b:' + bpjs;
    return 'n:' + String(row.nama_pasien || '').trim().toLowerCase();
}

/* ---------- Ambil seluruh data (looping 1000 baris, batas default Supabase) ---------- */
async function labAmbilSemua(dbClient) {
    const hasil = [];
    const ukuran = 1000;
    for (let dari = 0; ; dari += ukuran) {
        const { data, error } = await dbClient
            .from(LAB_TABLE)
            .select('*')
            .order('tanggal_lab', { ascending: true })
            .order('id', { ascending: true })
            .range(dari, dari + ukuran - 1);
        if (error) throw error;
        hasil.push(...(data || []));
        if (!data || data.length < ukuran) break;
    }
    return hasil;
}

/* ---------- Kelompokkan riwayat per pasien ---------- */
function labKelompokkan(rows) {
    const peta = new Map();
    for (const r of rows) {
        const k = labKunciPasien(r);
        if (!peta.has(k)) peta.set(k, { key: k, records: [] });
        peta.get(k).records.push(r);
    }
    for (const p of peta.values()) {
        p.records.sort((a, b) =>
            String(a.tanggal_lab).localeCompare(String(b.tanggal_lab)) || (a.id - b.id));
        p.latest = p.records[p.records.length - 1];
    }
    return peta;
}

/* ---------- Jadwal mendatang (dihitung dari pemeriksaan TERAKHIR tiap pasien) ----------
   Mengembalikan array item jadwal:
   { key, nama, no_bpjs, no_telp, diagnosa, lab_pemeriksa, jenis, jenisKode, due, tanggalTerakhir, recordId } */
function labJadwalMendatang(rows) {
    const hasil = [];
    for (const p of labKelompokkan(rows).values()) {
        const t = p.latest;
        const hit = labHitungJadwal(t.diagnosa, t.tanggal_lab);
        const next3 = labPerluKontrol3(t.diagnosa) ? (t.next_3bln || hit.next3) : null;
        const next6 = t.next_6bln || hit.next6;
        const dasar = {
            key: p.key,
            nama: t.nama_pasien,
            no_bpjs: t.no_bpjs || '',
            no_telp: t.no_telp || '',
            diagnosa: t.diagnosa,
            lab_pemeriksa: t.lab_pemeriksa || '',
            tanggalTerakhir: t.tanggal_lab,
            recordId: t.id
        };
        if (next3 && next3 > t.tanggal_lab) hasil.push({ ...dasar, jenis: 'Kontrol 3 Bulan', jenisKode: 3, due: next3 });
        if (next6 && next6 > t.tanggal_lab) hasil.push({ ...dasar, jenis: 'Kontrol 6 Bulan', jenisKode: 6, due: next6 });
    }
    hasil.sort((a, b) => String(a.due).localeCompare(String(b.due)) || a.nama.localeCompare(b.nama));
    return hasil;
}

/* ---------- Status sebuah jadwal terhadap hari ini ---------- */
function labStatusJadwal(due, todayStr) {
    const today = todayStr || labTodayStr();
    const hari = labSelisihHari(today, due); // positif = masih akan datang
    if (hari < 0)   return { kode: 'terlambat', label: `Terlambat ${Math.abs(hari)} hr`, hari, cls: 'badge-red' };
    if (hari === 0) return { kode: 'hari_ini',  label: 'Hari Ini',                       hari, cls: 'badge-orange' };
    if (hari === 1) return { kode: 'h1',        label: 'Besok (H-1)',                    hari, cls: 'badge-orange' };
    if (hari <= 7)  return { kode: 'h7',        label: `${hari} hari lagi (H-${hari})`,  hari, cls: 'badge-blue' };
    return            { kode: 'terjadwal', label: `${hari} hari lagi`,                   hari, cls: 'badge-teal' };
}

/* ---------- WhatsApp ---------- */
function labWaNomor(telp) {
    let d = String(telp || '').replace(/\D/g, '');
    if (!d) return null;
    if (d.startsWith('0')) d = '62' + d.slice(1);
    else if (d.startsWith('8')) d = '62' + d;
    return d;
}
function labWaLink(telp, pesan) {
    const no = labWaNomor(telp);
    if (!no) return null;
    return `https://wa.me/${no}?text=${encodeURIComponent(pesan)}`;
}
function labPesanH7(nama, jenis, tglLabel) {
    return `Selamat pagi Bpk/Ibu ${nama} 🙏\n\n` +
        `Kami dari Klinik Imanuel ingin mengingatkan bahwa jadwal *pemeriksaan lab rutin (${jenis})* Bapak/Ibu adalah pada:\n` +
        `📅 *${tglLabel}*\n\n` +
        `Mohon hadir sesuai jadwal agar kondisi kesehatan Bapak/Ibu tetap terpantau dengan baik.\n\n` +
        `Terima kasih, Tuhan memberkati.\n— Klinik Imanuel`;
}
function labPesanH1(nama, tglLabel) {
    return `Selamat sore Bpk/Ibu ${nama} 🙏\n\n` +
        `Besok, *${tglLabel}*, adalah jadwal *pemeriksaan lab rutin* Bapak/Ibu.\n\n` +
        `Agar hasil pemeriksaan akurat, mohon *BERPUASA ±10–12 jam* sebelum pengambilan darah:\n` +
        `• Mulai puasa malam ini (± pukul 21.00)\n` +
        `• Air putih tetap diperbolehkan\n` +
        `• Obat rutin diminum sesuai anjuran dokter\n\n` +
        `Sampai jumpa besok. Terima kasih, Tuhan memberkati.\n— Klinik Imanuel`;
}
function labPesanTerlambat(nama, tglLabel) {
    return `Selamat pagi Bpk/Ibu ${nama} 🙏\n\n` +
        `Berdasarkan catatan kami, jadwal *pemeriksaan lab rutin* Bapak/Ibu pada *${tglLabel}* sudah terlewat.\n\n` +
        `Pemeriksaan lab rutin penting untuk memantau kondisi kesehatan Bapak/Ibu. ` +
        `Mohon kesediaannya datang ke Klinik Imanuel agar pemeriksaan dapat segera dilakukan.\n\n` +
        `Terima kasih, Tuhan memberkati.\n— Klinik Imanuel`;
}

/* ---------- Penilaian kepatuhan pasien ----------
   Setiap pemeriksaan (kecuali terakhir) punya jadwal berikutnya yang "diharapkan"
   (3 bulan untuk DM/HPT+DM, selain itu 6 bulan). Pemeriksaan berikutnya dianggap
   TEPAT WAKTU bila datang paling lambat jadwal + LAB_GRACE_HARI.
   Jika jadwal dari pemeriksaan terakhir sudah lewat > toleransi dan belum ada
   pemeriksaan baru, dihitung sebagai 1 kali "terlambat berjalan". */
function labHitungKepatuhan(records, todayStr) {
    const today = todayStr || labTodayStr();
    const detail = [];
    let tepat = 0;

    for (let i = 0; i < records.length - 1; i++) {
        const prev = records[i];
        const hit = labHitungJadwal(prev.diagnosa, prev.tanggal_lab);
        const jadwal = labPerluKontrol3(prev.diagnosa)
            ? (prev.next_3bln || hit.next3)
            : (prev.next_6bln || hit.next6);
        const aktual = records[i + 1].tanggal_lab;
        const selisih = labSelisihHari(jadwal, aktual); // positif = telat
        const ok = selisih !== null && selisih <= LAB_GRACE_HARI;
        if (ok) tepat++;
        detail.push({
            ke: i + 2,
            tglSebelum: prev.tanggal_lab,
            jadwal, aktual, selisih,
            status: ok ? (selisih < 0 ? 'Tepat (lebih awal)' : 'Tepat Waktu')
                       : `Terlambat ${selisih} hari`,
            ok
        });
    }

    // Jadwal berjalan dari pemeriksaan terakhir
    const akhir = records[records.length - 1];
    const hitAkhir = labHitungJadwal(akhir.diagnosa, akhir.tanggal_lab);
    const dueBerjalan = labPerluKontrol3(akhir.diagnosa)
        ? (akhir.next_3bln || hitAkhir.next3)
        : (akhir.next_6bln || hitAkhir.next6);
    const telatBerjalan = dueBerjalan ? labSelisihHari(dueBerjalan, today) : null; // positif = sudah lewat
    const pendingTelat = telatBerjalan !== null && telatBerjalan > LAB_GRACE_HARI;

    const total = detail.length + (pendingTelat ? 1 : 0);
    const persen = total ? Math.round((tepat / total) * 100) : null;

    let badge;
    if (total === 0)        badge = { label: 'Pasien Baru',  cls: 'badge-blue',   urut: 3 };
    else if (persen >= 80)  badge = { label: 'Rutin',        cls: 'badge-green',  urut: 2 };
    else if (persen >= 50)  badge = { label: 'Cukup Rutin',  cls: 'badge-orange', urut: 1 };
    else                    badge = { label: 'Kurang Rutin', cls: 'badge-red',    urut: 0 };

    return { jumlah: records.length, total, tepat, persen, badge, pendingTelat, telatBerjalan, dueBerjalan, detail };
}
