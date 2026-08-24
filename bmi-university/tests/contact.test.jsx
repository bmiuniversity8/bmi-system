import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Contact from '../app/contact/page';

// Mock fetch so the real API is never called in tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Contact Page', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Default: successful submission
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'test-id' }, message: 'Received' }),
    });
  });

  it('renders the contact form and information', () => {
    render(<Contact />);

    // Check for headers
    expect(screen.getByRole('heading', { name: /Contact Us/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Get in Touch/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Send a Message/i })).toBeInTheDocument();

    // Check for some contact info
    expect(screen.getByText('admin@bmiuniversities.org')).toBeInTheDocument();
  });

  it('updates form fields when typed into', () => {
    render(<Contact />);

    const nameInput = screen.getByLabelText(/Full Name/i);
    const emailInput = screen.getByLabelText(/Email Address/i);
    const subjectInput = screen.getByLabelText(/Subject/i);
    const messageInput = screen.getByLabelText(/Message/i);

    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    fireEvent.change(emailInput, { target: { value: 'john@example.com' } });
    fireEvent.change(subjectInput, { target: { value: 'Test Inquiry' } });
    fireEvent.change(messageInput, { target: { value: 'This is a test message.' } });

    expect(nameInput.value).toBe('John Doe');
    expect(emailInput.value).toBe('john@example.com');
    expect(subjectInput.value).toBe('Test Inquiry');
    expect(messageInput.value).toBe('This is a test message.');
  });

  it('shows success message after form submission', async () => {
    render(<Contact />);
    const user = userEvent.setup({ delay: null });

    // Fill form fast
    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'John Doe' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: 'Inquiry' } });
    fireEvent.change(screen.getByLabelText(/Message/i), { target: { value: 'Test message' } });

    // Submit form
    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    // Verify success message
    expect(screen.getByRole('heading', { name: /Message Sent!/i })).toBeInTheDocument();
    expect(screen.getByText(/We will get back to you within 1–2 business days/i)).toBeInTheDocument();

    // Ensure the original form is gone
    expect(screen.queryByRole('heading', { name: /Send a Message/i })).not.toBeInTheDocument();
  });

  it('shows error message when API returns failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Server error, please try again.' }),
    });

    render(<Contact />);
    const user = userEvent.setup({ delay: null });

    fireEvent.change(screen.getByLabelText(/Full Name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'jane@example.com' } });
    fireEvent.change(screen.getByLabelText(/Subject/i), { target: { value: 'Help' } });
    fireEvent.change(screen.getByLabelText(/Message/i), { target: { value: 'Hello' } });

    await user.click(screen.getByRole('button', { name: /Send Message/i }));

    expect(screen.getByText(/Server error, please try again/i)).toBeInTheDocument();
    // Form should still be visible
    expect(screen.getByRole('heading', { name: /Send a Message/i })).toBeInTheDocument();
  });
});


