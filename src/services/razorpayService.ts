import Razorpay from "razorpay";
import crypto from "crypto";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "",
});

export interface PaymentOrder {
  amount: number; // in paise (e.g., 50000 for ₹500)
  currency?: string;
  receipt?: string;
  notes?: Record<string, string>;
  [key: string]: any;
}

export async function createPaymentOrder(orderData: PaymentOrder) {
  try {
    const order = await razorpay.orders.create({
      amount: orderData.amount,
      currency: orderData.currency || "INR",
      receipt: orderData.receipt || `receipt_${Date.now()}`,
      notes: orderData.notes || {},
    });
    return order;
  } catch (error) {
    console.error("Error creating Razorpay order:", error);
    throw error;
  }
}

export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const body = orderId + "|" + paymentId;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
    .update(body)
    .digest("hex");

  return expectedSignature === signature;
}

export async function fetchPaymentDetails(paymentId: string) {
  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return payment;
  } catch (error) {
    console.error("Error fetching payment details:", error);
    throw error;
  }
}

export async function refundPayment(paymentId: string, amount?: number) {
  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: amount,
    });
    return refund;
  } catch (error) {
    console.error("Error refunding payment:", error);
    throw error;
  }
}
