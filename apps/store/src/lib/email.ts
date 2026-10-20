import { Resend } from "resend";

// Lazy so importing this module doesn't throw at build/import time when
// RESEND_API_KEY isn't set (e.g. Next collects route data at build time,
// which evaluates this module even though no email is actually sent then).
let cachedResend: Resend | null = null;
function getResend(): Resend {
  if (!cachedResend) cachedResend = new Resend(process.env.RESEND_API_KEY);
  return cachedResend;
}

const FROM = "Flipping Smiles <hello@flippingsmiles.com>";

export async function sendOrderConfirmation({
  to,
  heroName,
  bookTitle,
  orderId,
}: {
  to: string;
  heroName: string;
  bookTitle: string;
  orderId: string;
}) {
  const orderUrl = `https://flippingsmiles.com/orders/${orderId}`;

  await getResend().emails.send({
    from: FROM,
    to,
    subject: `Your order is confirmed — ${heroName}'s book is on its way!`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h1 style="font-size:24px;margin:0 0 8px">Order confirmed! 🎉</h1>
        <p style="color:#555;margin:0 0 24px;line-height:1.6">
          We're creating <strong>${heroName}</strong>'s personalised copy of <strong>${bookTitle}</strong>.
          Our team is hand-crafting each page — we'll email you again when it's ready to ship.
        </p>

        <div style="background:#f9f7f4;border-radius:12px;padding:20px;margin-bottom:24px">
          <p style="margin:0 0 8px;font-size:13px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">What happens next</p>
          <ol style="margin:0;padding-left:20px;color:#444;font-size:14px;line-height:2">
            <li>Our team personalises each page with ${heroName} as the hero</li>
            <li>We send it to print (estimated 3–5 business days)</li>
            <li>Your book ships directly to your door</li>
          </ol>
        </div>

        <p style="font-size:13px;color:#888;margin:0 0 24px">
          Order reference: <span style="font-family:monospace;color:#555">${orderId.slice(0, 8).toUpperCase()}</span>
        </p>

        <a href="${orderUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px">
          View your order →
        </a>

        <p style="font-size:12px;color:#aaa;margin-top:32px">
          Questions? Reply to this email or reach us at hello@flippingsmiles.com
        </p>
      </div>
    `,
  });
}

export async function sendShippingNotification({
  to,
  heroName,
  bookTitle,
  orderId,
  trackingNumber,
  trackingUrl,
  carrierName,
}: {
  to: string;
  heroName: string;
  bookTitle: string;
  orderId: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrierName: string | null;
}) {
  const orderUrl = `https://flippingsmiles.com/orders/${orderId}`;

  await getResend().emails.send({
    from: FROM,
    to,
    subject: `${heroName}'s book has shipped! 📦`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h1 style="font-size:24px;margin:0 0 8px">It's on its way! 📦</h1>
        <p style="color:#555;margin:0 0 24px;line-height:1.6">
          <strong>${heroName}</strong>'s copy of <strong>${bookTitle}</strong> has shipped and is headed to your door.
        </p>

        ${trackingNumber ? `
        <div style="background:#f9f7f4;border-radius:12px;padding:20px;margin-bottom:24px">
          <p style="margin:0 0 4px;font-size:13px;color:#888;font-weight:600;text-transform:uppercase;letter-spacing:0.05em">Tracking</p>
          <p style="margin:0;font-size:14px;color:#444">
            ${carrierName ? `${carrierName} — ` : ""}<span style="font-family:monospace">${trackingNumber}</span>
          </p>
        </div>` : ""}

        ${trackingUrl ? `
        <a href="${trackingUrl}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px;margin-right:8px">
          Track your package →
        </a>` : ""}
        <a href="${orderUrl}" style="display:inline-block;color:#1a1a1a;text-decoration:underline;padding:12px 0;font-weight:600;font-size:14px">
          View your order
        </a>

        <p style="font-size:12px;color:#aaa;margin-top:32px">
          Questions? Reply to this email or reach us at hello@flippingsmiles.com
        </p>
      </div>
    `,
  });
}
