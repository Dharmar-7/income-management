/**
 * Tests for the SummaryCards dashboard component.
 *
 * Strategy: mock the two external dependencies (@clerk/nextjs and
 * @tanstack/react-query) so the component renders in isolation —
 * no real network calls, no Clerk session required.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import SummaryCards from '@/app/dashboard/SummaryCards';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock Clerk so useAuth() doesn't crash in jsdom
jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }),
}));

// Mock React Query — we'll override useQuery's return value per test
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

const mockUseQuery = useQuery as jest.MockedFunction<typeof useQuery>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Tells useQuery to act as if the data is still loading
function mockLoading() {
  mockUseQuery.mockReturnValue({
    isLoading: true,
    data: undefined,
    error: null,
  } as ReturnType<typeof useQuery>);
}

// Tells useQuery to return a dashboard payload — SummaryCards reads the shared
// aggregate, so the summary lives under data.summary.
function mockData(summary: {
  totalIncome: number;
  totalExpenses: number;
  netSavings: number;
  month: number;
  year: number;
}) {
  mockUseQuery.mockReturnValue({
    isLoading: false,
    data: { summary },
    error: null,
  } as ReturnType<typeof useQuery>);
}

// Tells useQuery to simulate a fetch error
function mockError() {
  mockUseQuery.mockReturnValue({
    isLoading: false,
    data: undefined,
    error: new Error('Network error'),
  } as ReturnType<typeof useQuery>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SummaryCards', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('loading state', () => {
    it('renders 3 skeleton placeholders', () => {
      mockLoading();
      render(<SummaryCards />);

      // The component renders an animate-pulse skeleton for each card
      // We check for the outer grid with 3 children
      const skeletons = document.querySelectorAll('.animate-pulse');
      expect(skeletons.length).toBe(3);
    });

    it('does not show any money amounts while loading', () => {
      mockLoading();
      render(<SummaryCards />);
      expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the error fallback message', () => {
      mockError();
      render(<SummaryCards />);
      expect(
        screen.getByText(/Could not load summary/i),
      ).toBeInTheDocument();
    });
  });

  describe('data state', () => {
    const summary = {
      totalIncome: 50000,
      totalExpenses: 30000,
      netSavings: 20000,
      month: 4,
      year: 2026,
    };

    beforeEach(() => mockData(summary));

    it('renders 3 summary cards', () => {
      render(<SummaryCards />);
      expect(screen.getByText('Total Income')).toBeInTheDocument();
      expect(screen.getByText('Total Expenses')).toBeInTheDocument();
      expect(screen.getByText('Net Savings')).toBeInTheDocument();
    });

    it('formats income in INR', () => {
      render(<SummaryCards />);
      // Intl.NumberFormat en-IN formats 50000 as "₹50,000"
      expect(screen.getByText('₹50,000')).toBeInTheDocument();
    });

    it('formats expenses in INR', () => {
      render(<SummaryCards />);
      expect(screen.getByText('₹30,000')).toBeInTheDocument();
    });

    it('shows the Net Savings card with violet gradient when positive', () => {
      render(<SummaryCards />);
      // The card container (not the text) carries the gradient class
      const card = screen.getByText('Net Savings').closest('div[class*="from-violet"]');
      expect(card).toBeInTheDocument();
    });

    it('shows the Net Savings card with orange gradient when spending exceeds income', () => {
      mockData({ ...summary, netSavings: -5000 });
      render(<SummaryCards />);
      const card = screen.getByText('Net Savings').closest('div[class*="from-orange"]');
      expect(card).toBeInTheDocument();
    });
  });
});
