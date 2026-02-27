import { useParams } from 'react-router-dom';
import { motion } from 'motion/react';

export function Legal() {
  const { type } = useParams<{ type: string }>();

  const content = {
    terms: {
      title: "Terms & Conditions",
      text: `
        Welcome to India Cyber Cafe. By using our services, you agree to the following terms:
        1. All information provided during application must be accurate and truthful.
        2. We act as a facilitator for government and private services; final approval depends on the respective authorities.
        3. Service charges are non-refundable once the application process has started.
        4. Users are responsible for maintaining the confidentiality of their login credentials.
        5. Any misuse of the portal for illegal activities will result in immediate account termination.
      `
    },
    privacy: {
      title: "Privacy Policy",
      text: `
        At India Cyber Cafe, we value your privacy. 
        1. We collect personal data (Name, Email, Phone, Documents) only for processing your requested services.
        2. Your documents are stored securely and are only accessible by authorized operators and administrators.
        3. We do not sell or share your personal information with third-party marketing agencies.
        4. Payment information is handled through secure encrypted gateways (like Razorpay).
        5. You have the right to request the deletion of your data at any time.
      `
    },
    licenses: {
      title: "Licenses & Permissions",
      text: `
        India Cyber Cafe operates under valid business registrations.
        1. We are an authorized service provider for various digital and cyber services.
        2. All software and tools used on this platform are properly licensed.
        3. Users are granted a limited license to use this portal for personal service applications only.
        4. Reproduction or redistribution of any part of this portal without permission is prohibited.
      `
    }
  };

  const page = content[type as keyof typeof content] || content.terms;

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl p-8 sm:p-12 border border-slate-100"
      >
        <h1 className="text-4xl font-bold text-navy mb-8 border-b pb-4">{page.title}</h1>
        <div className="prose prose-slate max-w-none">
          {page.text.split('\n').map((line, i) => (
            <p key={i} className="text-slate-600 leading-relaxed mb-4">
              {line.trim()}
            </p>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
