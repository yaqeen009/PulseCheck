import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Compass className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold">Page not found</h1>
            <p className="text-sm text-muted-foreground">
              That address does not exist in PulseCheck. It may have been moved or deleted.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild>
              <Link to="/">Go to dashboard</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/monitors">View monitors</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
