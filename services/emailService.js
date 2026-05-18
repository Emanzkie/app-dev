const nodemailer = require('nodemailer');

async function sendInvitationEmail({ to, code, child = {}, inviter = {}, expiresAt = null }) {
  if (!to) throw new Error('Recipient email is required');

  const frontend = process.env.FRONTEND_URL || 'http://localhost:3000';
  const acceptUrl = `${frontend.replace(/\/$/, '')}/accept-invitation?code=${encodeURIComponent(code)}`;
  const subject = `You're invited to access ${child.firstName || "a child's"} KinderCura profile`;
  const text = `Hello,\n\nYou have been invited to access ${child.firstName || "a child's"} KinderCura profile.\n\nUse this code to accept the invitation: ${code}\n\nOr click the link to accept: ${acceptUrl}\n\nThis invitation${expiresAt ? ` expires on ${new Date(expiresAt).toLocaleString()}` : ''}.\n\nThanks,\n${process.env.EMAIL_FROM_NAME || 'KinderCura'}`;
  const html = `<p>Hello,</p><p>You have been invited to access <strong>${child.firstName || "a child's"}</strong> KinderCura profile.</p><p><strong>Invitation code:</strong> ${code}</p><p>Or click to accept: <a href="${acceptUrl}">${acceptUrl}</a></p>${expiresAt ? `<p>Expires: ${new Date(expiresAt).toLocaleString()}</p>` : ''}<p>Thanks,<br/>${process.env.EMAIL_FROM_NAME || 'KinderCura'}</p>`;

  // If SMTP credentials are not available, log and skip sending to avoid throwing in production.
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('Email credentials not configured (EMAIL_USER/EMAIL_PASS). Skipping send.');
    console.info('Email preview:', { to, subject, text });
    return { skipped: true };
  }

  const transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mail = {
    from: `${process.env.EMAIL_FROM_NAME || 'KinderCura'} <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
  };

  const info = await transporter.sendMail(mail);
  return info;
}

module.exports = { sendInvitationEmail };
