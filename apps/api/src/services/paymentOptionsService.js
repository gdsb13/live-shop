'use strict';

function listPaymentOptions() {
  return {
    currency: 'INR',
    options: [
      {
        id: 'upi',
        label: 'UPI',
        description: 'Pay instantly with Google Pay, PhonePe, Paytm or any UPI app.',
        mock: true,
      },
      {
        id: 'card',
        label: 'Credit / Debit Card',
        description: 'Visa, Mastercard, RuPay and major Indian bank cards.',
        mock: true,
      },
      {
        id: 'cod',
        label: 'Cash on Delivery',
        description: 'Pay when your order arrives. Subject to PIN serviceability.',
        mock: true,
      },
    ],
  };
}

module.exports = {
  listPaymentOptions,
};
