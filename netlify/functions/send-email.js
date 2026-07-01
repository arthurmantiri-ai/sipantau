// ============================================================================
//  Netlify Function — KIRIM INVOICE VIA EMAIL
//  Endpoint (otomatis): /.netlify/functions/send-email   (POST { invoiceId })
//
//  Alur:
//   1. Baca invoice dari Supabase (pakai SERVICE ROLE key → bypass RLS, aman di server)
//   2. Unduh file PDF dari Storage bucket 'invoices'
//   3. Kirim email + lampiran PDF via SMTP (Nodemailer)
//   4. Tandai invoices.email_sent_at
//
//  Semua kredensial diambil dari Environment Variables Netlify (BUKAN di kode).
// ============================================================================

const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');

// Klien Supabase server-side (service_role) — hanya hidup di server Netlify
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmtRp = (n) => 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  const resp = (code, obj) => ({ statusCode: code, headers, body: JSON.stringify(obj) });

  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });

  try {
    const { invoiceId } = JSON.parse(event.body || '{}');
    if (!invoiceId) return resp(400, { error: 'invoiceId wajib diisi' });

    // 1) Ambil data invoice
    const { data: inv, error: e1 } = await supabase
      .from('invoices').select('*').eq('id', invoiceId).single();
    if (e1 || !inv) return resp(404, { error: 'Invoice tidak ditemukan' });
    if (!inv.customer_email) return resp(400, { error: 'Email pelanggan kosong' });
    if (!inv.pdf_path)       return resp(400, { error: 'PDF invoice belum dibuat' });

    // 2) Unduh PDF dari Storage
    const { data: file, error: e2 } = await supabase
      .storage.from('invoices').download(inv.pdf_path);
    if (e2 || !file) return resp(500, { error: 'Gagal mengambil PDF: ' + (e2?.message || '') });
    const pdfBuffer = Buffer.from(await file.arrayBuffer());

    // 3) Kirim email + lampiran
    //    Nodemailer mendukung SMTP apa pun (Gmail, Zoho, Mailgun, SendGrid, dll).
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true', // true = port 465
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    const fromName = process.env.BUSINESS_NAME || 'Invoice';
    const from = process.env.MAIL_FROM || `${fromName} <${process.env.SMTP_USER}>`;

    await transporter.sendMail({
      from,
      to: inv.customer_email,
      subject: `Invoice ${inv.invoice_number} — ${fromName}`,
      text:
        `Halo ${inv.customer_name},\n\n` +
        `Terlampir invoice ${inv.invoice_number} dengan total ${fmtRp(inv.total)}.\n\n` +
        `Terima kasih.\n${fromName}`,
      html:
        `<p>Halo <b>${inv.customer_name}</b>,</p>` +
        `<p>Terlampir invoice <b>${inv.invoice_number}</b> dengan total <b>${fmtRp(inv.total)}</b>.</p>` +
        `<p>Terima kasih.<br>${fromName}</p>`,
      attachments: [
        { filename: `${inv.invoice_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
      ],
    });

    // 4) Catat waktu kirim
    await supabase.from('invoices')
      .update({ email_sent_at: new Date().toISOString(), status: 'sent' })
      .eq('id', invoiceId);

    return resp(200, { ok: true, message: 'Email terkirim' });
  } catch (err) {
    console.error('send-email error:', err);
    return resp(500, { error: err.message || String(err) });
  }
};
