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
  registration: (name: string) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #FF9933;">Welcome to India Cyber Cafe!</h2>
      <p>Hello <strong>${name}</strong>,</p>
      <p>Thank you for registering with India Cyber Cafe. We are excited to have you on board!</p>
      <p>You can now apply for various cyber services directly from our portal.</p>
      <br/>
      <p>Best Regards,<br/>India Cyber Cafe Team</p>
    </div>
  `,
  applicationSubmitted: (name: string, serviceName: string, appId: string) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #FF9933;">Application Received</h2>
      <p>Hello <strong>${name}</strong>,</p>
      <p>Your application for <strong>${serviceName}</strong> has been successfully submitted.</p>
      <p><strong>Application ID:</strong> ${appId}</p>
      <p>Our team will review your application and update you soon.</p>
      <br/>
      <p>Best Regards,<br/>India Cyber Cafe Team</p>
    </div>
  `,
  statusUpdate: (name: string, serviceName: string, status: string) => `
    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #FF9933;">Status Update</h2>
      <p>Hello <strong>${name}</strong>,</p>
      <p>The status of your application for <strong>${serviceName}</strong> has been updated to: <strong style="text-transform: uppercase;">${status}</strong>.</p>
      <p>Please log in to your dashboard to see more details.</p>
      <br/>
      <p>Best Regards,<br/>India Cyber Cafe Team</p>
    </div>
  `
};
