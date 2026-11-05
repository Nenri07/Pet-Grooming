import { describe, expect, it } from 'vitest';
import { normalizePaymentLink, paymentLinkForAmount, paymentLinkLabel } from '@/lib/billing/payment-link';

describe('normalizePaymentLink', () => {
  it('accepts known payment sites, with or without https', () => {
    expect(normalizePaymentLink('paypal.me/pawgroom')).toBe('https://paypal.me/pawgroom');
    expect(normalizePaymentLink(' https://buy.stripe.com/abc123 ')).toBe('https://buy.stripe.com/abc123');
    expect(normalizePaymentLink('https://square.link/u/xyz')).toBe('https://square.link/u/xyz');
  });

  it('rejects other sites, http, credentials and look-alikes', () => {
    expect(normalizePaymentLink('https://evil.com/paypal.me')).toBeNull();
    expect(normalizePaymentLink('http://paypal.me/x')).toBeNull();
    expect(normalizePaymentLink('https://user:pw@paypal.me/x')).toBeNull();
    expect(normalizePaymentLink('https://paypal.me.evil.com/x')).toBeNull();
    expect(normalizePaymentLink('javascript:alert(1)')).toBeNull();
    expect(normalizePaymentLink('')).toBeNull();
  });
});

describe('paymentLinkForAmount', () => {
  it('adds the amount to a PayPal.me link', () => {
    expect(paymentLinkForAmount('https://paypal.me/pawgroom', 25)).toBe('https://paypal.me/pawgroom/25USD');
    expect(paymentLinkForAmount('https://paypal.me/pawgroom', 12.5, 'gbp')).toBe('https://paypal.me/pawgroom/12.50GBP');
  });

  it('leaves links that already have an amount, and other providers, unchanged', () => {
    expect(paymentLinkForAmount('https://paypal.me/pawgroom/10', 25)).toBe('https://paypal.me/pawgroom/10');
    expect(paymentLinkForAmount('https://buy.stripe.com/abc', 25)).toBe('https://buy.stripe.com/abc');
  });

  it('labels the provider', () => {
    expect(paymentLinkLabel('https://paypal.me/x')).toBe('PayPal');
    expect(paymentLinkLabel('https://buy.stripe.com/x')).toBe('Stripe');
  });
});
