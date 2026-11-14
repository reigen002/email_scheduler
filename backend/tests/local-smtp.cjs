// Replace only external Ethereal account discovery. Delivery still uses real TCP/SMTP.
require('nodemailer').createTestAccount = async () => ({
  user: '', pass: '', web: 'http://127.0.0.1',
  smtp: { host: '127.0.0.1', port: Number(process.env.TEST_SMTP_PORT), secure: false },
});
