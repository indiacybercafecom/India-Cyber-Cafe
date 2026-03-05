// ============= EMAIL CONFIGURATION =============

// Professional Email Footer with Support Information
const emailFooter = `
  <div style="background: #f8f9fa; padding: 25px 20px; margin-top: 30px; border-top: 3px solid #FF9933; text-align: center; font-size: 12px; color: #666; border-radius: 0 0 10px 10px;">
    <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e0e0e0;">
      <p style="margin: 0; font-weight: bold; font-size: 13px; color: #333;">India Cyber Cafe Support Center</p>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; text-align: left; max-width: 400px; margin: 0 auto 15px;">
      <div>
        <p style="margin: 0 0 5px 0; font-weight: bold; color: #FF9933;">📧 Email</p>
        <p style="margin: 0;"><a href="mailto:icc@indiacybercafe.com" style="color: #FF9933; text-decoration: none;">icc@indiacybercafe.com</a></p>
      </div>
      <div>
        <p style="margin: 0 0 5px 0; font-weight: bold; color: #FF9933;">🌐 Website</p>
        <p style="margin: 0;"><a href="https://book.indiacybercafe.com" style="color: #FF9933; text-decoration: none;">book.indiacybercafe.com</a></p>
      </div>
    </div>
    <div style="padding: 12px; background: #fff3e0; border-radius: 6px; margin-bottom: 12px;">
      <p style="margin: 0; font-size: 11px; color: #666;">📱 Available 24/7 for your support needs</p>
      <p style="margin: 5px 0 0 0; font-size: 11px; color: #999;">Response time: Within 2 hours</p>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 10px;">© 2024-2026 India Cyber Cafe. All rights reserved. | <a href="https://book.indiacybercafe.com/legal/privacy" style="color: #FF9933; text-decoration: none;">Privacy Policy</a></p>
  </div>
`;

// Professional Email Header with Logo
const emailHeader = (title: string) => `
  <div style="background: linear-gradient(135deg, #FF9933 0%, #FF7F00 100%); padding: 30px 20px; text-align: center; border-radius: 10px 10px 0 0;">
    <div style="margin-bottom: 15px;">
      <img src="https://indiacybercafe.com/wp-content/uploads/2025/12/india-cyber-cafe-main-logo-headeer.png" alt="India Cyber Cafe" style="max-width: 200px; height: auto; max-height: 60px; display: inline-block;">
    </div>
    <h1 style="color: #fff; margin: 10px 0 0 0; font-size: 22px; font-weight: 600; letter-spacing: -0.3px;">India Cyber Cafe</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0; font-size: 12px;">Digital Seva Simplified</p>
  </div>
  <div style="padding: 20px; border-bottom: 2px solid #FF9933; background: #fafafa;">
    <h2 style="color: #FF9933; margin: 0; font-size: 20px; font-weight: 600;">${title}</h2>
  </div>
`;

// Reusable Email Template Base
const baseTemplate = (title: string, content: string) => `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif; max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    ${emailHeader(title)}
    <div style="padding: 25px 20px; color: #333; line-height: 1.7; font-size: 14px;">
      ${content}
    </div>
    ${emailFooter}
  </div>
`;

// Logo URL - Professional corporate logo
const logoUrl = 'https://indiacybercafe.com/wp-content/uploads/2025/12/india-cyber-cafe-main-logo-headeer.png';

export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html }),
    });
    const result = await response.json();
    if (!result.success) {
      console.error('Email service error:', result.error);
    }
    return result;
  } catch (error) {
    console.error('Failed to send email:', error);
    return { success: false, error };
  }
}

// Send emails to all admins
export async function sendEmailToAllAdmins(subject: string, html: string) {
  const admins = [
    'icc@indiacybercafe.com',
    'indiacybercafe.com@gmail.com'
  ];
  
  const results = await Promise.all(
    admins.map(admin => sendEmail(admin, subject, html))
  );
  
  return results;
}

