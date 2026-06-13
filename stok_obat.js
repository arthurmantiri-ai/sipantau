// Konfigurasi Supabase
const SUPABASE_URL = 'https://xbvnydbglqyqnhwddjvm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhidm55ZGJnbHF5cW5od2RkanZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3MzQwNTMsImV4cCI6MjA5NjMxMDA1M30.QRjVy7TSJi7vOeF3sZzsk1JSD0mg2NMhwBMlO4YrOv0';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// State Global
let masterObatData = [];
let riwayatTransaksiData = []; // Untuk menyimpan data laporan keuangan bulanan

// Fungsi Format Rupiah (Presisi Desimal 2 angka di belakang koma)
function formatRp(angka) {
    return new Intl.NumberFormat('id-ID', { 
        style: 'currency', 
        currency: 'IDR', 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    }).format(angka || 0);
}

// --- LOGIKA AUTHENTICATION ---
const overlay = document.getElementById('authOverlay');
const mainApp = document.getElementById('mainApp');
const btnMasuk = document.getElementById('btnMasuk');
const passInput = document.getElementById('farmasiPassword');

function checkAuth() {
    if (passInput.value === 'farmasiimanuel') {
        overlay.style.display = 'none';
        mainApp.style.display = 'block';
        initApp();
    } else {
        document.getElementById('authError').style.display = 'block';
        passInput.style.borderColor = 'var(--danger)';
    }
}
btnMasuk.addEventListener('click', checkAuth);
passInput.addEventListener('keypress', function(e) { if (e.key === 'Enter') checkAuth(); });

// --- INISIALISASI ---
function initApp() {
    updateWaktu();
    setInterval(updateWaktu, 60000);
    
    // Set default export tanggal (awal bulan ini s/d hari ini)
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById('exportMulai').value = firstDay.toISOString().split('T')[0];
    document.getElementById('exportSelesai').value = today.toISOString().split('T')[0];

    fetchDataObat();
    fetchRiwayatLaporan();
}

function updateWaktu() {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('currentTime').innerText = new Date().toLocaleDateString('id-ID', options);
}

// --- AMBIL & TAMPILKAN DATA BATCH ---
async function fetchDataObat() {
    const { data, error } = await db.from('master_stok_apotek')
        .select('*')
        .order('nama_obat', { ascending: true })
        .order('tgl_expired', { ascending: true });
    
    if (error) {
        console.error("Error fetching master data:", error);
        return;
    }

    masterObatData = data || [];
    renderTabel(masterObatData);
    updateDashboardStokFisik();
    updateAnalytics();
    populateDropdownKeluar();
    populateDatalists();
}

// --- AMBIL DATA RIWAYAT UNTUK LAPORAN KEUANGAN ---
async function fetchRiwayatLaporan() {
    const { data, error } = await db.from('riwayat_transaksi_apotek').select('*');
    
    if (error) {
        console.error("Pastikan Anda sudah membuat tabel 'riwayat_transaksi_apotek' di Supabase!", error);
        return;
    }

    riwayatTransaksiData = data || [];
    kalkulasiLaporanAkhirBulan();
}

