// ============================================================================
//  Netlify Function — KIRIM INVOICE VIA WHATSAPP (Twilio)
//  Endpoint (otomatis): /.netlify/functions/send-whatsapp  (POST { invoiceId })
//
//  Alur:
//   1. Baca invoice dari Supabase (service_role)
//   2. Buat signed URL PDF (berlaku 7 hari) — Twilio mengambil file dari URL ini
//   3. Kirim pesan WhatsApp + PDF (mediaUrl) via Twilio
//   4. Tandai invoices.whatsapp_sent_at
//
//  Catatan:
//   - whatsapp-web.js TIDAK dipakai di sini karena butuh proses server yang
//     hidup terus + login QR (tidak cocok dengan serverless Netlify).
//   - Untuk pengiriman TANPA API, halaman generate.html sudah menyediakan
//     tombol "Buka WhatsApp (manual)" berbasis link wa.me.
//   - Nomor pengirim (TWILIO_WHATSAPP_FROM) memakai sandbox Twilio saat uji coba;
//     untuk produksi, daftarkan WhatsApp Sender resmi di Twilio.
// ============================================================================

const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmtRp = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

// 0812.. / +62.. / 62.. -> 62812..
function normalizeWa(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (!d.startsWith('62')) d = '62' + d;
  return d;
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const resp = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });

  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });

  try {
    const { invoiceId } = JSON.parse(event.body || '{}');
    if (!invoiceId) return resp(400, { error: 'invoiceId wajib diisi' });

    // 1) Ambil invoice
    const { data: inv, error: e1 } = await supabase
      .from('invoices').select('*').eq('id', invoiceId).single();
    if (e1 || !inv) return resp(404, { error: 'Invoice tidak ditemukan' });
    if (!inv.customer_whatsapp) return resp(400, { error: 'Nomor WhatsApp kosong' });
    if (!inv.pdf_path)          return resp(400, { error: 'PDF invoice belum dibuat' });

    // 2) Signed URL 7 hari agar Twilio bisa mengambil PDF
    const { data: signed, error: e2 } = await supabase
      .storage.from('invoices').createSignedUrl(inv.pdf_path, 60 * 60 * 24 * 7);
    if (e2 || !signed) return resp(500, { error: 'Gagal membuat link PDF' });

    // 3) Kirim via Twilio
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const to = 'whatsapp:+' + normalizeWa(inv.customer_whatsapp);
    const from = process.env.TWILIO_WHATSAPP_FROM; // mis. 'whatsapp:+14155238886'
    const brand = process.env.BUSINESS_NAME || 'kami';

    const body =
      `Halo ${inv.customer_name}, berikut invoice *${inv.invoice_number}* dari ${brand}. ` +
      `Total: *${fmtRp(inv.total)}*. Terima kasih 🙏`;

    const message = await client.messages.create({
      from, to, body,
      mediaUrl: [signed.signedUrl], // PDF tampil sebagai dokumen di WhatsApp
    });

    // 4) Catat waktu kirim
    await supabase.from('invoices')
      .update({ whatsapp_sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', invoiceId);

    return resp(200, { ok: true, message: 'WhatsApp terkirim', sid: message.sid });
  } catch (err) {
    console.error('send-whatsapp error:', err);
    return resp(500, { error: err.message || String(err) });
  }
};