export const emailTemplates = {
  // ============= USER TEMPLATES ============= 
  
  registration: (name: string) => baseTemplate(
    '🎉 Welcome to India Cyber Cafe!',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Thank you for registering with India Cyber Cafe! We are thrilled to have you join our community.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 0;"><strong>What's Next?</strong></p>
        <ul style="margin: 10px 0 0 0; padding-left: 20px;">
          <li>Complete your profile with required documents</li>
          <li>Browse our cyber services</li>
          <li>Apply for services you need</li>
          <li>Track your applications in real-time</li>
        </ul>
      </div>
      <p>You can now log in and explore various cyber services directly from our portal. Our team is here to help you!</p>
      <p><a href="https://book.indiacybercafe.com/login" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Login to Your Account</a></p>
      <p style="margin-top: 20px; font-style: italic; color: #666;">Need help? Contact our support team anytime.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  applicationSubmitted: (name: string, serviceName: string, appId: string) => baseTemplate(
    '✅ Application Submitted Successfully',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Great! Your application has been successfully submitted to our system.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Application Details:</strong></p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${appId}</code></p>
        <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background: #ffd700; padding: 2px 8px; border-radius: 3px; color: #000;">Pending Review</span></p>
      </div>
      <p>Our team will review your application within 24-48 hours. You will receive updates via email as your application progresses.</p>
      <p><a href="https://book.indiacybercafe.com/track?id=${appId}" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Track Your Application</a></p>
      <p style="margin-top: 15px; font-size: 14px; color: #666;">💡 <strong>Tip:</strong> Save your Application ID (${appId}) for future reference. You can use it to track your application status anytime.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  statusUpdate: (name: string, serviceName: string, status: string, statusColor: string = '#FF9933') => baseTemplate(
    '🔄 Application Status Updated',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Your application status has been updated!</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid ${statusColor};">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>New Status:</strong> <span style="background: ${statusColor}; padding: 3px 10px; border-radius: 3px; color: white; font-weight: bold;">${status.toUpperCase()}</span></p>
      </div>
      <p>Please log in to your dashboard to see more details and any additional information about your application.</p>
      <p><a href="https://book.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Dashboard</a></p>
      <p style="margin-top: 20px; font-style: italic; color: #666;">If you have any questions, please don't hesitate to contact us.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  noteAdded: (name: string, serviceName: string, note: string) => baseTemplate(
    '📝 New Update on Your Application',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>A new note or update has been added to your application for <strong>${serviceName}</strong>:</p>
      <div style="background: #fff9e6; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933; border: 1px solid #ffe6cc;">
        <p style="margin: 0; color: #333;">${note}</p>
      </div>
      <p>Please log in to your dashboard to see more details and respond if needed.</p>
      <p><a href="https://book.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Check Your Dashboard</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  operatorAssigned: (name: string, serviceName: string, operatorName?: string) => baseTemplate(
    '👤 Operator Assigned to Your Application',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Great news! An experienced operator has been assigned to handle your application.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        ${operatorName ? `<p style="margin: 5px 0;"><strong>Assigned Operator:</strong> ${operatorName}</p>` : ''}
        <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background: #90EE90; padding: 2px 8px; border-radius: 3px; color: #000;">In Progress</span></p>
      </div>
      <p>Your request is now being processed with priority. You can expect regular updates on the progress of your application.</p>
      <p style="margin-top: 20px; font-style: italic; color: #666;">Thank you for choosing India Cyber Cafe!</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  profileUpdated: (name: string, updateType: string) => baseTemplate(
    '✏️ Profile Updated Successfully',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Your profile has been updated successfully.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Updated:</strong> ${updateType}</p>
        <p style="margin: 5px 0; color: #666;">Changes: Updated on ${new Date().toLocaleDateString()}</p>
      </div>
      <p>Thank you for keeping your information up to date with us.</p>
      <p><a href="https://book.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Profile</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  passwordReset: (name: string, resetLink?: string) => baseTemplate(
    '🔐 Password Reset Request',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>We received a request to reset your password. If you made this request, click the button below to reset your password.</p>
      <p style="margin: 20px 0;">
        ${resetLink ? `<a href="${resetLink}" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Reset Password</a>` : '<p style="background: #f0f0f0; padding: 10px; border-radius: 5px;">Please contact admin to reset your password</p>'}
      </p>
      <p style="color: #666; font-size: 14px;"><strong>⚠️ Important:</strong> If you did not make this request, please ignore this email. Your password will remain unchanged.</p>
      <p>For security reasons, this link will expire in 24 hours.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  userPasswordDelivery: (name: string, password: string) => baseTemplate(
    '🔐 Your Password - India Cyber Cafe',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>We received your password reset request. Here is your current password:</p>
      <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #FF9933; text-align: center;">
        <p style="margin: 0; color: #333; font-size: 12px; font-weight: bold;">YOUR PASSWORD</p>
        <p style="margin: 10px 0 0 0; color: #FF9933; font-size: 18px; font-family: 'Courier New', monospace; letter-spacing: 2px; word-break: break-all;"><strong>${password}</strong></p>
      </div>
      
      <p style="margin-top: 20px;"><strong>How to use this password:</strong></p>
      <ol style="color: #555; line-height: 1.8;">
        <li><strong>Login:</strong> Use your email/phone and this password to login at <a href="https://book.indiacybercafe.com/login" style="color: #FF9933;">book.indiacybercafe.com/login</a></li>
        <li><strong>Change Password:</strong> Once logged in, go to your Profile > Security Settings</li>
        <li><strong>Update Password:</strong> Click "Change Password" and enter this password in the "Current Password" field</li>
        <li><strong>Set New Password:</strong> Create a strong, unique password that only you know</li>
      </ol>
      
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 0; color: #FF9933; font-weight: bold;">💡 Tips for a Strong Password:</p>
        <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #555;">
          <li>Use at least 8 characters</li>
          <li>Mix uppercase, lowercase, numbers, and symbols</li>
          <li>Avoid using personal information (name, birthdate, phone)</li>
          <li>Don't share your password with anyone</li>
        </ul>
      </div>
      
      <p style="margin-top: 20px; color: #666; font-size: 13px;"><strong>⚠️ Important Security Notice:</strong></p>
      <ul style="color: #666; font-size: 13px; margin: 8px 0 0 0;">
        <li>This password email is sent only to you - never share it with anyone</li>
        <li>Delete this email after you've changed your password</li>
        <li>If you did not request this password, please contact admin immediately</li>
        <li>We recommend changing your password as soon as you login</li>
      </ul>
      
      <p style="margin-top: 20px;"><a href="https://book.indiacybercafe.com/login" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Login to Your Account</a></p>
      
      <p style="margin-top: 20px; color: #666; font-size: 13px;">If you need any help, please contact our support team at <a href="mailto:icc@indiacybercafe.com" style="color: #FF9933;">icc@indiacybercafe.com</a> or visit <a href="https://book.indiacybercafe.com" style="color: #FF9933;">book.indiacybercafe.com</a></p>
      
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  paymentReceived: (name: string, amount: string, serviceName: string, transactionId: string) => baseTemplate(
    '💰 Payment Received Successfully',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Thank you! We have successfully received your payment.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>Amount Paid:</strong> ₹${amount}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Transaction ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${transactionId}</code></p>
        <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background: #28a745; padding: 2px 8px; border-radius: 3px; color: white;">✓ Confirmed</span></p>
      </div>
      <p>Your payment has been processed and your application will be prioritized.</p>
      <p><a href="https://book.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Applications</a></p>
      <p style="margin-top: 15px; font-size: 14px; color: #666;">Please keep this email for your records. The transaction ID can be used for reference.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  applicationCompleted: (name: string, serviceName: string, appId: string, completionDetails?: string) => baseTemplate(
    '🎉 Application Completed Successfully',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>Congratulations! Your application has been completed successfully.</p>
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${appId}</code></p>
        <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background: #28a745; padding: 2px 8px; border-radius: 3px; color: white;">✓ COMPLETED</span></p>
        ${completionDetails ? `<p style="margin: 10px 0;"><strong>Details:</strong></p><p>${completionDetails}</p>` : ''}
      </div>
      <p><a href="https://book.indiacybercafe.com/track?id=${appId}" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Download Certificate/Documents</a></p>
      <p style="margin-top: 15px; font-size: 14px; color: #666;">Thank you for choosing India Cyber Cafe. We hope our service was satisfactory. Please feel free to apply for more services.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  applicationRejected: (name: string, serviceName: string, appId: string, reason?: string) => baseTemplate(
    '❌ Application Status - Needs Revision',
    `
      <p>Hello <strong>${name}</strong>,</p>
      <p>We have reviewed your application and found some issues that need to be addressed.</p>
      <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${appId}</code></p>
        <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background: #ffc107; padding: 2px 8px; border-radius: 3px; color: #000;">⚠️ NEEDS REVISION</span></p>
        ${reason ? `<p style="margin: 10px 0;"><strong>Reason:</strong></p><p>${reason}</p>` : ''}
      </div>
      <p>Please update your application with the necessary corrections and resubmit. Our team will review the updated version.</p>
      <p><a href="https://book.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Update Your Application</a></p>
      <p style="margin-top: 15px; font-size: 14px; color: #666;">If you have questions about the required corrections, please contact our support team.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  // ============= ADMIN TEMPLATES =============

  adminNewApplication: (userName: string, userEmail: string, serviceName: string, appId: string) => baseTemplate(
    '📋 New Application Received - Admin Alert',
    `
      <p>Hello Admin,</p>
      <p>A new application has been submitted and requires your attention.</p>
      <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>User Name:</strong> ${userName}</p>
        <p style="margin: 5px 0;"><strong>User Email:</strong> <a href="mailto:${userEmail}" style="color: #FF9933;">${userEmail}</a></p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${appId}</code></p>
        <p style="margin: 5px 0;"><strong>Submitted On:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p><a href="https://book.indiacybercafe.com/admin" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Review in Admin Panel</a></p>
      <p>Please review and assign an operator as soon as possible.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  adminUserRegistered: (name: string, email: string, registrationDate: string) => baseTemplate(
    '👤 New User Registration - Admin Alert',
    `
      <p>Hello Admin,</p>
      <p>A new user has registered on the India Cyber Cafe portal.</p>
      <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>User Name:</strong> ${name}</p>
        <p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:${email}" style="color: #FF9933;">${email}</a></p>
        <p style="margin: 5px 0;"><strong>Registered On:</strong> ${registrationDate}</p>
      </div>
      <p><a href="https://book.indiacybercafe.com/admin" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View User Details</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  adminPasswordResetRequest: (userName: string, userEmail: string, requestTime: string) => baseTemplate(
    '🔐 Password Reset Request - Admin Alert',
    `
      <p>Hello Admin,</p>
      <p>A user has requested a password reset.</p>
      <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 5px 0;"><strong>User Name:</strong> ${userName}</p>
        <p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:${userEmail}" style="color: #FF9933;">${userEmail}</a></p>
        <p style="margin: 5px 0;"><strong>Request Time:</strong> ${requestTime}</p>
      </div>
      <p>The user should check their email for password reset instructions.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  adminPaymentReceived: (userName: string, amount: string, serviceName: string, transactionId: string) => baseTemplate(
    '💰 Payment Received - Admin Alert',
    `
      <p>Hello Admin,</p>
      <p>A payment has been received for a service application.</p>
      <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>User Name:</strong> ${userName}</p>
        <p style="margin: 5px 0;"><strong>Amount:</strong> ₹${amount}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Transaction ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${transactionId}</code></p>
        <p style="margin: 5px 0;"><strong>Payment Date:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p>Please confirm the payment in your banking portal and update the application status if needed.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  // ============= OPERATOR TEMPLATES =============

  operatorNewAssignment: (operatorName: string, userName: string, userEmail: string, serviceName: string, appId: string) => baseTemplate(
    '📌 New Assignment - Operator Alert',
    `
      <p>Hello <strong>${operatorName}</strong>,</p>
      <p>You have been assigned a new application to process.</p>
      <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>User Name:</strong> ${userName}</p>
        <p style="margin: 5px 0;"><strong>User Email:</strong> <a href="mailto:${userEmail}" style="color: #FF9933;">${userEmail}</a></p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${appId}</code></p>
        <p style="margin: 5px 0;"><strong>Assigned On:</strong> ${new Date().toLocaleString()}</p>
      </div>
      <p>Please review the application details and start processing. You can add notes, request additional documents, or update the status as needed.</p>
      <p><a href="https://book.indiacybercafe.com/operator" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Assignment in Operator Panel</a></p>
      <p>Thank you for your prompt attention to this application.</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  operatorAssignmentUpdated: (operatorName: string, serviceName: string, appId: string, newStatus: string, updateNote?: string) => baseTemplate(
    '🔄 Assignment Updated - Operator Alert',
    `
      <p>Hello <strong>${operatorName}</strong>,</p>
      <p>An update has been made to one of your assigned applications.</p>
      <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${appId}</code></p>
        <p style="margin: 5px 0;"><strong>New Status:</strong> ${newStatus}</p>
        ${updateNote ? `<p style="margin: 10px 0;"><strong>Update Note:</strong></p><p>${updateNote}</p>` : ''}
      </div>
      <p><a href="https://book.indiacybercafe.com/operator" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View in Operator Panel</a></p>
      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  operatorApplicationCompleted: (operatorName: string, userName: string, serviceName: string, appId: string) => baseTemplate(
    '✅ Application Completed - Operator Alert',
    `
      <p>Hello <strong>${operatorName}</strong>,</p>
      <p>An application you were processing has been marked as completed.</p>
      <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>User Name:</strong> ${userName}</p>
        <p style="margin: 5px 0;"><strong>Service:</strong> ${serviceName}</p>
        <p style="margin: 5px 0;"><strong>Application ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${appId}</code></p>
        <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background: #28a745; padding: 2px 8px; border-radius: 3px; color: white;">✓ COMPLETED</span></p>
      </div>
      <p>Thank you for successfully completing this application!</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),
};
