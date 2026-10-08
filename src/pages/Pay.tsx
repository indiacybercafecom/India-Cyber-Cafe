import { useState, useRef, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { push, ref as dbRef, set } from 'firebase/database';
import { SEO } from '../components/SEO';
import { rtdb } from '../firebase';
import { sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import {
  getRazorpayKeyId,
  loadRazorpayScript,
  createPayLinkOrder,
  verifyPayLinkPayment
} from '../services/razorpayService';

type PaymentState = 'idle' | 'processing' | 'success' | 'error';

/**
 * Validates an amount string and converts to integer paise.
 * Rejects non-numeric, negative, 0, NaN, excess precision, and out-of-range amounts.
 */
function parseAmountToPaise(amountStr: string | null | undefined): number | null {
  if (!amountStr || typeof amountStr !== 'string') return null;
  const trimmed = amountStr.trim();
  // Strictly digits with at most 2 decimal places
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [rupeesPart, decimalPart = ''] = trimmed.split('.');
  const rupees = parseInt(rupeesPart, 10);
  if (!Number.isSafeInteger(rupees)) return null;

  const paise = parseInt(decimalPart.padEnd(2, '0').slice(0, 2), 10);
  const totalPaise = rupees * 100 + paise;

  // Configured bounds: min ₹1.00 (100 paise), max ₹1,00,000.00 (10,000,000 paise)
  const MIN_PAISE = 100;
  const MAX_PAISE = 10000000;

  if (totalPaise < MIN_PAISE || totalPaise > MAX_PAISE) {
    return null;
  }

  return totalPaise;
}

/**
 * Formats integer paise into currency string (e.g. ₹100, ₹499, ₹999, ₹1,250, ₹100.50)
 */
function formatCurrency(paise: number): string {
  const rupees = paise / 100;
  if (paise % 100 === 0) {
    return `₹${rupees.toLocaleString('en-IN')}`;
  }
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Pay() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawUrlAmount = searchParams.get('amount');
  const rawUrlRef = searchParams.get('ref') || '';

  // Mode determination:
  // If ?amount was provided in URL:
  //   - If valid -> dynamic Pay-by-Link view
  //   - If invalid -> invalid payment link error view
  // If NO ?amount provided in URL (/pay):
  //   - Manual "Enter Amount and Pay" view
  const hasUrlAmountParam = rawUrlAmount !== null && rawUrlAmount.trim() !== '';
  const parsedUrlPaise = hasUrlAmountParam ? parseAmountToPaise(rawUrlAmount) : null;
  const isInvalidUrlParam = hasUrlAmountParam && parsedUrlPaise === null;

  // For manual enter amount mode
  const [customAmountInput, setCustomAmountInput] = useState('');
  const [customRefInput, setCustomRefInput] = useState(rawUrlRef);

  // Keep customRefInput in sync with URL if URL changes
  useEffect(() => {
    if (rawUrlRef) {
      setCustomRefInput(rawUrlRef);
    }
  }, [rawUrlRef]);

  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [error, setError] = useState('');
  const [paymentResult, setPaymentResult] = useState<{
    paymentId: string;
    orderId: string;
    receiptId: string;
    amountFormatted: string;
    reference?: string;
  } | null>(null);

  const isVerifyingRef = useRef(false);

  // Determine active amount to pay based on mode:
  // 1. Link mode: rawUrlAmount
  // 2. Manual mode: customAmountInput
  const activeAmountToPay = hasUrlAmountParam ? rawUrlAmount! : customAmountInput;
  const activeParsedPaise = parseAmountToPaise(activeAmountToPay);
  const activeReference = (hasUrlAmountParam ? rawUrlRef : customRefInput).trim();

  const formattedAmount = activeParsedPaise !== null ? formatCurrency(activeParsedPaise) : '';

  const handlePayment = async () => {
    if (activeParsedPaise === null) {
      if (!activeAmountToPay.trim()) {
        setError('Please enter an amount to proceed.');
      } else {
        setError('Please enter a valid amount between ₹1 and ₹1,00,000.');
      }
      return;
    }

    setError('');
    setPaymentState('processing');

    try {
      // 1. Request server to create Razorpay Order with strict server-side validation
      const orderData = await createPayLinkOrder(activeAmountToPay.trim(), activeReference);

      if (!orderData || (!orderData.order_id && !orderData.orderId)) {
        throw new Error(orderData?.error || 'Unable to start payment. Please try again.');
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) {
        throw new Error('Payment gateway is currently unavailable. Please refresh and try again.');
      }

      const razorpayOrderId = orderData.order_id || orderData.orderId;

      // 2. Open Razorpay Checkout using server-provided Order ID and Amount
      const razorpay = new window.Razorpay({
        key: orderData.keyId || getRazorpayKeyId(),
        amount: orderData.amount, // Server-created exact paise
        currency: orderData.currency || 'INR',
        order_id: razorpayOrderId,
        name: 'India Cyber Cafe',
        description: activeReference ? `Payment (Ref: ${activeReference})` : 'Direct Payment to India Cyber Cafe',
        image: 'https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png',
        handler: async (response: any) => {
          // Prevent duplicate payment verification callbacks
          if (isVerifyingRef.current) return;
          isVerifyingRef.current = true;
          setPaymentState('processing');

          try {
            // 3. Verify Razorpay payment signature server-side
            const verification = await verifyPayLinkPayment(
              response.razorpay_payment_id,
              response.razorpay_order_id,
              response.razorpay_signature,
              orderData.amountInRupees,
              activeReference,
              orderData.receiptId
            );

            if (!verification.verified) {
              throw new Error(verification.error || 'Server payment verification failed.');
            }

            // 4. Save transaction record to client RTDB
            try {
              const recordRef = push(dbRef(rtdb, 'payments'));
              await set(recordRef, {
                id: orderData.receiptId,
                payment_id: response.razorpay_payment_id,
                paymentId: response.razorpay_payment_id,
                order_id: response.razorpay_order_id,
                orderId: response.razorpay_order_id,
                amount: orderData.amountInRupees,
                currency: 'INR',
                status: 'completed',
                reference: activeReference || orderData.receiptId,
                receiptId: orderData.receiptId,
                type: hasUrlAmountParam ? 'pay_link' : 'direct_pay',
                created_at: new Date().toISOString(),
                createdAt: new Date().toISOString()
              });
            } catch (rtdbErr) {
              console.warn('Client RTDB write notice:', rtdbErr);
            }

            // 5. Notify administrators via email
            void sendEmailToAllAdmins(
              `Payment Received - ₹${orderData.amountInRupees} (${orderData.receiptId})`,
              emailTemplates.directPaymentReceived(
                orderData.receiptId,
                orderData.amountInRupees,
                response.razorpay_payment_id,
                response.razorpay_order_id,
                new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'long' })
              )
            ).catch(emailError => console.error('Admin payment notification failed:', emailError));

            setPaymentResult({
              paymentId: response.razorpay_payment_id,
              orderId: response.razorpay_order_id,
              receiptId: orderData.receiptId,
              amountFormatted: formatCurrency(orderData.amount),
              reference: activeReference
            });
            setPaymentState('success');
          } catch (verificationError) {
            console.error('Payment verification error:', verificationError);
            setError(verificationError instanceof Error ? verificationError.message : 'Payment verification failed.');
            setPaymentState('error');
          } finally {
            isVerifyingRef.current = false;
          }
        },
        modal: {
          ondismiss: () => {
            setPaymentState('idle');
          }
        },
        theme: { color: '#001A57' }
      });

      razorpay.open();
    } catch (paymentError) {
      console.error('Payment initialization error:', paymentError);
      setError(paymentError instanceof Error ? paymentError.message : 'Unable to start payment.');
      setPaymentState('error');
    }
  };

  // State: Invalid URL with explicit invalid amount parameter (e.g., ?amount=abc, ?amount=-100)
  if (isInvalidUrlParam) {
    return (
      <>
        <SEO title="Invalid Payment Amount | India Cyber Cafe" description="Payment link error" />
        <section className="mx-auto flex min-h-[calc(100vh-180px)] max-w-xl items-center justify-center py-8 px-4">
          <div className="w-full rounded-3xl border border-red-100 bg-white p-6 text-center shadow-xl shadow-red-900/5 sm:p-10">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-extrabold text-navy sm:text-3xl">Invalid Payment Amount</h1>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">
              Please use a valid payment link.
            </p>
            <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-xs text-slate-500">
              Payments on this page require a valid link with an amount between ₹1 and ₹1,00,000.
            </div>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSearchParams({});
                  setError('');
                }}
                className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2"
              >
                Enter Amount Manually
              </button>
              <Link to="/" className="btn-secondary w-full sm:w-auto inline-flex items-center justify-center gap-2">
                Return to Home
              </Link>
            </div>
          </div>
        </section>
      </>
    );
  }

  // State: Successful Payment
  if (paymentState === 'success' && paymentResult) {
    return (
      <>
        <SEO title="Payment Successful | India Cyber Cafe" description="Payment confirmation" />
        <section className="mx-auto flex min-h-[calc(100vh-180px)] max-w-xl items-center justify-center py-8 px-4">
          <div className="w-full rounded-3xl border border-emerald-100 bg-white p-6 text-center shadow-xl shadow-emerald-900/5 sm:p-10">
            <CheckCircle2 className="mx-auto mb-5 h-16 w-16 text-emerald-500" />
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-emerald-600">Payment Successful</p>
            <h1 className="text-2xl font-extrabold text-navy sm:text-3xl">Your payment was successfully received by India Cyber Cafe</h1>

            <div className="mt-7 space-y-3 rounded-2xl bg-slate-50 p-5 text-left text-sm">
              <div className="flex justify-between border-b border-slate-200 pb-2">
                <span className="text-slate-500">Amount Paid</span>
                <span className="font-bold text-navy text-base">{paymentResult.amountFormatted}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-2">
                <span className="text-slate-500">Payment ID</span>
                <span className="font-mono text-xs text-slate-700">{paymentResult.paymentId}</span>
              </div>
              <div className="flex justify-between border-b border-slate-200 pb-2">
                <span className="text-slate-500">Order ID</span>
                <span className="font-mono text-xs text-slate-700">{paymentResult.orderId}</span>
              </div>
              {paymentResult.reference && (
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-slate-500">Reference / Note</span>
                  <span className="font-semibold text-slate-700">{paymentResult.reference}</span>
                </div>
              )}
              <div className="flex justify-between pt-1">
                <span className="text-slate-500">Date</span>
                <span className="text-xs text-slate-700">{new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </div>
            </div>

            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setPaymentState('idle');
                  setPaymentResult(null);
                  setCustomAmountInput('');
                  setSearchParams({});
                }}
                className="btn-secondary w-full sm:w-auto inline-flex items-center justify-center gap-2"
              >
                Make Another Payment
              </button>
              <Link to="/" className="btn-primary w-full sm:w-auto inline-flex items-center justify-center gap-2">
                Return to Home
              </Link>
            </div>
          </div>
        </section>
      </>
    );
  }

  // State: Dynamic Pay-by-Link View (When a valid ?amount=... is provided in the URL)
  if (hasUrlAmountParam && parsedUrlPaise !== null) {
    return (
      <>
        <SEO title={`Pay ${formattedAmount} | India Cyber Cafe`} description={`Pay ${formattedAmount} securely to India Cyber Cafe`} />
        <section className="mx-auto flex min-h-[calc(100vh-180px)] max-w-xl items-center justify-center py-8 px-4">
          <div className="w-full rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-navy/5 sm:p-9">
            <div className="mb-6 text-center">
              <img 
                src="https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png" 
                alt="India Cyber Cafe" 
                className="h-12 mx-auto mb-3 object-contain"
              />
              <p className="text-xs font-bold uppercase tracking-widest text-primary">India Cyber Cafe</p>
              <h1 className="text-2xl font-extrabold text-navy sm:text-3xl mt-1">Direct Payment</h1>
              <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
                Pay securely for any service, print, or fee
              </p>
            </div>

            {/* Amount to Pay area */}
            <div className="mb-6">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                Amount to Pay (₹)
              </label>
              <div className="relative rounded-2xl border-2 border-slate-200 bg-slate-50/50">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-400">
                  ₹
                </span>
                <div className="w-full bg-transparent py-4 pl-11 pr-4 text-2xl sm:text-3xl font-black text-navy select-all">
                  {formattedAmount.replace('₹', '')}
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-4 rounded-xl bg-red-50 p-3.5 text-center text-sm font-semibold text-red-600 border border-red-200">
                {error}
              </div>
            )}

            {/* Pay Button */}
            <button
              type="button"
              onClick={handlePayment}
              disabled={paymentState === 'processing'}
              className="btn-primary w-full py-4 text-lg font-bold shadow-lg shadow-orange-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {paymentState === 'processing' ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span>Starting secure payment...</span>
                </>
              ) : (
                `Pay ${formattedAmount}`
              )}
            </button>

            {/* Trust badges */}
            <div className="mt-5 space-y-2 text-center">
              <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>100% Secure Payment Powered by Razorpay</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Supports UPI (Google Pay, PhonePe, Paytm), Credit/Debit Cards, NetBanking
              </p>
            </div>
          </div>
        </section>
      </>
    );
  }

  // State: Default / Enter Amount and Pay View (When user visits only /pay)
  return (
    <>
      <SEO title="Pay Online | India Cyber Cafe" description="Enter amount and pay securely to India Cyber Cafe via UPI, Cards, NetBanking" />
      <section className="mx-auto flex min-h-[calc(100vh-180px)] max-w-xl items-center justify-center py-8 px-4">
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-navy/5 sm:p-9">
          <div className="mb-6 text-center">
            <img 
              src="https://indiacybercafe.com/wp-content/uploads/2026/02/icc-logo-bgremoved.png" 
              alt="India Cyber Cafe" 
              className="h-12 mx-auto mb-3 object-contain"
            />
            <p className="text-xs font-bold uppercase tracking-widest text-primary">India Cyber Cafe</p>
            <h1 className="text-2xl font-extrabold text-navy sm:text-3xl mt-1">Direct Payment</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1.5">
              Enter amount to pay securely for any service, print, or fee
            </p>
          </div>

          {/* Amount input card */}
          <div className="mb-6">
            <label htmlFor="amount-input" className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
              Enter Amount (₹) <span className="text-red-500">*</span>
            </label>
            <div className="relative rounded-2xl border-2 border-slate-200 bg-slate-50/50 transition-all focus-within:border-primary focus-within:bg-white focus-within:ring-4 focus-within:ring-orange-500/10">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-slate-400">
                ₹
              </span>
              <input
                id="amount-input"
                type="number"
                min="1"
                max="100000"
                step="any"
                placeholder="0.00"
                value={customAmountInput}
                onChange={(e) => {
                  setCustomAmountInput(e.target.value);
                  if (error) setError('');
                }}
                className="w-full bg-transparent py-4 pl-11 pr-4 text-2xl sm:text-3xl font-black text-navy outline-none placeholder:text-slate-300"
                autoFocus
              />
            </div>
          </div>

          {error && (
            <div className="mb-4 rounded-xl bg-red-50 p-3.5 text-center text-sm font-semibold text-red-600 border border-red-200">
              {error}
            </div>
          )}

          {/* Pay Button */}
          <button
            type="button"
            onClick={handlePayment}
            disabled={paymentState === 'processing'}
            className="btn-primary w-full py-4 text-lg font-bold shadow-lg shadow-orange-500/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {paymentState === 'processing' ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Starting secure payment...</span>
              </>
            ) : activeParsedPaise !== null ? (
              `Pay ${formattedAmount}`
            ) : (
              'Pay'
            )}
          </button>

          {/* Trust badges */}
          <div className="mt-5 space-y-2 text-center">
            <div className="flex items-center justify-center gap-2 text-xs font-medium text-slate-500">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              <span>100% Secure Payment Powered by Razorpay</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Supports UPI (Google Pay, PhonePe, Paytm), Credit/Debit Cards, NetBanking
            </p>
          </div>
        </div>
      </section>
    </>
  );
}


