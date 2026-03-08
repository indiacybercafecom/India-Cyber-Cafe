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
        <p style="margin: 0;"><a href="https://booking.indiacybercafe.com" style="color: #FF9933; text-decoration: none;">booking.indiacybercafe.com</a></p>
      </div>
    </div>
    <div style="padding: 12px; background: #fff3e0; border-radius: 6px; margin-bottom: 12px;">
      <p style="margin: 0; font-size: 11px; color: #666;">📱 Available 24/7 for your support needs</p>
      <p style="margin: 5px 0 0 0; font-size: 11px; color: #999;">Response time: Within 2 hours</p>
    </div>
    <p style="margin: 10px 0 0 0; color: #999; font-size: 10px;">© 2024-2026 India Cyber Cafe. All rights reserved. | <a href="https://booking.indiacybercafe.com/legal/privacy" style="color: #FF9933; text-decoration: none;">Privacy Policy</a></p>
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

// Send welcome email to guest checkout customer
export async function sendWelcomeEmail(customerEmail: string, customerName: string, tempPassword: string) {
  const html = emailTemplates.guestAccountWelcome(customerName, customerEmail, tempPassword);
  return sendEmail(customerEmail, '🎉 Your Guest Account - India Cyber Cafe Store', html);
}

// Send order confirmation email to customer
export async function sendOrderConfirmationEmail(
  customerEmail: string, 
  customerName: string, 
  orderId: string,
  items: Array<{name: string, quantity: number, price: number}>,
  totalAmount: number,
  paymentMethod: 'online' | 'cod'
) {
  const html = emailTemplates.storeOrderConfirmation(customerName, orderId, items, totalAmount, paymentMethod);
  return sendEmail(customerEmail, `✅ Order Confirmed - ${orderId}`, html);
}

// Send order notification to admin
export async function sendAdminOrderNotification(
  orderId: string,
  customerName: string,
  customerEmail: string,
  customerPhone: string,
  items: Array<{name: string, quantity: number, price: number}>,
  totalAmount: number,
  paymentMethod: 'online' | 'cod',
  address: {
    addressLine1: string;
    city: string;
    state: string;
    pincode: string;
  }
) {
  const html = emailTemplates.adminStoreOrder(orderId, customerName, customerEmail, customerPhone, items, totalAmount, paymentMethod, address);
  return sendEmailToAllAdmins(`📦 New Store Order Received - ${orderId}`, html);
}
// Send order status update to customer
export async function sendOrderStatusUpdateEmail(
  customerEmail: string,
  customerName: string,
  orderId: string,
  newStatus: string,
  productName: string,
  estimatedDelivery?: string
) {
  const html = emailTemplates.orderStatusUpdate(customerName, orderId, newStatus, productName, estimatedDelivery);
  return sendEmail(customerEmail, `📦 Order Status Updated - ${orderId}`, html);
}

// Send order cancellation email to customer
export async function sendOrderCancellationEmail(
  customerEmail: string,
  customerName: string,
  orderId: string,
  productName: string,
  totalAmount: number,
  reason?: string
) {
  const html = emailTemplates.orderCancellation(customerName, orderId, productName, totalAmount, reason);
  return sendEmail(customerEmail, `❌ Order Cancelled - ${orderId}`, html);
}

// Send refund initiated email to customer
export async function sendRefundInitiatedEmail(
  customerEmail: string,
  customerName: string,
  orderId: string,
  refundAmount: number,
  expectedDays: number = 5
) {
  const html = emailTemplates.refundInitiated(customerName, orderId, refundAmount, expectedDays);
  return sendEmail(customerEmail, `💰 Refund Initiated - ${orderId}`, html);
}

// Send admin notification for refund
export async function sendAdminRefundNotification(
  orderId: string,
  customerName: string,
  customerEmail: string,
  refundAmount: number,
  reason?: string
) {
  const html = emailTemplates.adminRefundInitiated(orderId, customerName, customerEmail, refundAmount, reason);
  return sendEmailToAllAdmins(`💰 Refund Initiated - ${orderId}`, html);
}

