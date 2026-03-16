// Email + reporting tools.
// Sends reports via SMTP to info@meritdental.care.

import { z } from 'zod';
import { createTransport } from 'nodemailer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(__dirname, '..', '..', 'reports');

function ensureReportsDir() {
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
}

function getTransporter() {
  const config = getConfig();
  if (!config.email?.smtp?.host) return null;
  return createTransport(config.email.smtp);
}

export function registerReportTools(server) {

  server.tool(
    'send_email_report',
    'Send a report via email to info@meritdental.care. Also saves a local copy.',
    {
      subject: z.string().describe('Email subject line'),
      body: z.string().describe('Report body (plain text)'),
      html: z.string().optional().describe('HTML version of the report'),
    },
    async ({ subject, body, html }) => {
      const config = getConfig();
      const to = config.email?.to || 'info@meritdental.care';
      const from = config.email?.from || 'agent@meritdental.care';

      // Always save locally
      ensureReportsDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `report-${timestamp}.txt`;
      const localPath = join(reportsDir, filename);
      writeFileSync(localPath, `Subject: ${subject}\nTo: ${to}\nDate: ${new Date().toISOString()}\n\n${body}`);

      // Try to send email
      const transporter = getTransporter();
      if (!transporter) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            status: 'saved_locally',
            path: localPath,
            note: 'SMTP not configured — report saved locally only. Set email.smtp in config.json to enable sending.',
          }, null, 2) }],
        };
      }

      try {
        const info = await transporter.sendMail({
          from,
          to,
          subject,
          text: body,
          html: html || undefined,
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            status: 'sent',
            messageId: info.messageId,
            to,
            localCopy: localPath,
          }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            status: 'email_failed',
            error: err.message,
            localCopy: localPath,
            note: 'Email sending failed but report saved locally.',
          }, null, 2) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'save_report',
    'Save a report to the local reports/ directory.',
    {
      filename: z.string().describe('Filename (e.g. morning-report-2026-03-15.txt)'),
      content: z.string().describe('Report content'),
      format: z.enum(['txt', 'json', 'html']).optional().describe('File format. Default: txt'),
    },
    async ({ filename, content, format }) => {
      ensureReportsDir();
      const ext = format || 'txt';
      const finalFilename = filename.endsWith(`.${ext}`) ? filename : `${filename}.${ext}`;
      const filePath = join(reportsDir, finalFilename);
      writeFileSync(filePath, content);
      return {
        content: [{ type: 'text', text: JSON.stringify({ saved: filePath }) }],
      };
    }
  );

  server.tool(
    'format_eligibility_report',
    'Format raw eligibility check results into a clean human-readable report suitable for email.',
    {
      results: z.string().describe('JSON string of batch eligibility results'),
    },
    async ({ results }) => {
      let data;
      try {
        data = JSON.parse(results);
      } catch {
        return { content: [{ type: 'text', text: 'Invalid JSON input' }], isError: true };
      }

      const lines = [
        `ELIGIBILITY VERIFICATION REPORT`,
        `Date: ${data.date || new Date().toISOString().split('T')[0]}`,
        `Total Patients: ${data.totalPatients || 'N/A'}`,
        `Verified: ${data.checked || 0}`,
        `Errors: ${data.errored || 0}`,
        `${'='.repeat(60)}`,
        '',
      ];

      if (data.results) {
        for (const r of data.results) {
          lines.push(`Patient: ${r.patient}`);
          lines.push(`Payer: ${r.payer} | ID: ${r.subscriberId}`);
          lines.push(`Status: ${r.status}`);
          if (r.error) lines.push(`Error: ${r.error}`);
          if (r.rawContent) {
            lines.push(`Details:`);
            lines.push(r.rawContent.slice(0, 2000));
          }
          lines.push('-'.repeat(40));
          lines.push('');
        }
      }

      if (data.errors && data.errors.length > 0) {
        lines.push('ERRORS:');
        for (const e of data.errors) {
          lines.push(`  ${e.payer}: ${e.error}`);
        }
      }

      const report = lines.join('\n');
      return { content: [{ type: 'text', text: report }] };
    }
  );
}
