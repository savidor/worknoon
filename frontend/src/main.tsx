import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import './index.css';
import { Spinner } from './components/ui';
import { ChatPage } from './pages/ChatPage';

// The customer chat is the entry point; staff and policy pages load on demand.
const ConsolePage = lazy(() => import('./pages/ConsolePage').then((m) => ({ default: m.ConsolePage })));
const PolicyPage = lazy(() => import('./pages/PolicyPage').then((m) => ({ default: m.PolicyPage })));
const PolicyStudioPage = lazy(() => import('./pages/PolicyStudioPage').then((m) => ({ default: m.PolicyStudioPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <ChatPage /> },
      { path: '/console', element: <Suspense fallback={<Spinner />}><ConsolePage /></Suspense> },
      { path: '/console/policy', element: <Suspense fallback={<Spinner />}><PolicyStudioPage /></Suspense> },
      { path: '/policy', element: <Suspense fallback={<Spinner />}><PolicyPage /></Suspense> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
