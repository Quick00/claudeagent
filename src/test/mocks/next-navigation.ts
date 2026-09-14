import { jest } from '@jest/globals';

export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  refresh: jest.fn(),
  back: jest.fn(),
  forward: jest.fn(),
  prefetch: jest.fn(),
};

export const useRouter = () => mockRouter;
export const usePathname = jest.fn(() => '/');
export const useSearchParams = jest.fn(() => new URLSearchParams());
export const useParams = jest.fn(() => ({}));
export const redirect = jest.fn();
export const notFound = jest.fn();
