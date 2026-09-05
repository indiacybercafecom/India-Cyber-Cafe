import { useState } from 'react';
import { CheckCircle2, IndianRupee, Loader2, ShieldCheck } from 'lucide-react';
import { push, ref as dbRef, set } from 'firebase/database';
import { SEO } from '../components/SEO';
import { rtdb } from '../firebase';
import { sendEmailToAllAdmins, emailTemplates } from '../services/emailService';
import { getRazorpayKeyId, loadRazorpayScript, verifyRazorpayPayment } from '../services/razorpayService';

type PaymentState = 'idle' | 'processing' | 'success' | 'error';

const RECEIPT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function createPaymentId() {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, value => RECEIPT_ALPHABET[value % RECEIPT_ALPHABET.length]).join('');
}

export function Pay() {
  const [amount, setAmount] = useState('');
  const [paymentState, setPaymentState] = useState<PaymentState>('idle');
  const [error, setError] = useState('');
  const [paymentId, setPaymentId] = useState('');

  const amountInRupees = Number(amount);
  const isValidAmount = Number.isFinite(amountInRupees) && amountInRupees >= 1 && amountInRupees <= 100000 && /^\d+(\.\d{1,2})?$/.test(amount);

  const handlePayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidAmount) {
      setError('Please enter an amount between ₹1 and ₹1,00,000.');
      setPaymentState('error');
      return;
    }

    setError('');
    setPaymentState('processing');

    try {
      const amountInPaise = Math.round(amountInRupees * 100);
      const receiptId = createPaymentId();
      const orderResponse = await fetch('/api/create-razorpay-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: 'INR',
          receipt: `PAY-${receiptId}`,
          notes: { paymentType: 'direct_payment', receiptId }
        })
      });

      const orderData = await orderResponse.json();
      if (!orderResponse.ok || !orderData.order_id) {
        throw new Error(orderData.error || 'Unable to start payment. Please try again.');
      }

      if (!(await loadRazorpayScript()) || !window.Razorpay) {
        throw new Error('Payment system is unavailable. Please refresh and try again.');
      }

      const razorpay = new window.Razorpay({
        key: orderData.keyId || getRazorpayKeyId(),
        amount: amountInPaise,
        currency: 'INR',
        order_id: orderData.order_id,
        name: 'India Cyber Cafe',
        description: 'Direct payment to India Cyber Cafe',
        handler: async (response: any) => {
          try {
            const verification = await verifyRazorpayPayment(
              response.razorpay_payment_id,
              response.razorpay_order_id,
              response.razorpay_signature
            );
            if (!verification.verified) {
              throw new Error(verification.error || 'Payment verification failed.');
            }

            const recordRef = push(dbRef(rtdb, 'payments'));
            await set(recordRef, {
              id: receiptId,
              amount: amountInRupees,
              currency: 'INR',
              paymentId: response.razorpay_payment_id,
              orderId: response.razorpay_order_id,
              status: 'completed',
              type: 'direct_payment',
              createdAt: new Date().toISOString()
            });
            void sendEmailToAllAdmins(
              `Payment Received via /pay - ${receiptId}`,
              emailTemplates.directPaymentReceived(
                receiptId,
                amountInRupees,
                response.razorpay_payment_id,
                response.razorpay_order_id,
                new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'long' })
              )
            ).catch(emailError => console.error('Admin payment notification failed:', emailError));
            setPaymentId(receiptId);
            setPaymentState('success');
          } catch (verificationError) {
            setError(verificationError instanceof Error ? verificationError.message : 'Payment verification failed.');
            setPaymentState('error');
          }
        },
        modal: {
          ondismiss: () => setPaymentState('idle')
        },
        theme: { color: '#FF9933' }
      });
      razorpay.open();
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Unable to start payment.');
      setPaymentState('error');
    }
  };

  if (paymentState === 'success') {
    return (
      <>
        <SEO title="Payment Successful | India Cyber Cafe" description="Payment confirmation" />
        <section className="mx-auto flex min-h-[calc(100vh-180px)] max-w-xl items-center justify-center py-8">
          <div className="w-full rounded-3xl border border-emerald-100 bg-white p-6 text-center shadow-xl shadow-emerald-900/5 sm:p-10">
            <CheckCircle2 className="mx-auto mb-5 h-16 w-16 text-emerald-500" />
            <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-emerald-600">Payment successful</p>
            <h1 className="text-2xl font-extrabold text-navy sm:text-3xl">Your payment was successfully received by India Cyber Cafe</h1>
            <div className="mt-7 rounded-2xl bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Pay ID</p>
              <p className="mt-2 font-mono text-3xl font-bold tracking-[0.25em] text-navy">{paymentId}</p>
            </div>
            <button type="button" onClick={() => { setAmount(''); setPaymentId(''); setPaymentState('idle'); }} className="btn-primary mx-auto mt-7">Make another payment</button>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <SEO title="Pay | India Cyber Cafe" description="Make a secure payment to India Cyber Cafe" />
      <section className="mx-auto flex min-h-[calc(100vh-180px)] max-w-xl items-center justify-center py-8">
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-5 shadow-xl shadow-navy/5 sm:p-9">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-primary"><IndianRupee className="h-7 w-7" /></div>
            <h1 className="text-2xl font-extrabold text-navy sm:text-3xl">Make a payment</h1>
            <p className="mt-2 text-sm text-slate-500">Enter the amount you want to pay securely.</p>
          </div>
          <form onSubmit={handlePayment}>
            <label htmlFor="payment-amount" className="mb-2 block text-sm font-bold text-slate-700">Amount</label>
            <div className="relative">
              <IndianRupee className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input id="payment-amount" inputMode="decimal" type="number" min="1" max="100000" step="0.01" value={amount} onChange={event => { setAmount(event.target.value); setPaymentState('idle'); setError(''); }} placeholder="0.00" className="input-field pl-12 text-2xl font-bold text-navy" required />
            </div>
            {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
            <button type="submit" disabled={paymentState === 'processing'} className="btn-primary mt-6 w-full py-4 text-base">
              {paymentState === 'processing' ? <><Loader2 className="h-5 w-5 animate-spin" /> Starting secure payment...</> : 'Pay securely'}
            </button>
          </form>
          <div className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-slate-500"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Secured by Razorpay</div>
        </div>
      </section>
    </>
  );
}
