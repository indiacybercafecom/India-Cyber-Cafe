const LOGO_URL = 'https://firebasestorage.googleapis.com/v0/b/india-cyber-cafe.appspot.com/o/assets%2Flogo.png?alt=media';
const SUPPORT_EMAIL = 'icc@indiacybercafe.com';
const SUPPORT_PHONE = '+91 9977498131';
const WEBSITE_URL = 'https://indiacybercafe.com';

const baseTemplate = (content: string) => `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff;">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 30px; text-align: center;">
      <img src="${LOGO_URL}" alt="India Cyber Cafe" style="height: 60px; margin-bottom: 15px;" />
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">India Cyber Cafe</h1>
    </div>
    
    <!-- Content -->
    <div style="padding: 40px 30px; line-height: 1.6; color: #334155;">
      ${content}
    </div>
    
    <!-- Footer -->
    <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0 0 15px 0; font-size: 14px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Need Support?</p>
      <div style="display: inline-block; margin-bottom: 20px;">
        <a href="tel:${SUPPORT_PHONE}" style="display: inline-block; padding: 10px 20px; background-color: #FF9933; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 5px;">Call: ${SUPPORT_PHONE}</a>
        <a href="mailto:${SUPPORT_EMAIL}" style="display: inline-block; padding: 10px 20px; background-color: #0f172a; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 5px;">Email Support</a>
      </div>
      <p style="margin: 0; font-size: 12px; color: #94a3b8;">
        &copy; ${new Date().getFullYear()} India Cyber Cafe. All rights reserved.<br/>
        Main Road, Near Bus Stand, India
      </p>
      <div style="margin-top: 15px;">
        <a href="${WEBSITE_URL}" style="color: #FF9933; text-decoration: none; font-size: 12px; font-weight: 600;">Visit Website</a>
      </div>
    </div>
  </div>
`;

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html }),
    });
    return await response.json();
  } catch (error) {
    console.error('Failed to send email:', error);
    return { success: false, error };
  }
}

