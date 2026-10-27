import { useState } from 'react';
import { motion } from 'motion/react';
import { Link, useSearchParams } from 'react-router-dom';
import { SEO } from '../components/SEO';
import { IconRenderer } from '../components/Icons';
import {
  PRIVACY_REQUEST_CATEGORIES,
  submitPrivacyRequest,
  trackPrivacyRequest,
} from '../services/privacyRequestService';
import { PrivacyRequest, PrivacyRequestCategory } from '../types';
import { showToast } from '../components/Toast';

export function PrivacyRequestPage() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('mode') === 'track' ? 'track' : 'submit';
  const initialTicket = searchParams.get('ticket') || '';

  const [activeTab, setActiveTab] = useState<'submit' | 'track'>(initialTab);

  // Submit form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [referenceId, setReferenceId] = useState('');
  const [category, setCategory] = useState<PrivacyRequestCategory>('privacy_question');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedTicket, setSubmittedTicket] = useState<string | null>(null);

  // Track state
  const [trackTicketId, setTrackTicketId] = useState(initialTicket);
  const [trackEmail, setTrackEmail] = useState('');
  const [tracking, setTracking] = useState(false);
  const [trackedRecord, setTrackedRecord] = useState<PrivacyRequest | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!name.trim() || !email.trim() || !description.trim()) {
      showToast('Please fill in all required fields.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await submitPrivacyRequest({
        category,
        name,
        email,
        phone,
        referenceId,
        description,
      });

      if (res.success && res.ticketId) {
        setSubmittedTicket(res.ticketId);
        showToast('Your request has been recorded successfully.', 'success');
        setName('');
        setEmail('');
        setPhone('');
        setReferenceId('');
        setDescription('');
      } else {
        showToast(res.error || 'Failed to submit request.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error submitting request', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tracking) return;

    if (!trackTicketId.trim() || !trackEmail.trim()) {
      showToast('Please provide both Ticket ID and your email.', 'error');
      return;
    }

    setTracking(true);
    setTrackError(null);
    setTrackedRecord(null);

    try {
      const res = await trackPrivacyRequest(trackTicketId, trackEmail);
      if (res.success && res.request) {
        setTrackedRecord(res.request);
      } else {
        setTrackError(res.error || 'No matching privacy request found.');
      }
    } catch (err: any) {
      setTrackError(err.message || 'Failed to track request');
    } finally {
      setTracking(false);
    }
  };

  const copyTicket = () => {
    if (submittedTicket) {
      navigator.clipboard.writeText(submittedTicket);
      showToast('Ticket ID copied to clipboard!', 'success');
    }
  };

  return (
    <>
      <SEO
        title="Privacy Requests & Grievance Redressal - India Cyber Cafe"
        description="Submit data-rights queries, personal data access, correction, deletion, consent withdrawal, or consumer grievances under Indian digital privacy guidelines."
        url="https://b.indiacybercafe.com/privacy-request"
        keywords="privacy request, data rights, grievance redressal, DPDP, consent withdrawal, India Cyber Cafe"
      />

      <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-2 text-xs text-slate-500">
          <Link to="/" className="hover:text-primary transition">Home</Link>
          <span>/</span>
          <Link to="/legal/privacy" className="hover:text-primary transition">Privacy Policy</Link>
          <span>/</span>
          <span className="font-semibold text-navy">Grievance & Privacy Requests</span>
        </nav>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 space-y-3"
        >
          <div className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-3.5 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <IconRenderer name="shield-check" className="h-4 w-4" />
            <span>DPDP Act & E-Commerce Compliance</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-navy">
            Privacy Rights & Grievance Cell
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
            Exercise your personal data rights, withdraw optional consent, request corrections or data deletion, or submit an official consumer grievance to our designated Grievance Officer.
          </p>
        </motion.div>

        {/* Tab switcher */}
        <div className="mb-8 flex rounded-2xl bg-slate-200/80 p-1.5 max-w-md">
          <button
            type="button"
            onClick={() => setActiveTab('submit')}
            className={`flex-1 rounded-xl py-2.5 text-xs sm:text-sm font-bold transition ${
              activeTab === 'submit'
                ? 'bg-white text-navy shadow-sm'
                : 'text-slate-600 hover:text-navy'
            }`}
          >
            Submit New Request
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('track')}
            className={`flex-1 rounded-xl py-2.5 text-xs sm:text-sm font-bold transition ${
              activeTab === 'track'
                ? 'bg-white text-navy shadow-sm'
                : 'text-slate-600 hover:text-navy'
            }`}
          >
            Track Request Status
          </button>
        </div>

        {/* Tab 1: Submit */}
        {activeTab === 'submit' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="lg:col-span-2 rounded-3xl bg-white p-6 sm:p-10 shadow-xl border border-slate-100"
            >
              {submittedTicket ? (
                <div className="space-y-6 text-center py-6">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
                    <IconRenderer name="circle-check" className="h-8 w-8" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-bold text-navy">Request Registered</h3>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
                      Your privacy request has been logged into our grievance redressal queue. An automated confirmation with full tracking details has been sent to your email.
                    </p>
                  </div>

                  <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 p-5 max-w-md mx-auto space-y-2">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Your Unique Ticket ID
                    </span>
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-xl sm:text-2xl font-mono font-bold text-navy">
                        {submittedTicket}
                      </span>
                      <button
                        type="button"
                        onClick={copyTicket}
                        className="rounded-lg bg-white p-2 text-primary shadow-xs hover:bg-slate-50 transition"
                        title="Copy Ticket ID"
                      >
                        <IconRenderer name="clipboard" className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setTrackTicketId(submittedTicket);
                        setActiveTab('track');
                        setSubmittedTicket(null);
                      }}
                      className="btn-primary px-6 py-2.5 text-xs sm:text-sm rounded-xl"
                    >
                      Track this Ticket
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubmittedTicket(null)}
                      className="px-6 py-2.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-navy rounded-xl border border-slate-200"
                    >
                      Submit Another Request
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Request Category *
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as PrivacyRequestCategory)}
                      className="input-field py-3 text-xs sm:text-sm"
                      required
                    >
                      {PRIVACY_REQUEST_CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-500 pt-0.5">
                      {PRIVACY_REQUEST_CATEGORIES.find((c) => c.value === category)?.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your full name"
                        className="input-field py-2.5 text-xs sm:text-sm"
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                        Email Address *
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        className="input-field py-2.5 text-xs sm:text-sm"
                        required
                        maxLength={120}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                        Phone Number (Optional)
                      </label>
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="10-digit mobile number"
                        className="input-field py-2.5 text-xs sm:text-sm"
                        maxLength={20}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                        Reference Number (Optional)
                      </label>
                      <input
                        type="text"
                        value={referenceId}
                        onChange={(e) => setReferenceId(e.target.value)}
                        placeholder="Application ID or Order ID"
                        className="input-field py-2.5 text-xs sm:text-sm"
                        maxLength={60}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                      Description & Details *
                    </label>
                    <textarea
                      rows={5}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Please explain your request or grievance clearly so our team can investigate and respond accurately..."
                      className="input-field py-3 text-xs sm:text-sm leading-relaxed"
                      required
                      minLength={10}
                      maxLength={4000}
                    />
                    <p className="text-[11px] text-slate-400 text-right">
                      {description.length} / 4000 characters
                    </p>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-4 border border-slate-200/80 text-xs text-slate-600 space-y-1.5">
                    <p className="font-semibold text-navy">📌 Statutory Redressal Timelines:</p>
                    <p>
                      Acknowledgment is provided within <strong>48 hours</strong>. Complete investigation and formal resolution will be delivered within <strong>15 to 30 days</strong> in compliance with the Consumer Protection (E-Commerce) Rules and DPDP Act provisions.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary w-full py-3 text-sm font-bold rounded-xl shadow-md disabled:opacity-50"
                  >
                    {submitting ? 'Submitting Request...' : 'Submit Request to Grievance Officer'}
                  </button>
                </form>
              )}
            </motion.div>

            {/* Officer Sidebar */}
            <div className="space-y-6">
              <div className="rounded-3xl bg-white p-6 shadow-xl border border-slate-100 space-y-4">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <IconRenderer name="user-check" className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-navy text-sm sm:text-base">Grievance Redressal Officer</h3>
                    <p className="text-xs text-slate-500">Designated under Indian E-Commerce Rules</p>
                  </div>
                </div>

                <div className="space-y-3 text-xs sm:text-sm text-slate-600">
                  <div>
                    <span className="font-bold text-navy block text-xs uppercase text-slate-400">Designation</span>
                    <span>Chief Grievance Redressal Officer</span>
                  </div>
                  <div>
                    <span className="font-bold text-navy block text-xs uppercase text-slate-400">Entity</span>
                    <span>India Cyber Cafe (Private Consulting Firm)</span>
                  </div>
                  <div>
                    <span className="font-bold text-navy block text-xs uppercase text-slate-400">Direct Email</span>
                    <a href="mailto:icc@indiacybercafe.com" className="text-primary font-medium hover:underline">
                      icc@indiacybercafe.com
                    </a>
                  </div>
                  <div>
                    <span className="font-bold text-navy block text-xs uppercase text-slate-400">Direct Phone</span>
                    <a href="tel:+919203251821" className="text-primary font-medium hover:underline">
                      +91 9203251821
                    </a>
                  </div>
                  <div>
                    <span className="font-bold text-navy block text-xs uppercase text-slate-400">Postal Address</span>
                    <p className="leading-relaxed">
                      House No. 72, Ward No. 04, Village Jobgarh, Post Daga Bargawan, Singrauli, Madhya Pradesh, 486886, India
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl bg-linear-to-br from-navy to-slate-900 text-white p-6 shadow-xl space-y-3">
                <h4 className="font-bold text-sm sm:text-base flex items-center gap-2">
                  <IconRenderer name="lock" className="h-4 w-4 text-primary" />
                  <span>No Password Requests</span>
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Our privacy team will NEVER ask for your account password, UPI PIN, or bank OTP. Never share confidential credentials.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Track */}
        {activeTab === 'track' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-3xl bg-white p-6 sm:p-10 shadow-xl border border-slate-100 max-w-2xl mx-auto space-y-6"
          >
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-navy">Track Request Status</h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Enter your Ticket ID (e.g. PRV-123456-ABC) and the email address used during submission.
              </p>
            </div>

            <form onSubmit={handleTrack} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Ticket ID *
                </label>
                <input
                  type="text"
                  value={trackTicketId}
                  onChange={(e) => setTrackTicketId(e.target.value)}
                  placeholder="PRV-XXXXXX-XXXX"
                  className="input-field py-2.5 text-xs sm:text-sm font-mono uppercase"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                  Verification Email *
                </label>
                <input
                  type="email"
                  value={trackEmail}
                  onChange={(e) => setTrackEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="input-field py-2.5 text-xs sm:text-sm"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={tracking}
                className="btn-primary w-full py-3 text-sm font-bold rounded-xl shadow-md disabled:opacity-50"
              >
                {tracking ? 'Checking Status...' : 'Check Status'}
              </button>
            </form>

            {trackError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-xs sm:text-sm text-red-700 flex items-start gap-3">
                <IconRenderer name="circle-exclamation" className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                <p>{trackError}</p>
              </div>
            )}

            {trackedRecord && (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <span className="text-xs text-slate-500 font-mono">{trackedRecord.id}</span>
                    <h4 className="font-bold text-navy capitalize">
                      {PRIVACY_REQUEST_CATEGORIES.find((c) => c.value === trackedRecord.category)?.label || trackedRecord.category}
                    </h4>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold capitalize ${
                      trackedRecord.status === 'resolved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : trackedRecord.status === 'rejected'
                        ? 'bg-red-100 text-red-800'
                        : trackedRecord.status === 'in_review'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {trackedRecord.status.replace('_', ' ')}
                  </span>
                </div>

                <div className="space-y-2 text-xs sm:text-sm text-slate-600">
                  <p><strong>Submitted by:</strong> {trackedRecord.name}</p>
                  <p><strong>Date Logged:</strong> {new Date(trackedRecord.createdAt).toLocaleString('en-IN')}</p>
                  <p><strong>Last Updated:</strong> {new Date(trackedRecord.updatedAt).toLocaleString('en-IN')}</p>
                  {trackedRecord.resolvedAt && (
                    <p><strong>Resolved On:</strong> {new Date(trackedRecord.resolvedAt).toLocaleString('en-IN')}</p>
                  )}
                  {trackedRecord.adminNotes && (
                    <div className="rounded-xl bg-white p-3 border border-slate-200 mt-2 space-y-1">
                      <span className="font-bold text-navy text-xs uppercase tracking-wider text-slate-400">
                        Official Redressal Note:
                      </span>
                      <p className="text-slate-700 whitespace-pre-line">{trackedRecord.adminNotes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </>
  );
}
