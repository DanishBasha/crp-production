import nodemailer, { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../config/env';

let _resend: Resend | null = null;
let _transporter: Transporter | null = null;

function getResend(): Resend {
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

function getSmtpTransporter(): Transporter {
  if (!_transporter) {
    const isGmail = env.SMTP_HOST === 'smtp.gmail.com' || env.EMAIL_PROVIDER === 'gmail';
    if (isGmail) {
      _transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: false
        }
      });
    } else {
      _transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
        tls: {
          rejectUnauthorized: false
        }
      });
    }
  }
  return _transporter;
}

async function dispatchEmail(to: string, subject: string, html: string): Promise<void> {
  // 1. Try Gmail / SMTP if configured
  if (env.SMTP_USER && env.SMTP_PASS) {
    try {
      const transporter = getSmtpTransporter();
      const fromAddress = env.SMTP_FROM || `"${env.APP_NAME}" <${env.SMTP_USER}>`;
      await transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        html,
      });
      console.log(`[emailService] Email delivered via Gmail/SMTP to ${to} ("${subject}")`);
      return;
    } catch (err) {
      console.error('[emailService] SMTP send error:', err);
    }
  }

  // 2. Try Resend if configured
  if (env.RESEND_API_KEY) {
    try {
      await getResend().emails.send({
        from: env.RESEND_FROM_EMAIL,
        to,
        subject,
        html,
      });
      console.log(`[emailService] Email delivered via Resend to ${to} ("${subject}")`);
      return;
    } catch (err) {
      console.error('[emailService] Resend send error:', err);
    }
  }

  // 3. Fallback to console
  console.warn(`[emailService] No active email provider configured. Skipped sending "${subject}" to ${to}`);
}

export interface StaffWelcomeEmailOptions {
  to: string;
  name: string;
  role: string;
  password: string;
  createdBy: string;
  collegeName?: string;
  loginUrl?: string;
}

