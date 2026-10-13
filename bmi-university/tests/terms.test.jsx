import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TermsPage from '../app/terms/page';

describe('Terms of Service & Student Payment Policy', () => {
  it('renders official institutional terms and merchant of record notice', () => {
    render(<TermsPage />);

    expect(screen.getByRole('heading', { level: 1, name: /Terms of Service & Student Payment Policy/i })).toBeInTheDocument();
    expect(screen.getAllByText(/BEMI TRAINING INSTITUTE/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/BN-93SQD5LL/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Mukurwe-ini Plaza/i).length).toBeGreaterThan(0);
  });

  it('renders authorized payment processors IntaSend and Paystack', () => {
    render(<TermsPage />);

    expect(screen.getByText(/IntaSend Payments/i)).toBeInTheDocument();
    expect(screen.getByText(/Paystack Payments/i)).toBeInTheDocument();
    expect(screen.getByText(/PCI-DSS Level 1/i)).toBeInTheDocument();
  });

  it('renders comprehensive tuition refund schedule matching gateway compliance requirements', () => {
    render(<TermsPage />);

    expect(screen.getByRole('heading', { level: 2, name: /7\. Tuition Refund, Withdrawal & Cancellation Policy/i })).toBeInTheDocument();
    expect(screen.getByText(/Institutional Cancellation \(100% Refund\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Withdrawal Prior to Term Commencement \(90% Refund\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Withdrawal Within First 14 Calendar Days \(50% Refund\)/i)).toBeInTheDocument();
  });

  it('renders dispute resolution SLA and official contact details', () => {
    render(<TermsPage />);

    expect(screen.getAllByText(/\+254 721 341 793/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/finance@bmiuniversities\.org/i).length).toBeGreaterThan(0);
  });
});
