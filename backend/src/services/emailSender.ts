import nodemailer from 'nodemailer';
import { EmailJobData } from '../types';

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
  web: string;
}

let testAccount: EtherealAccount | null = null;
let transporter: nodemailer.Transporter | null = null;

/**
 * Initialize Ethereal Email test account.
 * Ethereal automatically creates a test account for SMTP testing.
 * Preview URLs let you see the sent email in a browser.
 */
async function getTransporter(): Promise<nodemailer.Transporter> {
  if (transporter) return transporter;

  // Create a one-time Ethereal test account
  testAccount = await nodemailer.createTestAccount();

  console.log('📧 Ethereal Email test account created:');
  console.log(`   User: ${testAccount.user}`);
  console.log(`   Pass: ${testAccount.pass}`);
  console.log(`   Web:  ${testAccount.web}`);

  transporter = nodemailer.createTransport({
    host: testAccount.smtp.host,
    port: testAccount.smtp.port,
    secure: testAccount.smtp.secure,
    auth: {
      user: testAccount.user,
      pass: testAccount.pass,
    },
  });

  return transporter;
}

export interface SendEmailResult {
  messageId: string;
  previewUrl: string | null;
}

/**
 * Send an email via Ethereal SMTP (fake SMTP for testing).
 * Returns the preview URL to view the email in Ethereal's web interface.
 */
export async function sendEmail(jobData: EmailJobData): Promise<SendEmailResult> {
  const transport = await getTransporter();

  const info = await transport.sendMail({
    from: jobData.senderName
      ? `"${jobData.senderName}" <${jobData.senderEmail}>`
      : jobData.senderEmail,
    to: jobData.recipientEmail,
    subject: jobData.subject,
    html: jobData.body,
    text: jobData.body.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
    attachments: jobData.attachments?.map((att) => ({
      filename: att.filename,
      path: att.dataUrl,
    })),
    headers: {
      'X-Email-Job-ID': jobData.emailJobId,
      'X-Campaign-ID': jobData.campaignId,
    },
  });

  const previewUrl = nodemailer.getTestMessageUrl(info) || null;

  console.log(`📨 Email sent to ${jobData.recipientEmail} [${jobData.emailJobId}]`);
  if (previewUrl) {
    console.log(`   Preview: ${previewUrl}`);
  }

  return {
    messageId: info.messageId,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
  };
}

/**
 * Sleep for the configured minimum delay between sends.
 * This simulates provider throttling.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
