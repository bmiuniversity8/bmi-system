import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Navbar from '../components/Navbar';
import BemiInstitutePage from '../app/institutes/bemi/page';
import InstitutesDirectoryPage from '../app/institutes/page';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

describe('Institutes & BEMI Public Integration', () => {
  it('renders Institutes navigation and BEMI Africa Hub link in Navbar', () => {
    render(<Navbar />);

    // Check for Institutes navigation
    expect(screen.getAllByText(/Institutes/i).length).toBeGreaterThan(0);

    // Check for BEMI Africa Hub in top utility / nav links
    expect(screen.getAllByText(/BEMI Training Institute/i).length).toBeGreaterThan(0);
  });

  it('renders BEMI Institute page with Kenyan registration, African mandate, and payment transparency', () => {
    render(<BemiInstitutePage />);

    // Check page heading
    expect(screen.getByRole('heading', { level: 1, name: /BEMI Training Institute/i })).toBeInTheDocument();

    // Check African representation & Kenyan registration
    expect(screen.getByText(/Pan-African Continental Representation/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Mukurweini Campus, Kenya/i).length).toBeGreaterThan(0);

    // Check critical payment verification & fee transparency content
    expect(screen.getByText(/Why Does My Fee Payment Show “BEMI”?/i)).toBeInTheDocument();
    expect(screen.getAllByText(/BEMI TRAINING INSTITUTE/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/BEMI\*TRAINING • NAIROBI KE/i)).toBeInTheDocument();
  });

  it('renders Institutes Directory page listing BEMI Training Institute', () => {
    render(<InstitutesDirectoryPage />);

    expect(screen.getByRole('heading', { level: 1, name: /BMI Institutes & Regional Hubs/i })).toBeInTheDocument();
    expect(screen.getAllByText(/BEMI Training Institute/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Flagship Regional Institute/i)).toBeInTheDocument();
  });
});