function renderTabel(dataList) {
    const tbody = document.getElementById('tabelObatBody');
    tbody.innerHTML = '';

    if (dataList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Belum ada data batch stok obat.</td></tr>';
        return;
    }

    const today = new Date();

    dataList.forEach(obat => {
        let expDate = new Date(obat.tgl_expired);
        let badgeHtml = '';
        
        if (expDate <= today) {
            badgeHtml = '<span class="badge badge-danger">Kadaluarsa</span>';
        } else if (obat.stok === 0) {
            badgeHtml = '<span class="badge badge-danger">Kosong</span>';
        } else if (obat.stok < 10) {
            badgeHtml = '<span class="badge badge-warn">Menipis</span>';
        } else {
            badgeHtml = '<span class="badge badge-ok">Aman</span>';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${obat.nama_obat}</strong><br><small style="color:var(--text-muted)">${obat.keterangan || '-'}</small></td>
            <td style="color:var(--primary); font-weight:600">${formatRp(obat.harga_beli)}</td>
            <td>${obat.distributor}</td>
            <td style="font-family: monospace;">${new Date(obat.tgl_expired).toLocaleDateString('id-ID')}</td>
            <td><strong style="font-size:1.1rem">${obat.stok}</strong> <small>${obat.satuan}</small></td>
            <td>${badgeHtml}</td>
            <td style="text-align: center;">
                <button type="button" class="btn-delete-row" onclick="hapusBatchObat('${obat.id}', '${obat.nama_obat.replace(/'/g, "\\'")}')" title="Hapus/Koreksi Batch Ini">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateDashboardStokFisik() {
    const today = new Date();
    const countAktif = masterObatData.length;
    const countMenipis = masterObatData.filter(o => o.stok > 0 && o.stok < 10).length;
    const countExpired = masterObatData.filter(o => new Date(o.tgl_expired) <= today && o.stok > 0).length;

    document.getElementById('totalBatch').innerText = countAktif;
    document.getElementById('stokMenipis').innerText = countMenipis;
    document.getElementById('obatExpired').innerText = countExpired;
}

// --- KALKULASI LAPORAN 4 KARTU KEUANGAN ---
function kalkulasiLaporanAkhirBulan() {
    const today = new Date();
    const awalBulanIni = new Date(today.getFullYear(), today.getMonth(), 1); // Tanggal 1 bulan ini jam 00:00
    
    let asetLalu = 0;
    let beliIni = 0;
    let jualIni = 0;

    riwayatTransaksiData.forEach(tx => {
        const txDate = new Date(tx.created_at);
        const nilai = parseFloat(tx.total_nilai) || 0;

        // Jika transaksi terjadi SEBELUM bulan ini (Bulan lalu dan sebelumnya)
        if (txDate < awalBulanIni) {
            if (tx.jenis === 'Masuk') asetLalu += nilai;
            if (tx.jenis === 'Keluar') asetLalu -= nilai;
        } 
        // Jika transaksi terjadi PADA bulan ini
        else {
            if (tx.jenis === 'Masuk') beliIni += nilai;
            if (tx.jenis === 'Keluar') jualIni += nilai;
        }
    });

    // Kalkulasi Total yang Tersedia (Modal bulan lalu + Modal suntikan beli bulan ini)
    const totalTersedia = asetLalu + beliIni;

    document.getElementById('asetBulanLaluRp').innerText = formatRp(asetLalu);
    document.getElementById('pembelianBulanIniRp').innerText = formatRp(beliIni);
    document.getElementById('penjualanBulanIniRp').innerText = formatRp(jualIni);
    document.getElementById('totalTersediaRp').innerText = formatRp(totalTersedia);
}

// --- FITUR ANALITIK ---
function updateAnalytics() {
    const obatMap = {};
    masterObatData.forEach(o => {
        if (!obatMap[o.nama_obat]) obatMap[o.nama_obat] = 0;
        obatMap[o.nama_obat] += o.stok;
    });

    const topObatArray = Object.keys(obatMap).map(key => { return { nama: key, total: obatMap[key] }; });
    topObatArray.sort((a, b) => b.total - a.total);
    const top10 = topObatArray.slice(0, 10);

    const ulTopObat = document.getElementById('topObatList');
    ulTopObat.innerHTML = top10.length === 0 ? '<li>Belum ada data</li>' : '';
    top10.forEach((item, index) => {
        ulTopObat.innerHTML += `<li><span>${index + 1}. ${item.nama}</span> <span class="badge-count">${item.total}</span></li>`;
    });

    const distMap = {};
    masterObatData.forEach(o => {
        const dist = o.distributor;
        if (!distMap[dist]) distMap[dist] = new Set();
        distMap[dist].add(o.nama_obat);
    });

    const distArray = Object.keys(distMap).map(key => { return { nama: key, jumlah_jenis: distMap[key].size }; });
    distArray.sort((a, b) => b.jumlah_jenis - a.jumlah_jenis);

    const ulDistributor = document.getElementById('distributorStatList');
    ulDistributor.innerHTML = distArray.length === 0 ? '<li>Belum ada data</li>' : '';
    distArray.forEach(item => {
        ulDistributor.innerHTML += `<li><span>${item.nama}</span> <span class="badge-count">${item.jumlah_jenis} Jenis Obat</span></li>`;
    });
}

// --- EXPORT TO EXCEL ---
function exportToExcel() {
    const tglMulai = document.getElementById('exportMulai').value;
    const tglSelesai = document.getElementById('exportSelesai').value;

    if (!tglMulai || !tglSelesai) {
        alert("Pilih rentang tanggal terlebih dahulu!");
        return;
    }

    const filteredData = masterObatData.filter(obat => {
        if (!obat.created_at) return true;
        const tglBuat = obat.created_at.split('T')[0];
        return tglBuat >= tglMulai && tglBuat <= tglSelesai;
    });

    if (filteredData.length === 0) {
        alert("Tidak ada data obat masuk pada rentang tanggal tersebut.");
        return;
    }

    const excelData = filteredData.map(o => ({
        "Tanggal Input": o.created_at ? new Date(o.created_at).toLocaleDateString('id-ID') : "-",
        "Nama Obat": o.nama_obat,
        "Stok (Saat ini)": o.stok,
        "Satuan": o.satuan,
        "Harga Beli": o.harga_beli,
        "Distributor": o.distributor,
        "Tanggal Expired": new Date(o.tgl_expired).toLocaleDateString('id-ID'),
        "Keterangan": o.keterangan || "-"
    }));

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stok_Apotek");
    XLSX.writeFile(wb, `Laporan_Stok_Farmasi_${tglMulai}_sd_${tglSelesai}.xlsx`);
}

// --- DATALISTS & DROPDOWN ---
function populateDatalists() {
    const dataListObat = document.getElementById('namaObatList');
    dataListObat.innerHTML = '';
    const uniqueNames = [...new Set(masterObatData.map(item => item.nama_obat))];
    uniqueNames.forEach(nama => {
        const option = document.createElement('option'); option.value = nama; dataListObat.appendChild(option);
    });

    const dataListDist = document.getElementById('distributorList');
    dataListDist.innerHTML = '';
    const uniqueDist = [...new Set(masterObatData.map(item => item.distributor))];
    uniqueDist.forEach(dist => {
        const option = document.createElement('option'); option.value = dist; dataListDist.appendChild(option);
    });
}

function populateDropdownKeluar() {
    const select = document.getElementById('out_obat_id');
    select.innerHTML = '<option value="" disabled selected>-- Pilih Obat & Batch Expired --</option>';
    
    const tersedia = masterObatData.filter(o => o.stok > 0);
    tersedia.forEach(obat => {
        const tglExp = new Date(obat.tgl_expired).toLocaleDateString('id-ID');
        const opt = document.createElement('option');
        opt.value = obat.id;
        
        // Menyimpan data penting agar bisa dibaca saat obat dikeluarkan
        opt.dataset.stok = obat.stok;
        opt.dataset.harga = obat.harga_beli; 
        opt.dataset.nama = obat.nama_obat;

        opt.textContent = `${obat.nama_obat} | Exp: ${tglExp} | Stok: ${obat.stok} ${obat.satuan}`;
        select.appendChild(opt);
    });
}

// --- PENCARIAN ---
document.getElementById('searchInput').addEventListener('input', function(e) {
    const keyword = e.target.value.toLowerCase();
    const filtered = masterObatData.filter(obat => 
        obat.nama_obat.toLowerCase().includes(keyword) || 
        obat.distributor.toLowerCase().includes(keyword)
    );
    renderTabel(filtered);
});

// --- PENGATURAN MODAL ---
const mMasuk = document.getElementById('modalMasuk');
const mKeluar = document.getElementById('modalKeluar');

document.getElementById('btnObatMasuk').onclick = () => mMasuk.classList.add('show');
document.getElementById('btnObatKeluar').onclick = () => mKeluar.classList.add('show');

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.onclick = function() {
        mMasuk.classList.remove('show');
        mKeluar.classList.remove('show');
    }
});

