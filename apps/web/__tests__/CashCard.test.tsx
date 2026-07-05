/**
 * Tests for the CashCard dashboard component.
 * Mocks Clerk, React Query, and apiFetch so no real network calls happen.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import CashCard from '@/app/dashboard/CashCard';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock('@/lib/api', () => ({
  apiFetch: jest.fn().mockResolvedValue({}),
}));

const mockUseQuery = useQuery as jest.MockedFunction<typeof useQuery>;
const mockUseQueryClient = useQueryClient as jest.MockedFunction<typeof useQueryClient>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockQueryClient() {
  const qc = { invalidateQueries: jest.fn() };
  mockUseQueryClient.mockReturnValue(qc as any);
  return qc;
}

function mockLoading() {
  mockUseQuery.mockReturnValue({ isLoading: true, data: undefined } as any);
}

function mockBalance(balance: number, totalIn = balance, totalOut = 0) {
  // CashCard reads the shared dashboard aggregate — cash lives under data.cash
  mockUseQuery.mockReturnValue({
    isLoading: false,
    data: { cash: { balance, totalIn, totalOut } },
  } as any);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CashCard', () => {
  beforeEach(() => {
    mockQueryClient();
    jest.clearAllMocks();
  });

  // ─── Loading state ──────────────────────────────────────────────────────

  describe('loading state', () => {
    it('shows a skeleton pulse while loading', () => {
      mockLoading();
      render(<CashCard />);
      expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('does not show any ₹ amounts while loading', () => {
      mockLoading();
      render(<CashCard />);
      expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
    });
  });

  // ─── Balance display ────────────────────────────────────────────────────

  describe('balance display', () => {
    it('shows formatted INR balance', () => {
      mockBalance(3500, 5000, 1500);
      render(<CashCard />);
      expect(screen.getByText('₹3,500')).toBeInTheDocument();
    });

    it('shows ₹0 when balance is zero', () => {
      mockBalance(0);
      render(<CashCard />);
      expect(screen.getByText('₹0')).toBeInTheDocument();
    });

    it('shows in/out summary totals', () => {
      mockBalance(3500, 5000, 1500);
      render(<CashCard />);
      expect(screen.getByText(/₹5,000/)).toBeInTheDocument();
      expect(screen.getByText(/₹1,500/)).toBeInTheDocument();
    });
  });

  // ─── Add / Spend buttons ────────────────────────────────────────────────

  describe('idle mode buttons', () => {
    it('shows "+ Add" and "− Spend" buttons in idle mode', () => {
      mockBalance(1000);
      render(<CashCard />);
      expect(screen.getByText('+ Add')).toBeInTheDocument();
      expect(screen.getByText('− Spend')).toBeInTheDocument();
    });
  });

  // ─── Add mode ───────────────────────────────────────────────────────────

  describe('add mode', () => {
    it('opens add form when "+ Add" is clicked', () => {
      mockBalance(1000);
      render(<CashCard />);
      fireEvent.click(screen.getByText('+ Add'));
      expect(screen.getByPlaceholderText('Amount ₹')).toBeInTheDocument();
    });

    it('shows ATM, Person and Other source chips in add mode', () => {
      mockBalance(1000);
      render(<CashCard />);
      fireEvent.click(screen.getByText('+ Add'));
      // Chips render as "🏧 ATM Withdrawal" — use regex to match label text
      expect(screen.getByText(/ATM Withdrawal/)).toBeInTheDocument();
      expect(screen.getByText(/Received from Person/)).toBeInTheDocument();
      expect(screen.getByText(/Other/)).toBeInTheDocument();
    });

    it('shows "Add Cash" submit button in add mode', () => {
      mockBalance(1000);
      render(<CashCard />);
      fireEvent.click(screen.getByText('+ Add'));
      expect(screen.getByText('Add Cash')).toBeInTheDocument();
    });

    it('returns to idle when Cancel is clicked', () => {
      mockBalance(1000);
      render(<CashCard />);
      fireEvent.click(screen.getByText('+ Add'));
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.getByText('+ Add')).toBeInTheDocument();
    });
  });

  // ─── Spend mode ─────────────────────────────────────────────────────────

  describe('spend mode', () => {
    it('opens spend form when "− Spend" is clicked', () => {
      mockBalance(1000);
      render(<CashCard />);
      fireEvent.click(screen.getByText('− Spend'));
      expect(screen.getByPlaceholderText('Amount ₹')).toBeInTheDocument();
    });

    it('shows Cash Payment and Deposited to Bank chips in spend mode', () => {
      mockBalance(1000);
      render(<CashCard />);
      fireEvent.click(screen.getByText('− Spend'));
      expect(screen.getByText(/Cash Payment/)).toBeInTheDocument();
      expect(screen.getByText(/Deposited to Bank/)).toBeInTheDocument();
    });

    it('shows "Record Spend" submit button in spend mode', () => {
      mockBalance(1000);
      render(<CashCard />);
      fireEvent.click(screen.getByText('− Spend'));
      expect(screen.getByText('Record Spend')).toBeInTheDocument();
    });
  });

  // ─── Form submission ─────────────────────────────────────────────────────

  describe('form submission', () => {
    it('invalidates the dashboard aggregate after successful add', async () => {
      const qc = mockQueryClient();
      mockBalance(1000);
      render(<CashCard />);

      fireEvent.click(screen.getByText('+ Add'));
      fireEvent.change(screen.getByPlaceholderText('Amount ₹'), { target: { value: '500' } });
      // Click the submit button directly — plain <form> has no ARIA "form" role
      fireEvent.click(screen.getByText('Add Cash'));

      await waitFor(() => {
        expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
      });
    });
  });
});
