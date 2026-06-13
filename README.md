# Sistem Informasi Klinik Imanuel

Aplikasi manajemen klinik berbasis web (static HTML/CSS/JS).

## Stack
- Frontend: HTML, CSS, JavaScript (static, tanpa build step)
- Database & Auth: Supabase (terhubung langsung dari browser via anon key)
- Hosting: Netlify (auto-deploy dari branch `main`)

## Halaman
- `index.html` — Login / halaman utama
- `dashboard.html` — Dashboard
- `poli_umum.html`, `poli_gigi.html` — Pelayanan poli
- `stok_obat.html` — Manajemen stok obat
- `obat_kronis.html`, `pasien_kontrol.html`, `rujukan.html` — Modul pasien
- `laporan_admin.html`, `laporan_keuangan.html`, `laporan_puskesmas.html` — Laporan

## Deploy
Push ke branch `main` → Netlify otomatis build & deploy.

## Catatan keamanan
- Jangan commit `api_keys.txt` atau file `.env` (sudah ada di `.gitignore`).
- Supabase anon key di dalam kode bersifat publik — pastikan Row Level Security (RLS) aktif di semua tabel Supabase.