export const emailTemplates = {
  registration: (name: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Welcome to the Family!</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>We are thrilled to welcome you to <strong>India Cyber Cafe</strong>. Your account has been successfully created.</p>
    <p>You can now access our wide range of digital services, track your applications in real-time, and get expert assistance for all your cyber needs.</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${WEBSITE_URL}/profile" style="background-color: #FF9933; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Complete Your Profile</a>
    </div>
    <p>If you have any questions, our support team is just a click away.</p>
  `),

  applicationSubmitted: (name: string, serviceName: string, appId: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Application Received</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>Your application for <strong>${serviceName}</strong> has been successfully submitted and is now being processed.</p>
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #FF9933;">
      <p style="margin: 0; font-size: 14px; color: #64748b;">Application ID</p>
      <p style="margin: 5px 0 0 0; font-size: 18px; font-weight: 700; color: #0f172a;">${appId}</p>
    </div>
    <p>Our team will review your documents and update the status shortly. You will receive an email notification for every update.</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${WEBSITE_URL}/track" style="background-color: #0f172a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Track Application</a>
    </div>
  `),

  statusUpdate: (name: string, serviceName: string, status: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Status Update</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>There is an update on your application for <strong>${serviceName}</strong>.</p>
    <div style="margin: 25px 0; padding: 20px; border-radius: 12px; background-color: ${status.toLowerCase() === 'completed' ? '#f0fdf4' : '#fff7ed'}; border: 1px solid ${status.toLowerCase() === 'completed' ? '#bbf7d0' : '#ffedd5'}; text-align: center;">
      <p style="margin: 0; font-size: 14px; color: #64748b;">Current Status</p>
      <p style="margin: 10px 0 0 0; font-size: 20px; font-weight: 800; color: ${status.toLowerCase() === 'completed' ? '#166534' : '#9a3412'}; text-transform: uppercase; letter-spacing: 1px;">${status}</p>
    </div>
    <p>Please log in to your dashboard to view full details or download any processed documents.</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${WEBSITE_URL}/track" style="background-color: #FF9933; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">View Dashboard</a>
    </div>
  `),

  noteAdded: (name: string, serviceName: string, note: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">New Message from Team</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>Our processing team has added a new note to your application for <strong>${serviceName}</strong>:</p>
    <div style="background-color: #f8fafc; padding: 25px; border-radius: 12px; margin: 20px 0; border: 1px solid #e2e8f0; font-style: italic; color: #475569;">
      "${note}"
    </div>
    <p>If action is required, please respond as soon as possible to avoid delays.</p>
  `),

  operatorAssigned: (name: string, serviceName: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Expert Assigned</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>Great news! A dedicated operator has been assigned to your application for <strong>${serviceName}</strong>.</p>
    <p>Your request is now being handled with priority. You will be notified of any further progress.</p>
  `),

  adminNewApplication: (userName: string, serviceName: string, appId: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Action Required: New Application</h2>
    <p>Admin,</p>
    <p>A new service request has been received from <strong>${userName}</strong>.</p>
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
      <p style="margin: 5px 0;"><strong>App ID:</strong> ${appId}</p>
      <p style="margin: 5px 0;"><strong>User:</strong> ${userName}</p>
    </div>
    <p>Please assign an operator to start processing this request.</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${WEBSITE_URL}/admin" style="background-color: #0f172a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Open Admin Panel</a>
    </div>
  `),

  operatorNewAssignment: (operatorName: string, userName: string, serviceName: string, appId: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">New Assignment</h2>
    <p>Hello <strong>${operatorName}</strong>,</p>
    <p>You have been assigned a new application to process.</p>
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 12px; margin: 20px 0;">
      <p style="margin: 5px 0;"><strong>Client:</strong> ${userName}</p>
      <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
      <p style="margin: 5px 0;"><strong>App ID:</strong> ${appId}</p>
    </div>
    <p>Please review the documents and start processing immediately.</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${WEBSITE_URL}/operator" style="background-color: #FF9933; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Start Processing</a>
    </div>
  `),

  profileUpdate: (name: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Profile Updated</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>Your profile information has been successfully updated on India Cyber Cafe.</p>
    <p>If you did not make this change, please contact our support team immediately to secure your account.</p>
    <div style="margin: 30px 0; text-align: center;">
      <a href="${WEBSITE_URL}/profile" style="background-color: #0f172a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Review Profile</a>
    </div>
  `),

  passwordUpdate: (name: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Security Alert: Password Changed</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>The password for your India Cyber Cafe account was recently changed.</p>
    <p>If you performed this action, you can safely ignore this email. If you did not change your password, please use the "Forgot Password" option on the login page or contact support immediately.</p>
  `),

  paymentUpdate: (name: string, serviceName: string, status: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">Payment Status Update</h2>
    <p>Hello <strong>${name}</strong>,</p>
    <p>The payment status for your application <strong>${serviceName}</strong> has been updated.</p>
    <div style="margin: 25px 0; padding: 20px; border-radius: 12px; background-color: ${status === 'completed' ? '#f0fdf4' : '#fff7ed'}; border: 1px solid ${status === 'completed' ? '#bbf7d0' : '#ffedd5'}; text-align: center;">
      <p style="margin: 0; font-size: 14px; color: #64748b;">Payment Status</p>
      <p style="margin: 10px 0 0 0; font-size: 20px; font-weight: 800; color: ${status === 'completed' ? '#166534' : '#9a3412'}; text-transform: uppercase;">${status}</p>
    </div>
    <p>You can view your payment history and receipts in your dashboard.</p>
  `),

  adminAction: (action: string, details: string) => baseTemplate(`
    <h2 style="color: #0f172a; margin-top: 0;">System Activity Notification</h2>
    <p>Admin,</p>
    <p>A system action has been performed:</p>
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #0f172a;">
      <p style="margin: 5px 0;"><strong>Action:</strong> ${action}</p>
      <p style="margin: 5px 0;"><strong>Details:</strong> ${details}</p>
      <p style="margin: 5px 0;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
    </div>
    <p>This is an automated security and activity log notification.</p>
  `)
};