// --- LOGIKA OBAT MASUK (DOBEL INSERT: STOK & RIWAYAT) ---
document.getElementById('formMasuk').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const nama = document.getElementById('in_nama').value.trim();
    const satuan = document.getElementById('in_satuan').value.trim();
    const harga = parseFloat(document.getElementById('in_harga').value); 
    const distributor = document.getElementById('in_distributor').value.trim();
    const expired = document.getElementById('in_expired').value;
    const jumlahMasuk = parseInt(document.getElementById('in_jumlah').value);
    const keterangan = document.getElementById('in_keterangan').value.trim();
    const totalNilai = jumlahMasuk * harga;

    const existingBatch = masterObatData.find(o => 
        o.nama_obat.toLowerCase() === nama.toLowerCase() &&
        o.tgl_expired === expired &&
        o.distributor.toLowerCase() === distributor.toLowerCase() &&
        o.harga_beli === harga
    );

    // 1. UPDATE/INSERT KE MASTER STOK
    if (existingBatch) {
        const stokBaru = existingBatch.stok + jumlahMasuk;
        await db.from('master_stok_apotek').update({ stok: stokBaru }).eq('id', existingBatch.id);
    } else {
        const newData = {
            nama_obat: nama, satuan: satuan, harga_beli: harga, distributor: distributor,
            tgl_expired: expired, stok: jumlahMasuk, keterangan: keterangan
        };
        await db.from('master_stok_apotek').insert([newData]);
    }

    // 2. INSERT KE TABEL RIWAYAT TRANSAKSI (Untuk Laporan Keuangan)
    const riwayatData = {
        nama_obat: nama,
        jenis: 'Masuk',
        jumlah: jumlahMasuk,
        harga_beli: harga,
        total_nilai: totalNilai
    };
    const { error: errRiwayat } = await db.from('riwayat_transaksi_apotek').insert([riwayatData]);

    if (errRiwayat) {
        alert("Peringatan: Gagal mencatat riwayat transaksi. Laporan keuangan tidak bertambah. " + errRiwayat.message);
    } else {
        alert("Batch obat masuk berhasil ditambahkan dan dicatat di laporan keuangan!");
    }

    this.reset();
    mMasuk.classList.remove('show');
    
    // Refresh kedua data agar UI terupdate
    fetchDataObat(); 
    fetchRiwayatLaporan();
});

