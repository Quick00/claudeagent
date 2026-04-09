/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock next-auth/react
jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
  signOut: jest.fn(),
}));

// Mock next/script — render as a div and call onReady synchronously
jest.mock('next/script', () => ({
  __esModule: true,
  default: function MockScript(props: any) {
    if (props.onReady) {
      props.onReady();
    }
    return <div data-testid="mock-script" data-src={props.src} data-strategy={props.strategy} />;
  },
}));

import FeedbackWidget from '../FeedbackWidget';
import ChatSidebar from '../ChatSidebar';
import { useSession } from 'next-auth/react';

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;

describe('FeedbackWidget', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up any global Featurebase mock
    delete (window as any).Featurebase;
    delete process.env.NEXT_PUBLIC_FEATUREBASE_ORG;
  });

  it('renders the Feedback button', () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);
    expect(screen.getByText('Feedback')).toBeDefined();
  });

  it('loads the Featurebase SDK script with lazyOnload strategy', () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);
    const script = screen.getByTestId('mock-script');
    expect(script.getAttribute('data-src')).toBe('https://do.featurebase.app/js/sdk.js');
    expect(script.getAttribute('data-strategy')).toBe('lazyOnload');
  });

  it('initializes Featurebase with user data when SDK loads', () => {
    const mockFeaturebase = jest.fn();
    (window as any).Featurebase = mockFeaturebase;

    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    process.env.NEXT_PUBLIC_FEATUREBASE_ORG = 'test-org';

    render(<FeedbackWidget />);

    expect(mockFeaturebase).toHaveBeenCalledWith('initialize_feedback_widget', expect.objectContaining({
      organization: 'test-org',
      email: 'test@example.com',
      name: 'Test User',
      theme: 'light',
    }));
  });

  it('posts message to open widget on button click', () => {
    const postMessageSpy = jest.spyOn(window, 'postMessage');

    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);

    fireEvent.click(screen.getByText('Feedback'));

    expect(postMessageSpy).toHaveBeenCalledWith({
      target: 'FeaturebaseWidget',
      data: { action: 'openFeedbackWidget' },
    }, '*');

    postMessageSpy.mockRestore();
  });

  it('renders button even when session is loading', () => {
    mockUseSession.mockReturnValue({
      data: null,
      status: 'loading',
      update: jest.fn() as any,
    });

    render(<FeedbackWidget />);
    expect(screen.getByText('Feedback')).toBeDefined();
  });
});

describe('ChatSidebar feedback integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock fetch for ChatSidebar's /api/conversations call
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve([]),
    }) as any;
  });

  afterEach(() => {
    (global.fetch as jest.Mock).mockRestore?.();
  });

  it('renders the FeedbackWidget in the sidebar', async () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: 'Test User', email: 'test@example.com' }, expires: '' },
      status: 'authenticated',
      update: jest.fn() as any,
    });

    render(
      <ChatSidebar
        activeConversationId={null}
        onSelectConversation={jest.fn()}
        onNewChat={jest.fn()}
        refreshTrigger={0}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Feedback')).toBeDefined();
    });
  });
});
