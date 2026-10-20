import { Resend } from "resend";

// Lazy so importing this module doesn't throw at build/import time when
// RESEND_API_KEY isn't set (Next collects route data at build time, which
// evaluates this module even though no email is actually sent then).
let cachedResend: Resend | null = null;
function getResend(): Resend {
  if (!cachedResend) cachedResend = new Resend(process.env.RESEND_API_KEY);
  return cachedResend;
}

const FROM = "Flipping Smiles <hello@flippingsmiles.com>";
const ADMIN_EMAIL = "rohit.bhoompally@gmail.com";

export async function sendAdminNewOrderNotification({
  orderId,
  heroName,
  bookTitle,
  cartoonReady,
}: {
  orderId: string;
  heroName: string;
  bookTitle: string;
  cartoonReady: boolean;
}) {
  const orderUrl = `https://kitabee-studio-production.up.railway.app/orders/${orderId}`;

  await getResend().emails.send({
    from: FROM,
    to: ADMIN_EMAIL,
    subject: `New order ready to generate — ${heroName}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 8px">New paid order 🎉</h2>
        <p style="color:#555;margin:0 0 24px">A new order is ready to generate.</p>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          <tr><td style="padding:8px 0;color:#888;font-size:13px">Hero</td><td style="padding:8px 0;font-weight:600">${heroName}</td></tr>
          <tr><td style="padding:8px 0;color:#888;font-size:13px">Book</td><td style="padding:8px 0">${bookTitle}</td></tr>
          <tr><td style="padding:8px 0;color:#888;font-size:13px">Character</td><td style="padding:8px 0">${cartoonReady ? "✅ Ready to generate" : "⚠️ Needs cartoon first"}</td></tr>
        </table>
        <a href="${orderUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
          Open order →
        </a>
      </div>
    `,
  });
}
