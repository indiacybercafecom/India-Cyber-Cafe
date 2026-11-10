import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';

export function Legal() {
  const { type = 'privacy' } = useParams<{ type: string }>();

  const activeType = ['terms', 'privacy', 'refund', 'disclaimer', 'about', 'contact'].includes(type)
    ? type
    : 'privacy';

  return (
    <>
      <SEO
        title={`${
          activeType === 'privacy'
            ? 'Privacy Policy & DPDP Notice'
            : activeType === 'terms'
            ? 'Terms & Conditions'
            : activeType === 'refund'
            ? 'Refund & Cancellation Policy'
            : activeType === 'disclaimer'
            ? 'Disclaimer & Non-Affiliation'
            : activeType === 'contact'
            ? 'Contact & Grievance Redressal'
            : 'About Us'
        } - India Cyber Cafe`}
        description="Official legal disclosures, Digital Personal Data Protection (DPDP) compliance notices, terms of service, grievance redressal, and policies for India Cyber Cafe."
        url={`https://b.indiacybercafe.com/legal/${activeType}`}
        keywords="privacy policy, terms of service, dpdp act compliance, refund policy, grievance redressal, india cyber cafe"
        ogType="article"
      />

      <div className="max-w-5xl mx-auto py-8 sm:py-12 px-4">
        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-8 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
          {[
            { id: 'privacy', label: 'Privacy Policy', icon: 'shield-check' },
            { id: 'terms', label: 'Terms of Service', icon: 'document-text' },
            { id: 'refund', label: 'Refund & Cancellation', icon: 'currency-rupee' },
            { id: 'disclaimer', label: 'Disclaimer', icon: 'exclamation-circle' },
            { id: 'contact', label: 'Contact & Grievance', icon: 'phone' },
            { id: 'about', label: 'About Us', icon: 'information-circle' },
          ].map(tab => (
            <Link
              key={tab.id}
              to={`/legal/${tab.id}`}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeType === tab.id
                  ? 'bg-white text-navy shadow-sm'
                  : 'text-slate-600 hover:text-navy hover:bg-white/50'
              }`}
            >
              <IconRenderer name={tab.icon as any} className="w-4 h-4 text-primary" />
              <span>{tab.label}</span>
            </Link>
          ))}
        </div>

        <motion.div
          key={activeType}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="bg-white rounded-3xl shadow-xl p-6 sm:p-12 border border-slate-100"
        >
          {/* PRIVACY POLICY & DPDP NOTICE */}
          {activeType === 'privacy' && (
            <div className="space-y-8">
              <div className="flex items-center gap-4 border-b pb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                  <IconRenderer name="shield-check" className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">
                    Privacy Notice & DPDP Compliance
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Effective Date: 1 January 2025 • Last Updated: 27 October 2026 • Compliant with DPDP Act, 2023
                  </p>
                </div>
              </div>

              {/* Grievance & Privacy Portal Quick Action */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <h3 className="font-bold text-navy text-sm sm:text-base">Dedicated Privacy & Grievance Portal</h3>
                  </div>
                  <p className="text-xs text-slate-600">
                    Exercise your statutory rights (Access, Correction, Erasure, Grievance, or Consent Withdrawal) via our online tracking system.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    to="/privacy-request"
                    className="btn-primary text-xs px-4 py-2.5 whitespace-nowrap"
                  >
                    Submit Privacy Request
                  </Link>
                  <Link
                    to="/privacy-request/track"
                    className="bg-white hover:bg-slate-50 text-navy border border-slate-200 font-semibold text-xs px-4 py-2.5 rounded-xl whitespace-nowrap transition-colors"
                  >
                    Track Request
                  </Link>
                </div>
              </div>

              {/* 1. Entity & Scope */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  1. Data Fiduciary Identity & Overview
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    <strong>India Cyber Cafe</strong> (hereinafter referred to as <em>"ICC"</em>, <em>"we"</em>, <em>"our"</em>, or <em>"us"</em>) operates the web applications accessible at <code className="bg-slate-100 px-1 py-0.5 rounded text-navy">indiacybercafe.com</code> and <code className="bg-slate-100 px-1 py-0.5 rounded text-navy">b.indiacybercafe.com</code>. We provide digital consultation, document assistance, form-filling facilitation, and cyber cafe supplies to citizens across India.
                  </p>
                  <p>
                    This Privacy Notice governs our processing of personal data in compliance with the <strong>Digital Personal Data Protection Act, 2023 (DPDP Act)</strong>, the <strong>Information Technology Act, 2000</strong>, and applicable Consumer Protection rules.
                  </p>
                </div>
              </section>

              {/* 2. Categories of Data Collected */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  2. Categories of Personal Data Collected
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-3">
                  <p>We only collect personal information that is strictly necessary for fulfilling your specific service requests:</p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li><strong>Contact & Profile Information:</strong> Full name, telephone/mobile number, email address, physical delivery/postal address, state, and pincode.</li>
                    <li><strong>Service & Application Details:</strong> Candidate/applicant details (e.g. date of birth, parentage, educational qualifications, exam application parameters) provided voluntarily by you in service forms.</li>
                    <li><strong>Uploaded Documents:</strong> Scanned copies of identity proofs, marks-sheets, caste/category certificates, signatures, and passport photographs uploaded solely to file authorized applications.</li>
                    <li><strong>Payment Metadata:</strong> Transaction reference IDs, payment method, order total, and payment status. <em>Important: India Cyber Cafe does NOT store debit/credit card numbers, CVVs, or UPI PINs. All financial card transactions are handled exclusively by PCI-DSS compliant Razorpay.</em></li>
                    <li><strong>Technical & Consent Logs:</strong> Browser user agent, timestamp of consent preferences, IP address, and cookie consent audit records stored in your browser's localStorage.</li>
                  </ul>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-amber-900 text-xs">
                    <strong>Notice on Passwords:</strong> We do NOT intercept, alter, crack, or harvest your government portal passwords. If an application requires login to an official government portal, you retain complete authority over your login credentials.
                  </div>
                </div>
              </section>

              {/* 3. Specific Purposes of Processing */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  3. Specific Purposes for Processing
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>We process personal data only under specific, lawful purposes:</p>
                  <ul className="list-disc list-inside space-y-1 pl-2">
                    <li>To verify, draft, and submit the requested government or service applications on designated portals as instructed by you.</li>
                    <li>To dispatch printed documents, stationery, or store merchandise to your designated delivery address.</li>
                    <li>To generate official invoices and maintain tax compliance under Indian Goods and Services Tax (GST) laws.</li>
                    <li>To provide customer support, status updates, and respond to call-back requests requested by you.</li>
                    <li>To detect, prevent, and mitigate fraud, spam, and technical security incidents.</li>
                  </ul>
                </div>
              </section>

              {/* 4. Recipients and Third-Party Processors */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  4. Service Providers & Third-Party Recipients
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>We do not sell, rent, or trade your personal data. We disclose data solely to the following categories of recipients:</p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li><strong>Official Government & Examination Portals:</strong> When you engage us to submit an application (e.g. SSC, UPSC, State PSC, NSDL, UIDAI, or University portals), your submitted details are entered directly on the respective official portal.</li>
                    <li><strong>Razorpay Software Private Limited:</strong> Payment processing partner for secure UPI, netbanking, and card transactions under PCI-DSS certification.</li>
                    <li><strong>Google Cloud & Firebase:</strong> Encrypted hosting, Realtime Database, and cloud storage infrastructure with servers in compliant regions.</li>
                    <li><strong>Logistics & Courier Partners:</strong> For dispatching physical store orders (e.g. India Post, Delhivery, or local couriers).</li>
                    <li><strong>Law Enforcement & Statutory Bodies:</strong> Solely when compelled by a valid legal process, judicial order, or statutory requirement under Indian law.</li>
                  </ul>
                </div>
              </section>

              {/* 5. Tracking & Cookies Inventory */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  5. Cookie & Tracking Audit Inventory
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  In accordance with the DPDP Playbook, we disclose our comprehensive inventory of client-side technologies, their purposes, triggers, and controls:
                </p>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="min-w-full text-xs text-left">
                    <thead className="bg-slate-100 text-navy font-bold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5">Tool / Technology</th>
                        <th className="px-3 py-2.5">Purpose</th>
                        <th className="px-3 py-2.5">Trigger Condition</th>
                        <th className="px-3 py-2.5">Retention</th>
                        <th className="px-3 py-2.5">Consent Controls</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-600">
                      <tr>
                        <td className="px-3 py-2 font-semibold text-navy">Consent Manager (LocalStorage)</td>
                        <td className="px-3 py-2">Stores consent choices & audit timestamp</td>
                        <td className="px-3 py-2">Strictly Necessary (always active)</td>
                        <td className="px-3 py-2">12 Months</td>
                        <td className="px-3 py-2">Built-in Preference Center</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-semibold text-navy">Razorpay Checkout SDK</td>
                        <td className="px-3 py-2">Process secure payments for services/store</td>
                        <td className="px-3 py-2">Triggered only upon clicking Pay / Checkout</td>
                        <td className="px-3 py-2">Session only</td>
                        <td className="px-3 py-2">Strictly Necessary for orders</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-semibold text-navy">Google / Firebase Analytics</td>
                        <td className="px-3 py-2">Aggregated visitor metrics & page performance</td>
                        <td className="px-3 py-2 font-medium text-emerald-700">Fires ONLY if user explicitly grants consent</td>
                        <td className="px-3 py-2">14 Months</td>
                        <td className="px-3 py-2">Opt-in banner / Toggle anytime in footer</td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-semibold text-navy">Marketing & Pixels</td>
                        <td className="px-3 py-2">Promotional campaigns & tailored offers</td>
                        <td className="px-3 py-2">Currently NONE active (disabled by default)</td>
                        <td className="px-3 py-2">N/A</td>
                        <td className="px-3 py-2">Optional Opt-in only</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 6. Children's Data Safeguards */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  6. Children's Data Protection Policy
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    In compliance with the DPDP framework and statutory safeguards:
                  </p>
                  <ul className="list-disc list-inside space-y-1 pl-2">
                    <li>Our services for minors (individuals below 18 years of age, such as school scholarship forms or board exam registrations) require the explicit declaration and verifiable consent of a parent or legal guardian.</li>
                    <li>We do NOT perform behavioral tracking, profiling, or targeted advertising directed at children.</li>
                    <li>We collect only the minimum required fields needed for the designated scholarship/examination form.</li>
                  </ul>
                </div>
              </section>

              {/* 7. Data Retention Criteria */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  7. Data Retention & Erasure Schedule
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    We retain personal data strictly according to statutory criteria:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li><strong>Completed Applications:</strong> Retained for 3 years from service completion for dispute resolution, audit verification, and consumer protection accountability.</li>
                    <li><strong>Uploaded Identification Files:</strong> Purged from cloud storage within 90 days after service delivery upon customer verification or upon valid erasure request.</li>
                    <li><strong>Invoicing & Tax Records:</strong> Retained for 7 years in accordance with Indian GST and taxation legislation.</li>
                    <li><strong>Call-Back Inquiries:</strong> Retained for 30 days after call completion, then automatically discarded.</li>
                  </ul>
                </div>
              </section>

              {/* 8. Data Principal Rights */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  8. Your Rights Under the DPDP Act
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>As a Data Principal, you have the following enforceable rights:</p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li><strong>Right to Access:</strong> You may request a summary of personal data being processed about you and the categories of entities with whom it was shared.</li>
                    <li><strong>Right to Correction & Updating:</strong> You may request the correction of inaccurate or incomplete personal information.</li>
                    <li><strong>Right to Erasure:</strong> You may request the deletion of your personal data when the original purpose of processing is fulfilled.</li>
                    <li><strong>Right of Grievance Redressal:</strong> You may lodge a complaint with our designated Grievance Officer and subsequently escalate to the Data Protection Board of India.</li>
                    <li><strong>Right to Nominate:</strong> You may designate an individual who shall exercise your rights in the event of death or incapacity.</li>
                    <li><strong>Right to Withdraw Consent:</strong> You may withdraw consent at any time without affecting lawful processing carried out prior to withdrawal.</li>
                  </ul>
                </div>
              </section>

              {/* 9. Grievance Officer & Redressal */}
              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  9. Statutory Grievance Redressal Officer
                </h2>
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-3">
                  <p className="text-xs sm:text-sm text-slate-600">
                    Pursuant to the DPDP Act 2023, Information Technology Rules, and Consumer Protection (E-Commerce) Rules, 2020, India Cyber Cafe has designated the following Grievance Officer:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-700">
                    <div>
                      <p className="font-semibold text-navy">Designation:</p>
                      <p>Grievance Redressal & Privacy Officer</p>
                    </div>
                    <div>
                      <p className="font-semibold text-navy">Entity Name:</p>
                      <p>India Cyber Cafe</p>
                    </div>
                    <div>
                      <p className="font-semibold text-navy">Official Email:</p>
                      <p className="text-primary font-medium">icc@indiacybercafe.com</p>
                      <p className="text-slate-500 text-[11px]">indiacybercafe.com@gmail.com</p>
                    </div>
                    <div>
                      <p className="font-semibold text-navy">Office Address:</p>
                      <p>House No. 72, Ward No. 04, Jobgarh, Post Daga Bargawan, Tehsil Bargawan, Singrauli, MP - 486886, India</p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-slate-200 text-xs text-slate-600">
                    <strong>Timelines:</strong> All grievances are acknowledged within <strong>48 hours</strong> and redressed within <strong>15 to 30 days</strong>. You can initiate a complaint instantly through our <Link to="/privacy-request" className="text-primary underline font-semibold">Online Privacy Grievance System</Link>.
                  </div>
                </div>
              </section>

              {/* 10. Google Drive Integration & Document Storage */}
              <section className="space-y-3 pt-2">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  10. Google Drive Integration and Document Storage
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-3">
                  <p>
                    India Cyber Cafe provides a personal document management service titled <strong>"My Documents"</strong>. The storage, transmission, and processing of files under this service are governed by strict zero-retention principles and the following explicit disclosures:
                  </p>
                  <ul className="list-disc list-inside space-y-2 pl-2">
                    <li>
                      <strong>Personal Google Drive Connection:</strong> Users may voluntarily connect their personal Google Drive account to manage documents (such as certificates, educational marks-sheets, and identity proofs).
                    </li>
                    <li>
                      <strong>Separate Authorization from Sign-In:</strong> Google Drive authorization is requested as a separate, distinct opt-in permission and is completely independent of initial Google Login authentication.
                    </li>
                    <li>
                      <strong>User-Owned Storage Architecture:</strong> All document files uploaded or organized through My Documents are stored exclusively in the user's personal Google Drive. India Cyber Cafe does NOT store, replicate, or host your document files on its servers or hosting infrastructure.
                    </li>
                    <li>
                      <strong>No Permanent ICC Server Storage:</strong> User files are never permanently saved to India Cyber Cafe web hosting, Hostinger servers, local disk directories, or server databases.
                    </li>
                    <li>
                      <strong>No Firebase Storage of User Documents:</strong> Firebase Storage is not used to hold or store document files uploaded in the My Documents application.
                    </li>
                    <li>
                      <strong>No Shared Drive Repository:</strong> India Cyber Cafe does not operate or maintain a shared, aggregated, or centralized Google Drive for user documents. Each user's documents remain strictly isolated within their own individual Google account.
                    </li>
                    <li>
                      <strong>Zero Sale of Google Drive Data:</strong> India Cyber Cafe does not sell, license, lease, or monetize your Google Drive data or documents under any circumstances.
                    </li>
                    <li>
                      <strong>No Advertising or Profiling:</strong> We do not use, scan, or analyze your Google Drive files or metadata for targeted advertising, marketing campaigns, or behavioral profiling.
                    </li>
                    <li>
                      <strong>Authorized Functionality Only:</strong> We access and process only files that you create, upload, or explicitly open through our application, strictly for providing requested document management features.
                    </li>
                    <li>
                      <strong>Transient In-Memory Processing:</strong> When you upload, preview, or download a file through our interface, file data is streamed transiently in system memory. No permanent copies or disk caches are created on our servers.
                    </li>
                    <li>
                      <strong>Account Metadata & Encrypted Credentials:</strong> We store only essential non-content metadata in our secure backend (such as your Firebase UID, connection status, created folder IDs, and preferences). OAuth authorization refresh tokens are securely encrypted at rest using industry-standard AES-256-GCM encryption and are never exposed to client-side scripts.
                    </li>
                    <li>
                      <strong>User Revocation & Disconnection:</strong> You may disconnect your Google Drive at any time through the dashboard. Upon disconnection, your stored authorization tokens are permanently cleared and revoked.
                    </li>
                    <li>
                      <strong>Preservation of Original Drive Files:</strong> Disconnecting your Google Drive from India Cyber Cafe does NOT delete, alter, or remove your documents. All original files remain 100% intact in your personal Google Drive.
                    </li>
                    <li>
                      <strong>OAuth Scope & Token Security:</strong> We utilize the restricted <code>https://www.googleapis.com/auth/drive.file</code> scope, which restricts our application's access exclusively to files and folders created or opened by India Cyber Cafe.
                    </li>
                    <li>
                      <strong>Account Data Deletion:</strong> If you delete your India Cyber Cafe account or request data erasure under the DPDP Act, all connection records and metadata are permanently expunged within 30 days.
                    </li>
                  </ul>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 mt-3">
                    <h4 className="font-bold text-navy text-xs sm:text-sm">Google API Services User Data Policy Compliance</h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      India Cyber Cafe's use and transfer to any other app of information received from Google APIs will adhere to the{' '}
                      <a
                        href="https://developers.google.com/terms/api-services-user-data-policy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline font-medium"
                      >
                        Google API Services User Data Policy
                      </a>
                      , including the Limited Use requirements.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* TERMS OF SERVICE */}
          {activeType === 'terms' && (
            <div className="space-y-8">
              <div className="flex items-center gap-4 border-b pb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                  <IconRenderer name="document-text" className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">
                    Terms & Conditions of Service
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Governing use of services, online store, and digital assistance provided by India Cyber Cafe
                  </p>
                </div>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  1. Acceptance & Eligibility
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    By accessing or using the India Cyber Cafe platform (<code className="bg-slate-100 px-1 py-0.5 rounded text-navy">indiacybercafe.com</code> and <code className="bg-slate-100 px-1 py-0.5 rounded text-navy">b.indiacybercafe.com</code>), you agree to be bound by these Terms and Conditions. Our services are available to citizens and residents of India competent to contract under the Indian Contract Act, 1872.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  2. Nature of Services & Independent Facilitator Notice
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    <strong>India Cyber Cafe is an independent private consultancy and digital facilitation center.</strong> We are <em>NOT</em> a government authority, affiliated department, or regulatory body. We provide clerical, advisory, form-filling, documentation assistance, and cyber cafe stationery products for a professional service fee.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  3. User Warranties & Accuracy of Documents
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    You explicitly warrant that all identity details, qualification proofs, certificates, and information submitted by you are accurate, genuine, and legally owned by you. India Cyber Cafe accepts no liability whatsoever for application rejections, delays, penalties, or disqualifications resulting from inaccurate, fraudulent, or forged documents provided by the user.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  4. Payment, Fees, & Electronic Invoicing
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    All service facilitation fees must be paid in advance via our authorized payment partner, Razorpay. Electronic receipts and invoice records are generated and sent to your registered email address upon payment confirmation.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  5. Limitation of Liability
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    While we exercise reasonable skill and care in executing application filings, government portal downtimes, server maintenance, policy amendments, or selection/admission outcomes are strictly beyond our control. In no event shall our total liability exceed the professional service facilitation fee paid by you for the specific transaction.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  6. Governing Law & Jurisdiction
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    These Terms are governed by the laws of the Republic of India. Any legal disputes arising out of or in connection with our services shall be subject to the exclusive jurisdiction of the competent courts in Singrauli, Madhya Pradesh, India.
                  </p>
                </div>
              </section>

              {/* 7. My Documents – Google Drive Service */}
              <section className="space-y-3 pt-2">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  7. My Documents – Google Drive Service
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    The "My Documents" feature enables users to view, organize, and store personal documents within their own personal Google Drive accounts. By utilizing this service, you acknowledge and agree that:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li><strong>User-Controlled Storage:</strong> All document files are stored directly in your personal Google Drive. India Cyber Cafe acts solely as an interface and does not own or host your documents.</li>
                    <li><strong>Google Storage Quotas & Service Limits:</strong> Document uploads are subject to your personal Google Drive storage capacity, quotas, and Google's Terms of Service. India Cyber Cafe is not responsible for failed uploads caused by exhausted Google Drive storage.</li>
                    <li><strong>User Responsibility for Content:</strong> You retain sole responsibility for the legality, authenticity, and contents of files uploaded to your Google Drive. You agree not to upload fraudulent, malicious, pirated, or unlawful materials.</li>
                    <li><strong>Authorization of File Actions:</strong> You explicitly authorize India Cyber Cafe to perform requested file operations (such as folder creation, renaming, moving, and trash operations) on your behalf via the Google Drive API.</li>
                    <li><strong>Disconnection & Retention:</strong> You may disconnect your Google Drive at any time. Disconnecting removes our authorization but preserves all original files and folders in your Google Drive without loss.</li>
                    <li><strong>Safe Deletion (Google Drive Trash):</strong> Deleting a file or folder through the India Cyber Cafe interface moves the item to your Google Drive Trash. Items in Trash remain recoverable in accordance with Google Drive's standard 30-day trash retention policy.</li>
                    <li><strong>Service Availability & API Restrictions:</strong> The availability of previewing and streaming files is subject to Google Cloud service uptime and API rate limitations. In-app previews are supported for PDFs, images, and text; Office formats may open via Google Drive preview links.</li>
                  </ul>
                </div>
              </section>
            </div>
          )}

          {/* REFUND & CANCELLATION */}
          {activeType === 'refund' && (
            <div className="space-y-8">
              <div className="flex items-center gap-4 border-b pb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                  <IconRenderer name="currency-rupee" className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">
                    Refund & Cancellation Policy
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Transparent refund guidelines compliant with Consumer Protection (E-Commerce) Rules, 2020
                  </p>
                </div>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  1. Statutory Portal Fees vs. Service Facilitation Charges
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    It is vital to understand the two components of any digital service transaction:
                  </p>
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li><strong>Statutory Government Portal Fees:</strong> When an application fee, examination challan, or stamp duty is paid directly to a government authority (e.g. UPSC, SSC, NSDL, State Examination Boards), those fees are governed strictly by the government authority's rules and are <em>strictly non-refundable once remitted</em>.</li>
                    <li><strong>India Cyber Cafe Service Facilitation Fee:</strong> Our professional fee for drafting, uploading, checking, and filing the service application.</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  2. Cancellation Window & Refund Eligibility
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <ul className="list-disc list-inside space-y-1.5 pl-2">
                    <li><strong>Full Refund of Service Charges:</strong> You may cancel your service request within <strong>2 hours</strong> of booking, provided our operators have not initiated document processing or portal submission.</li>
                    <li><strong>Technical Non-Delivery:</strong> If a service cannot be completed due to a verifiable technical fault or system error on our platform, 100% of the service facilitation fee will be promptly refunded.</li>
                    <li><strong>Non-Refundable Scenarios:</strong> Fees cannot be refunded if an application has already been processed and submitted to the official portal, if the government department rejects an application due to candidate ineligibility, or if the user provided inaccurate information.</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  3. Physical Store Order Returns & Cancellations
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    For items ordered from our Store:
                  </p>
                  <ul className="list-disc list-inside space-y-1 pl-2">
                    <li>Standard items may be cancelled prior to dispatch.</li>
                    <li>Personalized or custom-printed products (e.g. customized photo frames, mugs, ID cards) cannot be cancelled once printing production has begun.</li>
                    <li>Damaged on arrival items are eligible for replacement or full refund upon submitting unboxing proof within 48 hours of delivery.</li>
                  </ul>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  4. Refund Mode & Processing Timeline
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    All approved refunds are credited back to the original source payment instrument (Bank Account, UPI, or Card through Razorpay) within <strong>5 to 7 working days</strong>. We do not issue cash refunds for online payments.
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* DISCLAIMER */}
          {activeType === 'disclaimer' && (
            <div className="space-y-8">
              <div className="flex items-center gap-4 border-b pb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                  <IconRenderer name="exclamation-circle" className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">
                    Disclaimer & Non-Affiliation Notice
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Clear notice on our private status and non-governmental affiliation
                  </p>
                </div>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  1. No Government Affiliation
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    India Cyber Cafe (<code className="bg-slate-100 px-1 py-0.5 rounded text-navy">indiacybercafe.com</code>) is an independently operated private entity. We are <strong>NOT</strong> an official government agency, department, statutory board, or public sector enterprise. We do not represent, speak on behalf of, or possess decision-making powers for any Central, State, or Local Government body in India.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  2. Advisory & Facilitation Only
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    Our services consist solely of online assistance, digital typing, document resizing, form filling, and consulting to assist citizens who require technical facilitation. The final decision to approve, grant, recruit, or issue documents resides exclusively with the respective official government bodies.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  3. Verification of Critical Information
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    While we endeavor to keep all information, fee notifications, and syllabus guidelines updated, users are encouraged to cross-reference dates, criteria, and official notifications published on original government gazettes and portals.
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* CONTACT & GRIEVANCE */}
          {activeType === 'contact' && (
            <div className="space-y-8">
              <div className="flex items-center gap-4 border-b pb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                  <IconRenderer name="phone" className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">
                    Contact Us & Grievance Redressal
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Multi-channel support, statutory office address, and grievance redressal mechanism
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Contact Card */}
                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200 space-y-4">
                  <h3 className="font-bold text-navy text-base flex items-center gap-2">
                    <IconRenderer name="envelope" className="w-5 h-5 text-primary" />
                    Customer Support Channels
                  </h3>
                  <div className="space-y-3 text-xs sm:text-sm text-slate-600">
                    <div>
                      <p className="font-semibold text-navy">Email Support:</p>
                      <a href="mailto:icc@indiacybercafe.com" className="text-primary hover:underline font-medium block">
                        icc@indiacybercafe.com
                      </a>
                      <a href="mailto:indiacybercafe.com@gmail.com" className="text-slate-500 hover:underline block">
                        indiacybercafe.com@gmail.com
                      </a>
                    </div>
                    <div>
                      <p className="font-semibold text-navy">Support Helpline:</p>
                      <a href="tel:+919203251821" className="text-primary hover:underline font-medium block">
                        +91-9203251821
                      </a>
                    </div>
                    <div>
                      <p className="font-semibold text-navy">Hours of Operation:</p>
                      <p>Monday to Saturday: 9:00 AM – 8:00 PM IST</p>
                    </div>
                  </div>
                </div>

                {/* Grievance Officer Card */}
                <div className="bg-blue-50/60 rounded-2xl p-6 border border-blue-200 space-y-4">
                  <h3 className="font-bold text-navy text-base flex items-center gap-2">
                    <IconRenderer name="shield-check" className="w-5 h-5 text-primary" />
                    Grievance Redressal Officer
                  </h3>
                  <div className="space-y-2 text-xs sm:text-sm text-slate-700">
                    <p><strong>Designation:</strong> Grievance Redressal Officer</p>
                    <p><strong>Direct Email:</strong> <a href="mailto:icc@indiacybercafe.com" className="text-primary font-medium underline">icc@indiacybercafe.com</a></p>
                    <p><strong>Registered Address:</strong> House No. 72, Ward No. 04, Village Jobgarh, Post Daga Bargawan, Tehsil Bargawan, Singrauli, MP - 486886, India</p>
                    <p className="text-xs text-slate-500 pt-2 border-t border-blue-200">
                      Acknowledgment within 48 hours; resolution within 15–30 days.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Banner */}
              <div className="bg-slate-900 text-white rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h4 className="font-bold text-base">Need to lodge an official complaint or data request?</h4>
                  <p className="text-xs text-slate-300 mt-1">
                    Submit via our tracking portal to receive a verifiable ticket ID and status updates.
                  </p>
                </div>
                <Link to="/privacy-request" className="btn-primary text-xs px-5 py-3 whitespace-nowrap">
                  Open Ticket Portal
                </Link>
              </div>
            </div>
          )}

          {/* ABOUT US */}
          {activeType === 'about' && (
            <div className="space-y-8">
              <div className="flex items-center gap-4 border-b pb-6">
                <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center shrink-0">
                  <IconRenderer name="information-circle" className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-extrabold text-navy">
                    About India Cyber Cafe
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Bridging the digital divide and enabling citizen empowerment across India
                  </p>
                </div>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  Our Story & Mission
                </h2>
                <div className="text-xs sm:text-sm text-slate-600 leading-relaxed space-y-2">
                  <p>
                    Established to make digital government schemes and online application portals accessible to every citizen, India Cyber Cafe provides transparent, reliable, and secure online assistance. We bridge the technological barrier so rural and semi-urban citizens can easily access education, recruitment, and public services.
                  </p>
                </div>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg sm:text-xl font-bold text-navy flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-primary rounded-full"></span>
                  Our Principles
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="font-bold text-navy mb-1">🔒 Absolute Data Respect</p>
                    <p className="text-slate-600">Strict adherence to India's DPDP Act, no selling of user profiles, zero tampering with credentials.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="font-bold text-navy mb-1">⚡ Fast & Accurate Filing</p>
                    <p className="text-slate-600">Rigorous document verification to ensure accurate filing without clerical errors.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <p className="font-bold text-navy mb-1">💬 Transparent Redressal</p>
                    <p className="text-slate-600">Guaranteed 48-hour response for customer and privacy inquiries.</p>
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Footer Info */}
          <div className="mt-12 pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-slate-400 text-xs">
              © {new Date().getFullYear()} India Cyber Cafe. All rights reserved.
            </p>
            <div className="flex flex-wrap items-center gap-4 text-xs text-primary">
              <Link to="/legal/privacy" className="hover:underline">Privacy Notice</Link>
              <Link to="/legal/terms" className="hover:underline">Terms</Link>
              <Link to="/legal/refund" className="hover:underline">Refunds</Link>
              <Link to="/legal/disclaimer" className="hover:underline">Disclaimer</Link>
              <Link to="/privacy-request" className="hover:underline font-semibold">Grievance Portal</Link>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
