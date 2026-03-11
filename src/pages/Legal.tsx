import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { IconRenderer } from '../components/Icons';

export function Legal() {
  const { type } = useParams<{ type: string }>();

  const content = {
    terms: {
      title: "Terms and Conditions",
      sections: [
        {
          heading: "1. Acceptance of Terms",
          text: "By accessing and using India Cyber Cafe (https://indiacybercafe.com and https://b.indiacybercafe.com), you agree to comply with and be bound by these Terms and Conditions. Our services are available only to Indian citizens residing in India."
        },
        {
          heading: "2. Nature of Services",
          text: "India Cyber Cafe provides online consulting, form-filling assistance, government scheme guidance, and document preparation support. We are a private entity and are NOT affiliated with any government authority. Our services are advisory in nature."
        },
        {
          heading: "3. User Responsibilities",
          text: "Users are responsible for providing accurate, complete, and truthful information. India Cyber Cafe is not liable for any rejections or delays caused by incorrect data provided by the client."
        },
        {
          heading: "4. Limitation of Liability",
          text: "While we strive for accuracy, we do not guarantee any specific result or approval from government departments. Our liability is limited to the professional fee paid for the specific service."
        },
        {
          heading: "5. Payment Terms",
          text: "All payments are processed securely via Razorpay. Service fees must be paid in advance or as per the specific service terms. Consultation fees are non-refundable once the service has been initiated."
        }
      ]
    },
    privacy: {
      title: "Privacy Policy",
      sections: [
        {
          heading: "1. Data Collection",
          text: "We collect personal information such as name, email, phone number, and necessary documents solely for the purpose of providing the requested consulting services."
        },
        {
          heading: "2. Data Protection",
          text: "Your data is stored securely and accessed only by authorized personnel. We implement industry-standard security measures to protect against unauthorized access, alteration, or disclosure."
        },
        {
          heading: "3. Information Sharing",
          text: "We do not sell, trade, or rent your personal information to third parties. Data is shared only with relevant government portals or service providers as required to complete your application."
        },
        {
          heading: "4. Cookies",
          text: "Our website uses cookies to enhance user experience and analyze site traffic. You can choose to disable cookies through your browser settings."
        }
      ]
    },
    refund: {
      title: "Refund and Cancellation Policy",
      sections: [
        {
          heading: "1. Cancellation",
          text: "Users can request cancellation within 2 hours of booking, provided the processing has not started. Once an operator begins working on your file, cancellation is not possible."
        },
        {
          heading: "2. Refund Eligibility",
          text: "Refunds are only issued in cases of non-delivery of service due to technical errors on our part. Fees are non-refundable if an application is rejected by a government department or if the user provides incorrect information."
        },
        {
          heading: "3. Processing Time",
          text: "Approved refunds will be processed within 5–7 working days and credited back to the original payment method used during the transaction."
        }
      ]
    },
    disclaimer: {
      title: "Disclaimer",
      sections: [
        {
          heading: "No Government Affiliation",
          text: "India Cyber Cafe is a private consulting firm. We are NOT an official government agency. We provide assistance and guidance for a fee to help citizens navigate various digital and government portals."
        },
        {
          heading: "No Guarantee of Results",
          text: "Our services are based on 'best effort' assistance. We do not guarantee the approval of any application, as the final decision rests solely with the respective government authorities."
        },
        {
          heading: "Information Accuracy",
          text: "The information provided on our website is for general guidance only. Users should verify critical information from official government sources before making decisions."
        }
      ]
    },
    about: {
      title: "About Us",
      sections: [
        {
          heading: "Our Story",
          text: "Operating since 2024, India Cyber Cafe was founded with the mission to bridge the digital divide in India. We specialize in helping citizens navigate the complexities of online government services and digital documentation."
        },
        {
          heading: "Our Mission",
          text: "To provide fast, reliable, and transparent digital consulting services to every Indian citizen, ensuring that technology becomes an enabler rather than a barrier."
        },
        {
          heading: "Why Choose Us?",
          text: "With 24/7 support, secure payment processing via Razorpay, and a dedicated team of experts, we ensure your digital needs are handled with the utmost care and professionalism."
        }
      ]
    },
    contact: {
      title: "Contact Us",
      sections: [
        {
          heading: "Get in Touch",
          text: "We are here to help you 24/7. Reach out to us through any of the following channels:"
        },
        {
          heading: "Email Support",
          text: "icc@b.indiacybercafe.com\nicc@indiacybercafe.com"
        },
        {
          heading: "Phone",
          text: "+91-9203251821"
        },
        {
          heading: "Office Address",
          text: "House No. 72, Ward No. 04, Village Jobgarh, Post Daga Bargawan, Tehsil Bargawan, District Singrauli, Madhya Pradesh, 486886, India"
        }
      ]
    }
  };

  const page = content[type as keyof typeof content] || content.about;

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl p-8 sm:p-12 border border-slate-100"
      >
        <div className="flex items-center gap-4 mb-8 border-b pb-6">
          <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
            <IconRenderer name="shield-check" className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-navy">{page.title}</h1>
        </div>

        <div className="space-y-8">
          {page.sections.map((section, i) => (
            <section key={i} className="space-y-3">
              <h2 className="text-xl font-bold text-navy flex items-center gap-2">
                <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                {section.heading}
              </h2>
              <div className="text-slate-600 leading-relaxed whitespace-pre-line">
                {section.text}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-slate-100 text-center">
          <p className="text-slate-400 text-sm">
            © {new Date().getFullYear()} India Cyber Cafe. All rights reserved.
          </p>
          <div className="flex justify-center gap-4 mt-4">
            <Link to="/legal/privacy" className="text-xs text-primary hover:underline">Privacy</Link>
            <Link to="/legal/terms" className="text-xs text-primary hover:underline">Terms</Link>
            <Link to="/legal/refund" className="text-xs text-primary hover:underline">Refunds</Link>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
