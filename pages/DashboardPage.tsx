import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../hooks/lib/supabase';
import { formatCurrency, formatDate } from '../hooks/lib/utils';
import Skeleton from '../components/ui/Skeleton';
import { Button } from '../components/ui/Button';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Plus,
  ArrowUpRight,
  PackageCheck,
  AlertTriangle,
  IndianRupee,
  FileText,
  Users,
  Package,
} from 'lucide-react';

interface ChartMonthPoint {
  name: string;
  fullLabel: string;
  year: number;
  monthIndex: number;
  Sales: number;
  Purchases: number;
}

interface PieSlice {
  name: string;
  value: number;
  color: string;
  skus?: number;
}

interface StockAlertItem {
  id: string;
  name: string;
  stock_quantity: number;
  unit: string;
  category: string;
}

interface RecentInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  customer_name: string;
}

const CATEGORY_COLORS = [
  '#2563EB', // blue-600
  '#0D9488', // teal-600
  '#4F46E5', // indigo-600
  '#D97706', // amber-600
  '#0284C7', // sky-600
  '#64748B', // slate-500 (Other)
];

const STOCK_HEALTH_COLORS = {
  inStock: '#16A34A',
  lowStock: '#D97706',
  outOfStock: '#DC2626',
};

const fetchDashboardData = async () => {
  const [
    invoicesRes,
    recentInvoicesRes,
    customersRes,
    productsRes,
    purchasesRes,
  ] = await Promise.all([
    supabase.from('invoices').select('total_amount, invoice_date', { count: 'exact' }),
    supabase
      .from('invoices')
      .select('id, invoice_number, invoice_date, total_amount, customers(name)')
      .order('created_at', { ascending: false })
      .limit(6),
    supabase.from('customers').select('id, is_guest, name').neq('name', '__SYSTEM_PING__'),
    supabase
      .from('products')
      .select('id, name, stock_quantity, units(abbreviation), categories(name)')
      .order('name', { ascending: true }),
    supabase.from('purchases').select('purchase_date, quantity, products(unit_price)'),
  ]);

  if (invoicesRes.error) throw new Error(invoicesRes.error.message);
  if (recentInvoicesRes.error) throw new Error(recentInvoicesRes.error.message);
  if (customersRes.error) throw new Error(customersRes.error.message);
  if (productsRes.error) throw new Error(productsRes.error.message);
  if (purchasesRes.error) throw new Error(purchasesRes.error.message);

  const invoices = (invoicesRes.data || []) as { total_amount: number; invoice_date: string }[];
  const recentRaw = (recentInvoicesRes.data || []) as any[];
  const customers = (customersRes.data || []) as { id: string; is_guest: boolean }[];
  const products = (productsRes.data || []) as any[];
  const purchases = (purchasesRes.data || []) as any[];

  const totalRevenue = invoices.reduce((sum, inv) => sum + Number(inv.total_amount || 0), 0);
  const totalInvoices = invoicesRes.count ?? invoices.length;
  const avgInvoiceValue = totalInvoices > 0 ? totalRevenue / totalInvoices : 0;

  const activeCustomers = customers.filter((c) => !c.is_guest).length;
  const guestCustomers = customers.filter((c) => c.is_guest).length;

  const totalStockUnits = products.reduce(
    (sum, p) => sum + Math.max(0, Number(p.stock_quantity || 0)),
    0
  );

  let inStockCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  const outOfStockItems: StockAlertItem[] = [];
  const lowStockItems: StockAlertItem[] = [];

  const categoryTotals = new Map<string, { units: number; skus: number }>();

  for (const prod of products) {
    const qty = Number(prod.stock_quantity || 0);
    const catName = prod.categories?.name || 'Uncategorized';
    const unitAbbr = prod.units?.abbreviation || 'units';

    const catEntry = categoryTotals.get(catName) || { units: 0, skus: 0 };
    catEntry.units += Math.max(0, qty);
    catEntry.skus += 1;
    categoryTotals.set(catName, catEntry);

    if (qty <= 0) {
      outOfStockCount += 1;
      outOfStockItems.push({
        id: prod.id,
        name: prod.name,
        stock_quantity: qty,
        unit: unitAbbr,
        category: catName,
      });
    } else if (qty <= 10) {
      lowStockCount += 1;
      lowStockItems.push({
        id: prod.id,
        name: prod.name,
        stock_quantity: qty,
        unit: unitAbbr,
        category: catName,
      });
    } else {
      inStockCount += 1;
    }
  }

  lowStockItems.sort((a, b) => a.stock_quantity - b.stock_quantity);

  const sortedCategories = Array.from(categoryTotals.entries()).sort(
    (a, b) => b[1].units - a[1].units || b[1].skus - a[1].skus
  );
  const categorySlices: PieSlice[] = [];
  let otherUnits = 0;
  let otherSkus = 0;

  sortedCategories.forEach(([name, stats], idx) => {
    const metricVal = totalStockUnits > 0 ? stats.units : stats.skus;
    if (idx < 5) {
      categorySlices.push({
        name,
        value: metricVal,
        skus: stats.skus,
        color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
      });
    } else {
      otherUnits += stats.units;
      otherSkus += stats.skus;
    }
  });

  if (otherSkus > 0) {
    categorySlices.push({
      name: 'Other',
      value: totalStockUnits > 0 ? otherUnits : otherSkus,
      skus: otherSkus,
      color: CATEGORY_COLORS[5],
    });
  }

  const stockHealthSlices: PieSlice[] = [
    { name: 'In Stock (>10)', value: inStockCount, color: STOCK_HEALTH_COLORS.inStock },
    { name: 'Low Stock (1-10)', value: lowStockCount, color: STOCK_HEALTH_COLORS.lowStock },
    { name: 'Out of Stock', value: outOfStockCount, color: STOCK_HEALTH_COLORS.outOfStock },
  ].filter((s) => s.value > 0);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const today = new Date();
  const chartData12M: ChartMonthPoint[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    chartData12M.push({
      name: monthNames[d.getMonth()],
      fullLabel: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
      year: d.getFullYear(),
      monthIndex: d.getMonth(),
      Sales: 0,
      Purchases: 0,
    });
  }

  const cutoffDate = new Date(today.getFullYear(), today.getMonth() - 11, 1);
  cutoffDate.setHours(0, 0, 0, 0);

  for (const invoice of invoices) {
    const d = new Date(invoice.invoice_date);
    if (!Number.isNaN(d.getTime()) && d >= cutoffDate) {
      const bucket = chartData12M.find(
        (b) => b.monthIndex === d.getMonth() && b.year === d.getFullYear()
      );
      if (bucket) {
        bucket.Sales += Number(invoice.total_amount || 0);
      }
    }
  }

  for (const purchase of purchases) {
    const d = new Date(purchase.purchase_date);
    if (!Number.isNaN(d.getTime()) && d >= cutoffDate) {
      const bucket = chartData12M.find(
        (b) => b.monthIndex === d.getMonth() && b.year === d.getFullYear()
      );
      if (bucket) {
        const price = Number(purchase.products?.unit_price || 0);
        bucket.Purchases += Number(purchase.quantity || 0) * price;
      }
    }
  }

  const currentMonthSales = chartData12M[chartData12M.length - 1]?.Sales ?? 0;

  const recentInvoices: RecentInvoiceRow[] = recentRaw.map((inv) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    invoice_date: inv.invoice_date,
    total_amount: Number(inv.total_amount || 0),
    customer_name: inv.customers?.name || 'Guest Checkout',
  }));

  return {
    totalRevenue,
    currentMonthSales,
    totalInvoices,
    avgInvoiceValue,
    activeCustomers,
    guestCustomers,
    totalProducts: products.length,
    totalStockUnits,
    inStockCount,
    lowStockCount,
    outOfStockCount,
    chartData12M,
    categorySlices: categorySlices.filter((s) => s.value > 0),
    stockHealthSlices,
    outOfStockItems,
    lowStockItems,
    recentInvoices,
  };
};

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [rangeMonths, setRangeMonths] = useState<6 | 12>(12);
  const [pieMode, setPieMode] = useState<'category' | 'health'>('category');
  const [alertTab, setAlertTab] = useState<'out' | 'low'>('out');
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: fetchDashboardData,
  });

  const visibleChartData = useMemo(() => {
    if (!data) return [];
    return rangeMonths === 6 ? data.chartData12M.slice(-6) : data.chartData12M;
  }, [data, rangeMonths]);

  const activeSlices = useMemo(() => {
    if (!data) return [];
    return pieMode === 'category' ? data.categorySlices : data.stockHealthSlices;
  }, [data, pieMode]);

  const activePieTotal = useMemo(
    () => activeSlices.reduce((sum, s) => sum + s.value, 0),
    [activeSlices]
  );

  const visibleStockAlerts = useMemo(() => {
    if (!data) return [];
    return alertTab === 'out' ? data.outOfStockItems : data.lowStockItems;
  }, [data, alertTab]);

  const BarChartTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const point = payload[0]?.payload as ChartMonthPoint | undefined;
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-lg text-xs">
        <p className="font-semibold text-slate-900 dark:text-slate-100 mb-1.5">
          {point?.fullLabel}
        </p>
        <div className="space-y-1">
          {payload.map((entry: any) => (
            <div key={entry.dataKey} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span
                  className="h-2.5 w-2.5 rounded-sm shrink-0"
                  style={{ backgroundColor: entry.color }}
                />
                {entry.name}
              </span>
              <span className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {formatCurrency(Number(entry.value || 0))}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const PieChartTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const slice = payload[0]?.payload as PieSlice;
    const pct = activePieTotal > 0 ? ((slice.value / activePieTotal) * 100).toFixed(1) : '0.0';
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-lg text-xs max-w-[200px]">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className="h-2.5 w-2.5 rounded-sm shrink-0"
            style={{ backgroundColor: slice.color }}
          />
          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
            {slice.name}
          </span>
        </div>
        <p className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
          {slice.value.toLocaleString()} {pieMode === 'category' ? 'units' : 'products'} ({pct}%)
        </p>
        {pieMode === 'category' && slice.skus !== undefined && (
          <p className="text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
            {slice.skus} {slice.skus === 1 ? 'product' : 'products'}
          </p>
        )}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-full overflow-x-hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <Skeleton className="h-5 w-48 mb-6" />
            <Skeleton className="h-72 w-full" />
          </div>
          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <Skeleton className="h-5 w-40 mb-6" />
            <Skeleton className="h-72 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 p-6">
        <h2 className="text-base font-semibold text-red-700 dark:text-red-400">
          Failed to load dashboard
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
          {error instanceof Error ? error.message : 'An unknown error occurred.'}
        </p>
      </div>
    );
  }

  const highlightedSlice =
    activePieIndex !== null && activeSlices[activePieIndex] ? activeSlices[activePieIndex] : null;

  return (
    <div className="space-y-6 w-full max-w-full overflow-x-hidden">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-slate-500 dark:text-slate-400">
            <span>Business overview</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{data?.totalProducts ?? 0} products</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{data?.totalInvoices ?? 0} invoices</span>
          </div>
        </div>
        <Button
          onClick={() => navigate('/invoices/new')}
          className="whitespace-nowrap shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          New Invoice
        </Button>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 overflow-hidden rounded-xl border border-blue-200/80 dark:border-blue-800/60 bg-gradient-to-br from-blue-50/80 to-white dark:from-blue-950/40 dark:to-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs sm:text-sm font-medium text-blue-700 dark:text-blue-300 truncate">
              Total Revenue
            </p>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
              <IndianRupee className="h-4 w-4" />
            </div>
          </div>
          <p
            title={formatCurrency(data?.totalRevenue ?? 0)}
            className="mt-2 text-lg sm:text-xl 2xl:text-2xl font-bold font-mono tabular-nums tracking-tight text-slate-900 dark:text-slate-50 truncate"
          >
            {formatCurrency(data?.totalRevenue ?? 0)}
          </p>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 tabular-nums truncate">
            This month:{' '}
            <span className="font-semibold text-blue-700 dark:text-blue-300">
              {formatCurrency(data?.currentMonthSales ?? 0)}
            </span>
          </p>
        </div>

        <div className="min-w-0 overflow-hidden rounded-xl border border-indigo-200/80 dark:border-indigo-800/60 bg-gradient-to-br from-indigo-50/80 to-white dark:from-indigo-950/40 dark:to-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs sm:text-sm font-medium text-indigo-700 dark:text-indigo-300 truncate">
              Total Invoices
            </p>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
              <FileText className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-lg sm:text-xl 2xl:text-2xl font-bold font-mono tabular-nums tracking-tight text-slate-900 dark:text-slate-50 truncate">
            {(data?.totalInvoices ?? 0).toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 tabular-nums truncate">
            Avg:{' '}
            <span className="font-semibold text-indigo-700 dark:text-indigo-300">
              {formatCurrency(data?.avgInvoiceValue ?? 0)}
            </span>
          </p>
        </div>

        <div className="min-w-0 overflow-hidden rounded-xl border border-sky-200/80 dark:border-sky-800/60 bg-gradient-to-br from-sky-50/80 to-white dark:from-sky-950/40 dark:to-slate-900 text-[#2056eb] dark:text-sky-300 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs sm:text-sm font-medium text-[#2056eb] dark:text-sky-300 truncate">
              Active Customers
            </p>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2056eb]/10 text-[#2056eb] dark:bg-sky-500/20 dark:text-sky-400">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-lg sm:text-xl 2xl:text-2xl font-bold font-mono tabular-nums tracking-tight text-[#2056eb] dark:text-sky-200 truncate">
            {(data?.activeCustomers ?? 0).toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 tabular-nums truncate">
            Registered · {data?.guestCustomers ?? 0} guest
          </p>
        </div>

        <div className="min-w-0 overflow-hidden rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50/80 to-white dark:from-emerald-950/40 dark:to-slate-900 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs sm:text-sm font-medium text-emerald-700 dark:text-emerald-300 truncate">
              Units in Stock
            </p>
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <Package className="h-4 w-4" />
            </div>
          </div>
          <p className="mt-2 text-lg sm:text-xl 2xl:text-2xl font-bold font-mono tabular-nums tracking-tight text-slate-900 dark:text-slate-50 truncate">
            {(data?.totalStockUnits ?? 0).toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 tabular-nums truncate">
            <span className="text-amber-600 dark:text-amber-400 font-semibold">
              {data?.lowStockCount ?? 0} low
            </span>
            {' · '}
            <span className="text-red-600 dark:text-red-400 font-semibold">
              {data?.outOfStockCount ?? 0} out
            </span>
          </p>
        </div>
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Sales & Purchases Chart */}
        <section className="lg:col-span-7 min-w-0 overflow-hidden flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Sales &amp; Purchases Overview
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-blue-600 shrink-0" />
                  Sales
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-teal-500 shrink-0" />
                  Est. Purchases
                </span>
              </div>
            </div>

            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-1 shrink-0">
              {([6, 12] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRangeMonths(m)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    rangeMonths === m
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {m}M
                </button>
              ))}
            </div>
          </div>

          <div className="h-72 sm:h-80 w-full min-w-0 mt-auto">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={visibleChartData}
                margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
                barGap={3}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  dy={8}
                />
                <YAxis
                  width={54}
                  allowDecimals={false}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#64748b', fontSize: 11 }}
                  tickFormatter={(value: number) => {
                    if (value === 0) return '₹0';
                    if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
                    return `₹${value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}`;
                  }}
                />
                <Tooltip content={<BarChartTooltip />} cursor={{ fill: '#64748b', opacity: 0.08 }} />
                <Bar dataKey="Sales" fill="#2563EB" radius={[4, 4, 0, 0]} maxBarSize={20} />
                <Bar dataKey="Purchases" fill="#14B8A6" radius={[4, 4, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Interactive Donut / Pie Chart */}
        <section className="lg:col-span-5 min-w-0 overflow-hidden flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Inventory Distribution
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {pieMode === 'category'
                  ? 'Stock units across top categories'
                  : 'Products by stock availability'}
              </p>
            </div>

            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-1 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setPieMode('category');
                  setActivePieIndex(null);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  pieMode === 'category'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Categories
              </button>
              <button
                type="button"
                onClick={() => {
                  setPieMode('health');
                  setActivePieIndex(null);
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  pieMode === 'health'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Health
              </button>
            </div>
          </div>

          {activeSlices.length > 0 ? (
            <div className="flex flex-col items-center gap-4 my-auto w-full min-w-0">
              {/* Centered Donut Visual */}
              <div className="relative h-44 w-44 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={activeSlices}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={76}
                      paddingAngle={2}
                      stroke="none"
                      onMouseEnter={(_, index) => setActivePieIndex(index)}
                      onMouseLeave={() => setActivePieIndex(null)}
                    >
                      {activeSlices.map((entry, idx) => (
                        <Cell
                          key={entry.name}
                          fill={entry.color}
                          opacity={activePieIndex === null || activePieIndex === idx ? 1 : 0.45}
                          className="transition-opacity duration-150 cursor-pointer outline-none"
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<PieChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                {/* Center Readout */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-5">
                  <span className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-50 leading-tight max-w-[92px] truncate">
                    {(highlightedSlice ? highlightedSlice.value : activePieTotal).toLocaleString()}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[92px] mt-0.5">
                    {highlightedSlice
                      ? highlightedSlice.name
                      : pieMode === 'category'
                        ? 'Total units'
                        : 'Total SKUs'}
                  </span>
                </div>
              </div>

              {/* Full-Width Tabular Breakdown List (never clips or squeezes) */}
              <div className="w-full min-w-0 divide-y divide-slate-100 dark:divide-slate-800">
                {activeSlices.map((slice, idx) => {
                  const pct =
                    activePieTotal > 0 ? Math.round((slice.value / activePieTotal) * 100) : 0;
                  const isHighlighted = activePieIndex === idx;
                  return (
                    <div
                      key={slice.name}
                      onMouseEnter={() => setActivePieIndex(idx)}
                      onMouseLeave={() => setActivePieIndex(null)}
                      className={`flex items-center justify-between gap-3 py-1.5 px-1.5 text-xs rounded transition-colors cursor-default ${
                        isHighlighted ? 'bg-slate-50 dark:bg-slate-800/70' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: slice.color }}
                        />
                        <span className="truncate font-medium text-slate-700 dark:text-slate-200">
                          {slice.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0 font-mono tabular-nums">
                        <span className="text-slate-900 dark:text-slate-100 font-semibold">
                          {slice.value.toLocaleString()}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 w-9 text-right">
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              <p>No inventory data available yet.</p>
            </div>
          )}
        </section>
      </div>

      {/* Bottom Operational Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Recent Invoices */}
        <section className="lg:col-span-7 min-w-0 overflow-hidden flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
                Recent Invoices
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Latest billing activity across customers
              </p>
            </div>
            <Link
              to="/invoices"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              View all
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {data?.recentInvoices && data.recentInvoices.length > 0 ? (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-left text-xs font-medium text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap">Invoice #</th>
                    <th className="py-2.5 pr-3 font-medium">Customer</th>
                    <th className="py-2.5 pr-3 font-medium whitespace-nowrap hidden sm:table-cell">Date</th>
                    <th className="py-2.5 text-right font-medium whitespace-nowrap">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {data.recentInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      onClick={() => navigate(`/invoices/edit/${inv.id}`)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                    >
                      <td className="py-3 pr-3 font-mono text-xs font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {inv.invoice_number}
                      </td>
                      <td className="py-3 pr-3 text-slate-700 dark:text-slate-300 max-w-[140px] sm:max-w-[180px] truncate">
                        {inv.customer_name}
                      </td>
                      <td className="py-3 pr-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums hidden sm:table-cell">
                        {formatDate(inv.invoice_date)}
                      </td>
                      <td className="py-3 text-right font-mono text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {formatCurrency(inv.total_amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">No invoices recorded yet.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/invoices/new')}>
                Create First Invoice
              </Button>
            </div>
          )}
        </section>

        {/* Stock Attention List */}
        <section className="lg:col-span-5 min-w-0 overflow-hidden flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50 truncate">
                Stock Attention
              </h2>
            </div>

            <div className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 p-1 shrink-0">
              <button
                type="button"
                onClick={() => setAlertTab('out')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  alertTab === 'out'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Out ({data?.outOfStockCount ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setAlertTab('low')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  alertTab === 'low'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Low ({data?.lowStockCount ?? 0})
              </button>
            </div>
          </div>

          {visibleStockAlerts.length > 0 ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="divide-y divide-slate-100 dark:divide-slate-800 overflow-y-auto max-h-[280px] pr-1">
                {visibleStockAlerts.map((item) => (
                  <Link
                    key={item.id}
                    to={`/stock/${item.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 px-1.5 rounded-md transition-colors group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {item.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {item.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`font-mono text-xs font-semibold tabular-nums whitespace-nowrap ${
                          item.stock_quantity <= 0
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {item.stock_quantity} {item.unit}
                      </span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors shrink-0" />
                    </div>
                  </Link>
                ))}
              </div>
              <div className="pt-3 mt-auto border-t border-slate-100 dark:border-slate-800 flex justify-end">
                <Link
                  to="/stock"
                  className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Open full stock ledger
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center py-10 text-center text-slate-500 dark:text-slate-400">
              <PackageCheck className="w-8 h-8 mb-2 text-emerald-600 dark:text-emerald-400 opacity-80" />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {alertTab === 'out' ? 'No out-of-stock products' : 'No low-stock products'}
              </p>
              <p className="text-xs mt-0.5">All inventory levels look healthy.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default DashboardPage;