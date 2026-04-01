// config/email.js
const nodemailer = require('nodemailer');
const logger     = require('./logger');

let transporter = null;

const initEmail = () => {
  if (transporter) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SENDGRID_API_KEY } = process.env;

  // SendGrid
  if (SENDGRID_API_KEY) {
    transporter = nodemailer.createTransport({
      host:   'smtp.sendgrid.net',
      port:   587,
      secure: false,
      auth:   { user: 'apikey', pass: SENDGRID_API_KEY },
    });
    logger.info('Email: SendGrid initialized');
    return transporter;
  }

  // Generic SMTP
  if (SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host:   SMTP_HOST,
      port:   parseInt(SMTP_PORT || '587'),
      secure: SMTP_PORT === '465',
      auth:   { user: SMTP_USER, pass: SMTP_PASS },
    });
    logger.info('Email: SMTP initialized');
    return transporter;
  }

  // Dev fallback — Ethereal (logs email URL to console)
  nodemailer.createTestAccount().then(account => {
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email', port: 587, secure: false,
      auth: { user: account.user, pass: account.pass },
    });
    logger.info('Email: Ethereal test account ready', { user: account.user });
  });

  return null;
};

const EMAIL_TEMPLATES = {
  booking_confirmed: (job) => ({
    subject: `Honda Service Booking Confirmed – ${job.id}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">
        <div style="background:#E40521;padding:24px 32px">
          <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:2px">HONDA</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px">Door-to-Door Service</p>
        </div>
        <div style="padding:32px">
          <h2 style="color:#111;margin:0 0 8px">Booking Confirmed ✓</h2>
          <p style="color:#6B7280;margin:0 0 24px">Your service request has been received.</p>
          <div style="background:#F9FAFB;border-radius:8px;padding:20px;margin-bottom:24px">
            <table style="width:100%;border-collapse:collapse">
              ${[
                ['Reference', job.id],
                ['Vehicle',   `${job.year} ${job.model} – ${job.plate}`],
                ['Service',   job.service_type],
                ['Pickup',    job.pickup_address],
                ['Date',      job.scheduled_pickup_at ? new Date(job.scheduled_pickup_at).toLocaleDateString('en-AE') : 'To be confirmed'],
              ].map(([l,v]) => `<tr><td style="padding:8px 0;color:#6B7280;font-size:13px;width:140px">${l}</td><td style="padding:8px 0;color:#111;font-size:13px;font-weight:600">${v}</td></tr>`).join('')}
            </table>
          </div>
          <p style="color:#6B7280;font-size:13px">Our coordinator will contact you shortly to confirm the pickup time.</p>
        </div>
        <div style="background:#F9FAFB;padding:20px 32px;border-top:1px solid #E5E7EB">
          <p style="margin:0;color:#9CA3AF;font-size:12px">Honda Door-to-Door Service · UAE · support@honda-uae.com</p>
        </div>
      </div>
    `,
  }),

  waiting_approval: (job, quotation) => ({
    subject: `Action Required: Service Quotation AED ${quotation.total_amount} – ${job.id}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff">
        <div style="background:#E40521;padding:24px 32px">
          <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:2px">HONDA</h1>
        </div>
        <div style="padding:32px">
          <h2 style="color:#111;margin:0 0 8px">Your Service Quotation is Ready</h2>
          <p style="color:#6B7280;margin:0 0 24px">Please review and approve to proceed with your service.</p>
          <div style="background:#F9FAFB;border-radius:8px;padding:20px;margin-bottom:20px">
            ${(quotation.items||[]).map(item => `
              <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #E5E7EB">
                <span style="color:#374151;font-size:13px">${item.name}</span>
                <span style="color:#111;font-size:13px;font-weight:600">${item.unit_price===0?'FREE':'AED '+item.unit_price}</span>
              </div>
            `).join('')}
            <div style="display:flex;justify-content:space-between;padding:14px 0 0;margin-top:4px;border-top:2px solid #111">
              <span style="font-size:16px;font-weight:700;color:#111">TOTAL ESTIMATE</span>
              <span style="font-size:20px;font-weight:700;color:#E40521">AED ${quotation.total_amount}</span>
            </div>
          </div>
          <div style="display:flex;gap:12px">
            <a href="${process.env.FRONTEND_URL}" style="flex:1;display:block;text-align:center;padding:14px;background:#E40521;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Review & Approve</a>
          </div>
        </div>
        <div style="background:#F9FAFB;padding:20px 32px;border-top:1px solid #E5E7EB">
          <p style="margin:0;color:#9CA3AF;font-size:12px">Honda Door-to-Door Service · UAE</p>
        </div>
      </div>
    `,
  }),

  driver_assigned: (job) => ({
    subject: `Your Driver is Assigned – ${job.id}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#E40521;padding:24px 32px">
          <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:2px">HONDA</h1>
        </div>
        <div style="padding:32px">
          <h2 style="color:#111;margin:0 0 8px">Driver Assigned ✓</h2>
          <p style="color:#6B7280;margin:0 0 24px">Your vehicle will be collected soon.</p>
          <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:20px">
            <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111">${job.driver_name}</p>
            <p style="margin:0;font-size:13px;color:#6B7280">${job.driver_phone}</p>
          </div>
        </div>
      </div>
    `,
  }),

  delivered: (job) => ({
    subject: `Your Honda is Back! Service Complete – ${job.id}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#E40521;padding:24px 32px">
          <h1 style="color:#fff;margin:0;font-size:24px;letter-spacing:2px">HONDA</h1>
        </div>
        <div style="padding:32px">
          <h2 style="color:#111;margin:0 0 8px">Service Complete 🎉</h2>
          <p style="color:#6B7280;margin:0 0 24px">Your ${job.year} ${job.model} has been returned. Thank you for choosing Honda Door-to-Door Service.</p>
          <a href="${process.env.FRONTEND_URL}" style="display:inline-block;padding:14px 28px;background:#E40521;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Rate Your Experience →</a>
        </div>
      </div>
    `,
  }),
};

const sendEmail = async ({ to, templateKey, job, quotation }) => {
  const t = initEmail();
  if (!t) { logger.warn('Email: transporter not ready'); return null; }

  const template = EMAIL_TEMPLATES[templateKey];
  if (!template) { logger.warn('Email: unknown template', { templateKey }); return null; }

  const { subject, html } = template(job, quotation);
  const FROM = process.env.EMAIL_FROM || 'noreply@honda-uae.com';

  try {
    const info = await t.sendMail({ from: `Honda Service <${FROM}>`, to, subject, html });
    if (info.messageId) logger.info('Email sent', { to, subject, messageId: info.messageId });
    // Ethereal preview
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) logger.info('Email preview (dev):', { url: preview });
    return info;
  } catch (err) {
    logger.error('Email send failed', { err: err.message, to, templateKey });
    return null;
  }
};

module.exports = { sendEmail, initEmail };