// Send review confirmation email
export async function sendReviewConfirmationEmail(
  customerEmail: string,
  customerName: string,
  productName: string
) {
  const html = emailTemplates.reviewSubmitted(customerName, productName);
  return sendEmail(customerEmail, `⭐ Review Submitted - ${productName}`, html);
}

// Send admin notification for new review
export async function sendAdminReviewNotification(
  productName: string,
  customerName: string,
  rating: number,
  reviewText: string
) {
  const html = emailTemplates.adminNewReview(productName, customerName, rating, reviewText);
  return sendEmailToAllAdmins(`⭐ New Review Received - ${productName}`, html);
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
      <p><a href="https://booking.indiacybercafe.com/login" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Login to Your Account</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/track?id=${appId}" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Track Your Application</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Dashboard</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Check Your Dashboard</a></p>
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
        <li><strong>Login:</strong> Use your email/phone and this password to login at <a href="https://booking.indiacybercafe.com/login" style="color: #FF9933;">booking.indiacybercafe.com/login</a></li>
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
      
      <p style="margin-top: 20px;"><a href="https://booking.indiacybercafe.com/login" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Login to Your Account</a></p>
      
      <p style="margin-top: 20px; color: #666; font-size: 13px;">If you need any help, please contact our support team at <a href="mailto:icc@indiacybercafe.com" style="color: #FF9933;">icc@indiacybercafe.com</a> or visit <a href="https://booking.indiacybercafe.com" style="color: #FF9933;">booking.indiacybercafe.com</a></p>
      
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
      <p><a href="https://booking.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Your Applications</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/track?id=${appId}" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Download Certificate/Documents</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/profile" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Update Your Application</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/admin" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Review in Admin Panel</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/admin" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View User Details</a></p>
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
      <p><a href="https://booking.indiacybercafe.com/operator" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">View Assignment in Operator Panel</a></p>
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

  // ============= STORE ORDER TEMPLATES =============

  storeOrderConfirmation: (customerName: string, orderId: string, items: Array<{name: string, quantity: number, price: number}>, totalAmount: number, paymentMethod: string) => baseTemplate(
    '✅ Order Confirmed - India Cyber Cafe Store',
    `
      <p>Hello <strong>${customerName}</strong>,</p>
      <p>Thank you for your order! We have received your ${paymentMethod === 'cod' ? 'Cash on Delivery' : 'online payment'} order successfully.</p>
      
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Order ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${orderId}</code></p>
        <p style="margin: 5px 0;"><strong>Order Date:</strong> ${new Date().toLocaleDateString()}</p>
        <p style="margin: 5px 0;"><strong>Payment Method:</strong> ${paymentMethod === 'cod' ? '🚚 Cash on Delivery' : '💳 Online Payment'}</p>
      </div>

      <p style="margin-top: 20px; font-weight: bold; font-size: 16px;">📦 Order Details:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <thead>
          <tr style="background: #f0f0f0; border-bottom: 2px solid #FF9933;">
            <th style="padding: 10px; text-align: left;">Product</th>
            <th style="padding: 10px; text-align: center;">Qty</th>
            <th style="padding: 10px; text-align: right;">Price</th>
            <th style="padding: 10px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 10px; text-align: left;">${item.name}</td>
              <td style="padding: 10px; text-align: center;">${item.quantity}</td>
              <td style="padding: 10px; text-align: right;">₹${item.price.toFixed(2)}</td>
              <td style="padding: 10px; text-align: right;">₹${(item.quantity * item.price).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="background: #fff9e6; padding: 15px; border-radius: 8px; border: 1px solid #ffe6cc; text-align: right;">
        <p style="margin: 0; font-size: 18px; font-weight: bold; color: #FF9933;">Total Amount: ₹${totalAmount.toFixed(2)}</p>
      </div>

      <p style="margin-top: 20px; font-weight: bold; font-size: 16px;">📍 Next Steps:</p>
      ${paymentMethod === 'cod' 
        ? `<ol style="color: #555; line-height: 1.8; padding-left: 20px;">
            <li>Our team will process your order within 24 hours</li>
            <li>You will receive a confirmation call for delivery details</li>
            <li>Our delivery partner will contact you to arrange pickup/delivery</li>
            <li>Payment will be collected at the time of delivery</li>
          </ol>`
        : `<ol style="color: #555; line-height: 1.8; padding-left: 20px;">
            <li>Your payment has been received and confirmed</li>
            <li>Your order will be packed and dispatched within 24 hours</li>
            <li>You will receive tracking details via email/SMS</li>
            <li>Estimated delivery: 3-5 business days</li>
          </ol>`
      }

      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 0 0 10px 0; font-weight: bold;">📞 Need Help?</p>
        <ul style="margin: 0; padding-left: 20px; color: #555;">
          <li>Email: <a href="mailto:store@indiacybercafe.com" style="color: #FF9933;">store@indiacybercafe.com</a></li>
          <li>Call: +91-XXXXXXXXXX</li>
          <li>Website: <a href="https://booking.indiacybercafe.com" style="color: #FF9933;">booking.indiacybercafe.com</a></li>
        </ul>
      </div>

      <p style="margin-top: 20px; text-align: center;">
        <a href="https://booking.indiacybercafe.com" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Track Your Order</a>
      </p>

      <p style="margin-top: 20px; color: #666; font-size: 13px;">Thank you for shopping at India Cyber Cafe! 🎉</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Store Team</strong></p>
    `
  ),

  guestAccountWelcome: (customerName: string, email: string, tempPassword: string) => baseTemplate(
    '🎉 Your Guest Account - India Cyber Cafe Store',
    `
      <p>Hello <strong>${customerName}</strong>,</p>
      <p>Welcome to India Cyber Cafe! We've automatically created an account for you to make your future purchases faster and easier.</p>

      <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #FF9933; text-align: center;">
        <p style="margin: 0 0 10px 0; color: #333; font-size: 12px; font-weight: bold;">YOUR LOGIN CREDENTIALS</p>
        <p style="margin: 5px 0;"><strong>Email:</strong> <code style="background: #f0f0f0; padding: 2px 8px; border-radius: 3px; font-family: 'Courier New', monospace;">${email}</code></p>
        <p style="margin: 5px 0 15px 0;"><strong>Password:</strong> <code style="background: #f0f0f0; padding: 2px 8px; border-radius: 3px; font-family: 'Courier New', monospace; letter-spacing: 1px;">${tempPassword}</code></p>
      </div>

      <p><strong>🔐 How to Change Your Password:</strong></p>
      <ol style="color: #555; line-height: 1.8; padding-left: 20px;">
        <li>Visit <a href="https://booking.indiacybercafe.com/login" style="color: #FF9933;">booking.indiacybercafe.com/login</a></li>
        <li>Log in with your email and the password provided above</li>
        <li>Go to your <strong>Profile Settings</strong> → <strong>Security</strong></li>
        <li>Click <strong>"Change Password"</strong> and create a strong, personal password</li>
        <li>Use your new password for all future logins</li>
      </ol>

      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 0 0 10px 0; color: #FF9933; font-weight: bold;">💡 Account Benefits:</p>
        <ul style="margin: 0; padding-left: 20px; color: #555;">
          <li>✅ Track all your orders in real-time</li>
          <li>✅ Faster checkout on your next purchase</li>
          <li>✅ View order history and receipts</li>
          <li>✅ Save your preferred delivery address</li>
          <li>✅ Receive exclusive offers and updates</li>
        </ul>
      </div>

      <p style="background: #xffe6e6; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ff6b6b;">
        <strong>⚠️ Important Security Tips:</strong><br/>
        <span style="color: #555; font-size: 13px;">
          • Never share your password with anyone<br/>
          • Change your password as soon as you log in<br/>
          • Delete this email after you've noted your temporary password<br/>
          • If you didn't create this account, please contact us immediately
        </span>
      </p>

      <p style="margin-top: 20px;">
        <a href="https://booking.indiacybercafe.com/login" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Log In to Your Account</a>
      </p>

      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 0 0 10px 0; font-weight: bold;">📞 Need Help?</p>
        <ul style="margin: 0; padding-left: 20px; color: #555; font-size: 13px;">
          <li>Email: <a href="mailto:support@indiacybercafe.com" style="color: #FF9933;">support@indiacybercafe.com</a></li>
          <li>Phone: +91-XXXXXXXXXX</li>
          <li>Website: <a href="https://booking.indiacybercafe.com" style="color: #FF9933;">https://booking.indiacybercafe.com</a></li>
        </ul>
      </div>

      <p style="margin-top: 20px; color: #666; font-size: 13px;">Thank you for choosing India Cyber Cafe! We look forward to serving you. 🚀</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  // ============= ADMIN STORE TEMPLATES =============

  adminStoreOrder: (
    orderId: string,
    customerName: string,
    customerEmail: string,
    customerPhone: string,
    items: Array<{name: string, quantity: number, price: number}>,
    totalAmount: number,
    paymentMethod: string,
    address: {addressLine1: string; city: string; state: string; pincode: string}
  ) => baseTemplate(
    '📦 New Store Order Received - Admin Alert',
    `
      <p>Hello Admin,</p>
      <p>A new store order has been placed and requires your attention.</p>
      
      <div style="background: #e8f4f8; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Order ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${orderId}</code></p>
        <p style="margin: 5px 0;"><strong>Order Date:</strong> ${new Date().toLocaleString()}</p>
        <p style="margin: 5px 0;"><strong>Payment Method:</strong> ${paymentMethod === 'cod' ? '🚚 Cash on Delivery' : '💳 Online (Razorpay)'}</p>
      </div>

      <p style="margin-top: 15px; font-weight: bold; font-size: 16px;">👤 Customer Details:</p>
      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin: 10px 0;">
        <p style="margin: 5px 0;"><strong>Name:</strong> ${customerName}</p>
        <p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:${customerEmail}" style="color: #FF9933;">${customerEmail}</a></p>
        <p style="margin: 5px 0;"><strong>Phone:</strong> ${customerPhone}</p>
        <p style="margin: 5px 0;"><strong>Address:</strong> ${address.addressLine1}, ${address.city}, ${address.state} - ${address.pincode}</p>
      </div>

      <p style="margin-top: 15px; font-weight: bold; font-size: 16px;">📦 Order Items:</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <thead>
          <tr style="background: #f0f0f0; border-bottom: 2px solid #FF9933;">
            <th style="padding: 10px; text-align: left;">Product</th>
            <th style="padding: 10px; text-align: center;">Qty</th>
            <th style="padding: 10px; text-align: right;">Price</th>
            <th style="padding: 10px; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr style="border-bottom: 1px solid #eee;">
              <td style="padding: 10px; text-align: left;">${item.name}</td>
              <td style="padding: 10px; text-align: center;">${item.quantity}</td>
              <td style="padding: 10px; text-align: right;">₹${item.price.toFixed(2)}</td>
              <td style="padding: 10px; text-align: right;">₹${(item.quantity * item.price).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="background: #fff9e6; padding: 15px; border-radius: 8px; border: 1px solid #ffe6cc; text-align: right;">
        <p style="margin: 0; font-size: 16px; font-weight: bold; color: #FF9933;">Total Amount: ₹${totalAmount.toFixed(2)}</p>
      </div>

      <p style="margin-top: 20px; font-weight: bold;">📋 Next Steps:</p>
      <ol style="color: #555; line-height: 1.8; padding-left: 20px;">
        ${paymentMethod === 'cod' 
          ? `
            <li>Order is pending payment on delivery</li>
            <li>Arrange for packaging and dispatch</li>
            <li>Generate shipping label</li>
            <li>Update order status in admin panel</li>
            `
          : `
            <li>Payment has been received (confirm in bank)</li>
            <li>Prepare for immediate dispatch</li>
            <li>Generate shipping label</li>
            <li>Update order status as "Processing"</li>
            `
        }
      </ol>

      <p style="margin-top: 20px;">
        <a href="https://booking.indiacybercafe.com/admin" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">View in Admin Panel</a>
      </p>

      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  // ============= ORDER UPDATE TEMPLATES =============

  orderStatusUpdate: (customerName: string, orderId: string, status: string, productName: string, estimatedDelivery?: string) => baseTemplate(
    '📦 Order Status Updated',
    `
      <p>Hello <strong>${customerName}</strong>,</p>
      <p>Great news! Your order status has been updated.</p>
      
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>Order ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${orderId}</code></p>
        <p style="margin: 5px 0;"><strong>Product:</strong> ${productName}</p>
        <p style="margin: 5px 0;"><strong>New Status:</strong> <span style="background: #28a745; color: white; padding: 3px 10px; border-radius: 3px; font-weight: bold;">${status.toUpperCase()}</span></p>
        ${estimatedDelivery ? `<p style="margin: 5px 0;"><strong>Estimated Delivery:</strong> ${estimatedDelivery}</p>` : ''}
      </div>

      <p style="margin-top: 20px;">
        <a href="https://booking.indiacybercafe.com" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Track Your Order</a>
      </p>

      <p style="margin-top: 15px; font-size: 14px; color: #666;">Thank you for choosing India Cyber Cafe!</p>
      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  orderCancellation: (customerName: string, orderId: string, productName: string, totalAmount: number, reason?: string) => baseTemplate(
    '❌ Order Cancelled',
    `
      <p>Hello <strong>${customerName}</strong>,</p>
      <p>Your order has been cancelled as requested.</p>
      
      <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #ffc107;">
        <p style="margin: 5px 0;"><strong>Order ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${orderId}</code></p>
        <p style="margin: 5px 0;"><strong>Product:</strong> ${productName}</p>
        <p style="margin: 5px 0;"><strong>Cancelled Amount:</strong> ₹${totalAmount.toFixed(2)}</p>
        ${reason ? `<p style="margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
      </div>

      <p style="margin-top: 15px; font-weight: bold;">💰 Refund Information:</p>
      <ul style="color: #555; line-height: 1.8; padding-left: 20px;">
        <li>Refund amount: ₹${totalAmount.toFixed(2)}</li>
        <li>Refund will be processed within 5-7 business days</li>
        <li>The amount will be credited to your original payment method</li>
      </ul>

      <p style="margin-top: 20px; background: #f0f8ff; padding: 15px; border-radius: 8px; border-left: 4px solid #FF9933;">
        <strong>Need Help?</strong><br/>
        <span style="color: #555; font-size: 14px;">
          If you have any questions about this cancellation or refund, please contact our support team.
        </span>
      </p>

      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  refundInitiated: (customerName: string, orderId: string, refundAmount: number, expectedDays: number = 5) => baseTemplate(
    '💰 Refund Initiated',
    `
      <p>Hello <strong>${customerName}</strong>,</p>
      <p>Good news! Your refund has been initiated and processed.</p>
      
      <div style="background: #d4edda; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>Order ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${orderId}</code></p>
        <p style="margin: 5px 0;"><strong>Refund Amount:</strong> <span style="font-size: 18px; font-weight: bold; color: #28a745;">₹${refundAmount.toFixed(2)}</span></p>
        <p style="margin: 5px 0;"><strong>Expected Duration:</strong> ${expectedDays} business days</p>
        <p style="margin: 5px 0;"><strong>Status:</strong> <span style="background: #28a745; color: white; padding: 2px 8px; border-radius: 3px;">PROCESSING</span></p>
      </div>

      <p style="margin-top: 15px;"><strong>When will you receive the refund?</strong></p>
      <ol style="color: #555; line-height: 1.8; padding-left: 20px;">
        <li>Refund has been initiated from our end today</li>
        <li>Your bank usually processes refunds within ${expectedDays} business days</li>
        <li>The amount will be credited to your original payment method</li>
        <li>You'll receive a notification from your bank once it's credited</li>
      </ol>

      <p style="margin-top: 20px; background: #fff9e6; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
        <strong>💡 Tip:</strong> If the refund is not received within ${expectedDays} business days, <strong>please contact your bank</strong> - they may have additional processing time.
      </p>

      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  adminRefundInitiated: (orderId: string, customerName: string, customerEmail: string, refundAmount: number, reason?: string) => baseTemplate(
    '💰 Refund Initiated - Admin Alert',
    `
      <p>Hello Admin,</p>
      <p>A refund has been initiated for a store order.</p>
      
      <div style="background: #d4edda; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
        <p style="margin: 5px 0;"><strong>Order ID:</strong> <code style="background: #f0f0f0; padding: 2px 5px; border-radius: 3px;">${orderId}</code></p>
        <p style="margin: 5px 0;"><strong>Customer:</strong> ${customerName} (<a href="mailto:${customerEmail}" style="color: #FF9933;">${customerEmail}</a>)</p>
        <p style="margin: 5px 0;"><strong>Refund Amount:</strong> ₹${refundAmount.toFixed(2)}</p>
        <p style="margin: 5px 0;"><strong>Initiated:</strong> ${new Date().toLocaleString()}</p>
        ${reason ? `<p style="margin: 5px 0;"><strong>Reason:</strong> ${reason}</p>` : ''}
      </div>

      <p style="margin-top: 20px;">
        <a href="https://booking.indiacybercafe.com/admin" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">View in Admin Panel</a>
      </p>

      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),

  reviewSubmitted: (customerName: string, productName: string) => baseTemplate(
    '⭐ Review Submitted',
    `
      <p>Hello <strong>${customerName}</strong>,</p>
      <p>Thank you for submitting your review for <strong>${productName}</strong>!</p>
      
      <div style="background: #f0f8ff; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 0;">Your review has been received and will be displayed on the product page after verification by our team. We appreciate your feedback!</p>
      </div>

      <p style="margin-top: 15px; color: #666; font-size: 14px;">Your review helps other customers make informed decisions and also helps us improve our products and services.</p>

      <p style="margin-top: 20px;">
        <a href="https://booking.indiacybercafe.com/store" style="background: #FF9933; color: white; padding: 10px 20px; border-radius: 5px; text-decoration: none; display: inline-block;">Visit Store</a>
      </p>

      <p>Best Regards,<br/><strong>India Cyber Cafe Team</strong></p>
    `
  ),

  adminNewReview: (productName: string, customerName: string, rating: number, reviewText: string) => baseTemplate(
    '⭐ New Review Received',
    `
      <p>Hello Admin,</p>
      <p>A new review has been submitted for <strong>${productName}</strong>.</p>
      
      <div style="background: #fff9e6; padding: 15px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #FF9933;">
        <p style="margin: 5px 0;"><strong>Product:</strong> ${productName}</p>
        <p style="margin: 5px 0;"><strong>Customer:</strong> ${customerName}</p>
        <p style="margin: 5px 0;"><strong>Rating:</strong> ${'⭐'.repeat(rating)} (${rating}/5)</p>
        <p style="margin: 10px 0 0 0;"><strong>Review:</strong></p>
        <p style="margin: 10px 0; font-style: italic; color: #555;">"${reviewText}"</p>
      </div>

      <p style="margin-top: 20px;">
        <a href="https://booking.indiacybercafe.com/admin" style="background: #FF9933; color: white; padding: 12px 30px; border-radius: 5px; text-decoration: none; display: inline-block; font-weight: bold;">Review in Admin Panel</a>
      </p>

      <p>Best Regards,<br/><strong>India Cyber Cafe System</strong></p>
    `
  ),
};