export async function sendStaffWelcomeEmail(opts: StaffWelcomeEmailOptions): Promise<void> {
  const roleName = opts.role
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const loginUrl = opts.loginUrl || `${env.APP_URL}/login`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 32px 16px;">
  <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e5e7eb; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 6px">${env.APP_NAME}</h1>
      <p style="color: #6b7280; margin: 0; font-size: 14px;">Your account has been created</p>
    </div>

    <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi <strong>${opts.name}</strong>,</p>
    <p style="color: #374151; font-size: 15px; line-height: 1.6;">
      <strong>${opts.createdBy}</strong> has set up a <strong>${roleName}</strong> account for you on ${env.APP_NAME}${opts.collegeName ? ` for <strong>${opts.collegeName}</strong>` : ''}.
      Use the credentials below to sign in:
    </p>

    <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 24px 0;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="color: #6b7280; padding: 6px 0; width: 100px;">Login Portal</td>
          <td style="color: #111827; font-weight: 500;"><a href="${loginUrl}" style="color: #2563eb; text-decoration: underline;">${loginUrl}</a></td>
        </tr>
        <tr>
          <td style="color: #6b7280; padding: 6px 0;">Username / Email</td>
          <td style="color: #111827; font-weight: 600; font-family: monospace;">${opts.to}</td>
        </tr>
        <tr>
          <td style="color: #6b7280; padding: 6px 0;">Temporary Password</td>
          <td style="color: #111827; font-weight: 700; font-family: monospace; font-size: 15px; letter-spacing: 0.5px;">${opts.password}</td>
        </tr>
        <tr>
          <td style="color: #6b7280; padding: 6px 0;">Assigned Role</td>
          <td style="color: #111827; font-weight: 500;">${roleName}</td>
        </tr>
      </table>
    </div>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${loginUrl}" style="background: #2563eb; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
        Sign In to Portal &rarr;
      </a>
    </div>

    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 13px; color: #92400e;">
        <strong>Security Tip:</strong> Please change your temporary password immediately upon signing in.
      </p>
    </div>

    <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0; border-top: 1px solid #f3f4f6; padding-top: 16px;">
      This email was sent by ${env.APP_NAME}. If you did not expect this invitation, please contact your college administrator.
    </p>
  </div>
</body>
</html>`;

  await dispatchEmail(opts.to, `Your ${env.APP_NAME} account credentials`, html);
}

export interface InviteEmailOptions {
  to: string;
  name: string;
  role: string;
  collegeName?: string;
  inviteUrl: string;
  invitedBy?: string;
}

export async function sendInviteEmail(opts: InviteEmailOptions): Promise<void> {
  const roleName = opts.role
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 32px 16px;">
  <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e5e7eb; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 6px">${env.APP_NAME}</h1>
      <p style="color: #6b7280; margin: 0; font-size: 14px;">Invitation to Join Platform</p>
    </div>

    <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi <strong>${opts.name}</strong>,</p>
    <p style="color: #374151; font-size: 15px; line-height: 1.6;">
      ${opts.invitedBy ? `<strong>${opts.invitedBy}</strong> has` : 'You have been'} invited to join <strong>${env.APP_NAME}</strong> as a <strong>${roleName}</strong>${opts.collegeName ? ` for <strong>${opts.collegeName}</strong>` : ''}.
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <a href="${opts.inviteUrl}" style="background: #2563eb; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
        Activate Account &rarr;
      </a>
    </div>

    <p style="color: #6b7280; font-size: 13px; line-height: 1.5;">
      Or copy and paste this link into your browser:<br>
      <a href="${opts.inviteUrl}" style="color: #2563eb; word-break: break-all;">${opts.inviteUrl}</a>
    </p>

    <div style="background: #f3f4f6; border-radius: 8px; padding: 12px 16px; margin: 24px 0;">
      <p style="margin: 0; font-size: 12px; color: #6b7280;">
        This activation invitation is valid for 7 days.
      </p>
    </div>

    <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0; border-top: 1px solid #f3f4f6; padding-top: 16px;">
      This email was sent by ${env.APP_NAME}. If you did not expect this invitation, you can ignore this email.
    </p>
  </div>
</body>
</html>`;

  await dispatchEmail(opts.to, `Invitation: Join ${env.APP_NAME} as ${roleName}`, html);
}

export interface PasswordResetEmailOptions {
  to: string;
  name: string;
  otp: string;
  expiresInMinutes?: number;
}

export async function sendPasswordResetOtpEmail(opts: PasswordResetEmailOptions): Promise<void> {
  const expiry = opts.expiresInMinutes || 15;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb; margin: 0; padding: 32px 16px;">
  <div style="max-width: 520px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e5e7eb; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="margin-bottom: 24px;">
      <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0 0 6px">${env.APP_NAME}</h1>
      <p style="color: #6b7280; margin: 0; font-size: 14px;">Password Reset Verification Code</p>
    </div>

    <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi <strong>${opts.name}</strong>,</p>
    <p style="color: #374151; font-size: 15px; line-height: 1.6;">
      We received a request to reset your password for ${env.APP_NAME}. Please enter the following 6-digit verification code:
    </p>

    <div style="text-align: center; margin: 32px 0;">
      <div style="display: inline-block; background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 12px; padding: 18px 36px;">
        <span style="font-family: monospace; font-size: 34px; font-weight: 700; letter-spacing: 10px; color: #1d4ed8;">${opts.otp}</span>
      </div>
    </div>

    <p style="color: #4b5563; font-size: 14px; text-align: center; margin-bottom: 24px;">
      This verification code is valid for <strong>${expiry} minutes</strong>.
    </p>

    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
      <p style="margin: 0; font-size: 13px; color: #92400e;">
        If you did not request a password reset, you can safely ignore this email. Your account remains secure.
      </p>
    </div>

    <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 0; border-top: 1px solid #f3f4f6; padding-top: 16px;">
      This automated security notification was sent by ${env.APP_NAME}.
    </p>
  </div>
</body>
</html>`;

  await dispatchEmail(opts.to, `Your ${env.APP_NAME} Password Reset Code: ${opts.otp}`, html);
}

