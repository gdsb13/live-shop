'use strict';

function isValidPin(pin) {
  return /^[1-9][0-9]{5}$/.test(String(pin).trim());
}

function checkServiceability(pin) {
  const normalized = String(pin).trim();

  if (!isValidPin(normalized)) {
    const err = new Error('PIN must be a valid 6-digit Indian postal code');
    err.status = 400;
    throw err;
  }

  if (normalized === '999999') {
    return {
      pin: normalized,
      serviceable: false,
      message: 'Delivery is not available to this PIN code.',
      codAvailable: false,
      estimatedDeliveryDays: null,
      estimatedDeliveryDate: null,
    };
  }

  const firstDigit = normalized[0];
  const limited = firstDigit === '7' || firstDigit === '8';

  const deliveryDays = limited ? 7 : 3;
  const estimated = new Date();
  estimated.setDate(estimated.getDate() + deliveryDays);

  return {
    pin: normalized,
    serviceable: true,
    message: limited
      ? 'Delivery available with extended timeline. COD not available.'
      : 'Delivery available to this PIN code.',
    codAvailable: !limited,
    estimatedDeliveryDays: deliveryDays,
    estimatedDeliveryDate: estimated.toISOString().slice(0, 10),
  };
}

module.exports = {
  checkServiceability,
  isValidPin,
};
