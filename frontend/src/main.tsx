import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RouteError } from './components/RouteError';
import './index.css';
import { Spinner } from './components/ui';
import { lazyPage } from './lib/lazyPage';
import { ChatPage } from './pages/ChatPage';

// The customer chat is the entry point; staff and policy pages load on demand.
const ConsolePage = lazyPage(() => import('./pages/ConsolePage').then((m) => m.ConsolePage));
const PolicyPage = lazyPage(() => import('./pages/PolicyPage').then((m) => m.PolicyPage));
const PolicyStudioPage = lazyPage(() => import('./pages/PolicyStudioPage').then((m) => m.PolicyStudioPage));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
});

const page = (el: ReactNode) => <Suspense fallback={<Spinner />}>{el}</Suspense>;

const router = createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        // Errors inside a page render within the layout, so the navigation stays usable.
        errorElement: <RouteError />,
        children: [
          { path: '/', element: <ChatPage /> },
          { path: '/console', element: page(<ConsolePage />) },
          { path: '/console/policy', element: page(<PolicyStudioPage />) },
          { path: '/policy', element: page(<PolicyPage />) },
          { path: '*', element: <RouteError notFound /> },
        ],
      },
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