// --- LOGIKA OBAT KELUAR (DOBEL INSERT: STOK & RIWAYAT) ---
document.getElementById('formKeluar').addEventListener('submit', async function(e) {
    e.preventDefault();

    const selectObat = document.getElementById('out_obat_id');
    const obatId = selectObat.value;
    const optionSelected = selectObat.options[selectObat.selectedIndex];
    
    const stokSaatIni = parseInt(optionSelected.dataset.stok);
    const hargaBeliObatIni = parseFloat(optionSelected.dataset.harga);
    const namaObatIni = optionSelected.dataset.nama;

    const jumlahKeluar = parseInt(document.getElementById('out_jumlah').value);
    const keterangan = document.getElementById('out_keterangan').value;
    const totalNilaiKeluar = jumlahKeluar * hargaBeliObatIni;

    if (jumlahKeluar > stokSaatIni) {
        alert(`Stok pada batch ini tidak cukup! (Sisa: ${stokSaatIni}). Silakan ambil sisanya dari batch lain jika perlu.`);
        return;
    }

    const stokBaru = stokSaatIni - jumlahKeluar;

    // 1. UPDATE PENGURANGAN DI MASTER STOK
    await db.from('master_stok_apotek').update({ stok: stokBaru, keterangan: keterangan }).eq('id', obatId);

    // 2. INSERT PENGURANGAN KE TABEL RIWAYAT TRANSAKSI (Untuk Laporan Penjualan)
    const riwayatDataOut = {
        nama_obat: namaObatIni,
        jenis: 'Keluar',
        jumlah: jumlahKeluar,
        harga_beli: hargaBeliObatIni,
        total_nilai: totalNilaiKeluar
    };
    const { error: errRiwayatOut } = await db.from('riwayat_transaksi_apotek').insert([riwayatDataOut]);

    if (errRiwayatOut) {
        alert("Peringatan: Obat dikeluarkan tapi gagal mencatat riwayat keuangan. " + errRiwayatOut.message);
    } else {
        alert(`Obat berhasil dikeluarkan. Penjualan tercatat.`);
    }

    this.reset();
    mKeluar.classList.remove('show');
    
    // Refresh kedua data agar UI terupdate
    fetchDataObat();
    fetchRiwayatLaporan();
});

// --- FUNGSI HAPUS DATA BATCH (KOREKSI KESALAHAN INPUT) ---
async function hapusBatchObat(id, namaObat) {
    const konfirmasi = confirm(`PERINGATAN KOREKSI DATA!\n\nApakah Anda yakin ingin menghapus seluruh data batch untuk obat "${namaObat}" ini?\n\n(Catatan: Menghapus batch master tidak akan menghapus nilai asetnya di Laporan Keuangan secara otomatis. Jika ini salah input dari awal, laporkan pada admin database).`);
    
    if (konfirmasi) {
        const { error } = await db.from('master_stok_apotek').delete().eq('id', id);
        if (error) {
            alert("Gagal menghapus data: " + error.message);
        } else {
            alert("Data batch berhasil dihapus dari sistem.");
            fetchDataObat(); 
        }
    }
}