import { Activity, LayoutDashboard, LogOut, Menu, Radar, ShieldAlert, X } from 'lucide-react';
import * as React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useLogout, useMe } from '@/api/auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/monitors', label: 'Monitors', icon: Activity },
  { to: '/incidents', label: 'Incidents', icon: ShieldAlert },
];

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
    isActive
      ? 'bg-sidebar-accent text-foreground'
      : 'text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { data: user } = useMe();
  const logout = useLogout();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        toast.success('Signed out');
        navigate('/login', { replace: true });
      },
      onError: () => {
        // The session may already be gone; the cache is cleared either way.
        navigate('/login', { replace: true });
      },
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 px-3 py-4">
      <div className="flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Radar className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold tracking-tight">PulseCheck</span>
      </div>

      <Separator className="bg-sidebar-border" />

      <nav aria-label="Primary" className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            className={({ isActive }) => navLinkClass({ isActive })}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto space-y-3">
        <Separator className="bg-sidebar-border" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors',
                'hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
              aria-label="Account menu"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-foreground">
                {user?.email.slice(0, 1) ?? '?'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {user?.email ?? 'Not signed in'}
                </span>
                <span className="block text-2xs text-muted-foreground">Account</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel className="truncate">{user?.email ?? 'Account'}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLogout} disabled={logout.isPending}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {logout.isPending ? 'Signing out…' : 'Sign out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Authenticated frame: a persistent sidebar on desktop, a slide-over on mobile,
 * and a single scrollable content column.
 */
export function AppShell() {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[248px_1fr]">
      <aside className="hidden border-r border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 h-screen">
          <SidebarContent />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </Button>
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Radar className="h-4 w-4 text-primary" aria-hidden="true" />
            PulseCheck
          </span>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              aria-label="Close navigation"
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 w-64 border-r border-sidebar-border bg-sidebar shadow-xl">
              <div className="flex justify-end p-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close navigation"
                  onClick={() => setMobileOpen(false)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <SidebarContent onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
