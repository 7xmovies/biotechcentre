import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Home,
  FileText,
  Package,
  Users,
  ShoppingCart,
  BarChart2,
  Settings,
  Archive,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';

const navSections = [
  {
    label: 'Operations',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: Home },
      { name: 'Invoices', href: '/invoices', icon: FileText },
      { name: 'Inventory', href: '/inventory', icon: Package },
      { name: 'Stock', href: '/stock', icon: Archive },
      { name: 'Customers', href: '/customers', icon: Users },
      { name: 'Purchases', href: '/purchases', icon: ShoppingCart },
    ],
  },
  {
    label: 'System',
    items: [
      { name: 'Reports', href: '/reports', icon: BarChart2 },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  isCollapsed,
  onToggleCollapse,
}) => {
  const renderSidebarBody = (isMobile: boolean) => {
    const collapsed = !isMobile && isCollapsed;

    return (
      <div className="flex h-full flex-col bg-white dark:bg-gray-900 text-slate-700 dark:text-slate-200 select-none">
        {/* Brand Header */}
        <div
          className={`flex h-16 shrink-0 items-center border-b border-slate-200/80 dark:border-gray-800 ${
            collapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'justify-center' : ''}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-bold text-sm shadow-sm">
              EZ
            </div>
            {!collapsed && (
              <span className="truncate text-base font-bold tracking-tight text-slate-900 dark:text-white">
                BIOTECHCENTRE
              </span>
            )}
          </div>

          {isMobile ? (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-gray-800 dark:hover:text-white transition-colors"
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          ) : !collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-gray-800 dark:hover:text-slate-200 transition-colors"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-5 h-5" />
            </button>
          ) : null}
        </div>

        {/* Navigation Sections */}
        <nav className={`flex-1 overflow-y-auto overflow-x-hidden py-4 ${collapsed ? 'px-2.5' : 'px-3'} space-y-5`}>
          {navSections.map((section, idx) => (
            <div key={section.label} className="space-y-1">
              {!collapsed ? (
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {section.label}
                </p>
              ) : idx > 0 ? (
                <div className="mx-2 my-2 border-t border-slate-200 dark:border-gray-800" />
              ) : null}

              {section.items.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.href}
                  onClick={isMobile ? onClose : undefined}
                  title={collapsed ? item.name : undefined}
                  className={({ isActive }) =>
                    `group relative flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
                      collapsed ? 'justify-center px-0 py-2.5' : 'px-3 py-2.5 gap-3'
                    } ${
                      isActive
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-white'
                    }`
                  }
                >
                  <item.icon className="w-5 h-5 shrink-0" />
                  {!collapsed && <span className="truncate">{item.name}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom Collapse / Expand Control */}
        <div className={`shrink-0 border-t border-slate-200/80 dark:border-gray-800 p-3`}>
          {isMobile ? (
            <button
              type="button"
              onClick={onClose}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-gray-700 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
              <span>Collapse Menu</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              className={`flex w-full items-center rounded-lg border border-slate-200 dark:border-gray-700 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-gray-800 hover:text-slate-900 dark:hover:text-white transition-colors ${
                collapsed ? 'justify-center px-0' : 'justify-center gap-2 px-3'
              }`}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <>
                  <PanelLeftClose className="w-4 h-4" />
                  <span>Collapse Sidebar</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className={`fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-[1px] transition-opacity duration-200 md:hidden ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Mobile Drawer Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-slate-200 dark:border-gray-800 shadow-xl transform transition-transform duration-200 ease-in-out md:hidden ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderSidebarBody(true)}
      </aside>

      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden md:fixed md:inset-y-0 md:left-0 md:z-20 md:flex flex-col border-r border-slate-200 dark:border-gray-800 transition-all duration-200 ease-in-out ${
          isCollapsed ? 'md:w-20' : 'md:w-64'
        }`}
      >
        {renderSidebarBody(false)}
      </aside>
    </>
  );
};

export default Sidebar;