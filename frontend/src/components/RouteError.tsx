import { RefreshCw, TriangleAlert } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { Button, Card } from './ui';

/** Friendly replacement for the router's developer error screen. */
export function RouteError({ notFound: forced = false }: { notFound?: boolean }) {
  const error = useRouteError();
  const notFound = forced || (isRouteErrorResponse(error) && error.status === 404);
  const staleVersion = error instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk/i.test(error.message);
  return (
    <div className="mx-auto mt-20 max-w-md px-4">
      <Card>
        <div className="space-y-3 p-6 text-center">
          <TriangleAlert className="mx-auto size-8 text-amber-500" aria-hidden />
          <h1 className="text-lg font-semibold">{notFound ? 'Page not found' : staleVersion ? 'A new version is available' : 'Something went wrong'}</h1>
          <p className="text-sm text-slate-500">
            {notFound
              ? "That page doesn't exist."
              : staleVersion
                ? 'RefundDesk was updated while this tab was open. Reload to continue.'
                : 'An unexpected error occurred. Reloading usually fixes it; your data is safe.'}
          </p>
          <div className="flex justify-center gap-2 pt-1">
            {!notFound && (
              <Button onClick={() => window.location.reload()}>
                <RefreshCw className="size-4" aria-hidden /> Reload
              </Button>
            )}
            <Link to="/" className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              Go to chat
            </Link>
          </div>
        </div>
      </Card>
    </div>
  );
}
