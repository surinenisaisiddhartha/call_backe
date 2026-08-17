import React, { useEffect, useState } from 'react';
import api, { getErrorMessage } from '../api';
import {
  CreditCard, DollarSign, TrendingUp, BarChart3, Clock, ShieldAlert,
  Percent, FileText, Download, Edit3, Save, RefreshCw, Layers, CheckCircle2,
  PieChart, Activity, HelpCircle, ArrowUpRight, ArrowLeft, Calculator, Sliders,
  Sparkles, Building, Phone, ShieldCheck, Copy, Check, Info, X, Zap, ChevronRight,
  TrendingDown, CheckCircle, AlertCircle
} from 'lucide-react';

interface RateItem {
  id: string;
  version_number: number;
  provider: string;
  platform_rate_per_min: number;
  telephony_rate_per_min: number;
  stt_rate_per_min: number;
  llm_rate_per_min: number;
  tts_rate_per_min: number;
  total_per_min: number;
  currency: string;
}

interface MarkupSettings {
  markup_type: 'percentage' | 'fixed_per_min';
  markup_value: number;
  currency: string;
  tax_rate_percent: number;
}

interface InvoiceItem {
  id: string;
  date: string;
  period: string;
  minutes: number;
  calls: number;
  amount: string;
  status: 'Paid' | 'Pending';
}

interface SchoolMarkupItem {
  school_id: string;
  school_name: string;
  school_slug: string;
  logo_url: string | null;
  lead_count: number;
  is_custom: boolean;
  markup_type: 'percentage' | 'fixed_per_min';
  markup_value: number;
  currency: string;
  tax_rate_percent: number;
}

interface CallLedgerItem {
  id: string;
  call_attempt_id: string;
  provider: string;
  created_at: string;
  formatted_date: string;
  contact_name: string;
  contact_phone: string;
  school_name: string;
  duration_sec: number;
  duration_formatted: string;
  provider_platform_cost: number;
  provider_telephony_cost: number;
  provider_ai_cost: number;
  provider_total_cost: number;
  cost_source: 'provider_actual' | 'provider_usage_estimate' | 'configured_rate' | 'manual_adjustment';
  provider_usage_id: string | null;
  customer_rate_per_min: number;
  markup_amount: number;
  markup_on_cost_percent: number;
  gross_margin_percent: number;
  tax_amount: number;
  customer_billable_total: number;
  currency: string;
}

interface ProviderEconomicsItem {
  provider: string;
  provider_name: string;
  description: string;
  calls: number;
  minutes: number;
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  cost_per_min: number;
  revenue_per_min: number;
  profit_per_min: number;
  gross_margin_percent: number;
  markup_on_cost_percent: number;
  currency: string;
}

interface EconomicsSummary {
  total_calls: number;
  total_minutes: number;
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  cost_per_min: number;
  revenue_per_min: number;
  profit_per_min: number;
  gross_margin_percent: number;
}

interface BillingProps {
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

export default function Billing({ showToast }: BillingProps) {
  const [rates, setRates] = useState<RateItem[]>([]);
  const [activeProvider, setActiveProvider] = useState<string>('retell');
  const [activeProviderTitle, setActiveProviderTitle] = useState<string>('Retell AI');
  const [markupSettings, setMarkupSettings] = useState<MarkupSettings>({
    markup_type: 'fixed_per_min',
    markup_value: 8.32,
    currency: 'INR',
    tax_rate_percent: 18.0
  });
  const [usageMetrics, setUsageMetrics] = useState({
    total_minutes: 0,
    total_calls: 0,
    total_billed_amount: 0,
    total_actual_cost: 0,
    active_channels: 0,
    max_channels: 20
  });
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [schoolMarkups, setSchoolMarkups] = useState<SchoolMarkupItem[]>([]);
  const [callLedger, setCallLedger] = useState<CallLedgerItem[]>([]);
  const [providerEconomics, setProviderEconomics] = useState<ProviderEconomicsItem[]>([]);
  const [economicsSummary, setEconomicsSummary] = useState<EconomicsSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [editRateValues, setEditRateValues] = useState<Partial<RateItem>>({});
  const [savingRate, setSavingRate] = useState(false);
  const [savingMarkup, setSavingMarkup] = useState(false);

  // ── Editable Wholesale Cost & Selling Price State ─────────────────────────
  const [editingWholesaleProvider, setEditingWholesaleProvider] = useState<string | null>(null);
  const [editWholesaleInr, setEditWholesaleInr] = useState<number>(6.68);
  const [savingWholesale, setSavingWholesale] = useState<boolean>(false);

  const [editingSellingPrice, setEditingSellingPrice] = useState<boolean>(false);
  const [editSellingInr, setEditSellingInr] = useState<number>(15.00);
  const [savingSelling, setSavingSelling] = useState<boolean>(false);

  const handleSaveClientSellingRate = async () => {
    if (editSellingInr <= 0) {
      showToast('Please enter a valid client selling price (> 0)', 'error');
      return;
    }
    setSavingSelling(true);
    try {
      await api.put('/providers/customer-pricing', {
        rate_per_min: Number(editSellingInr)
      });
      showToast(`Updated Client Selling Rate to ₹${editSellingInr.toFixed(2)}/min`, 'success');
      setEditingSellingPrice(false);
      await fetchBillingData();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update client selling rate'), 'error');
    } finally {
      setSavingSelling(false);
    }
  };

  // ── Interactive Live Margin Quotation Studio State ──────────────────────
  const [simProvider, setSimProvider] = useState<string>('retell');
  const [simMode, setSimMode] = useState<'percentage' | 'target_rate'>('target_rate');
  const [simMarkupPercent, setSimMarkupPercent] = useState<number>(124.6);
  const [simTargetClientRate, setSimTargetClientRate] = useState<number>(15.00);
  const [simVolumeMinutes, setSimVolumeMinutes] = useState<number>(5000);
  const [simIncludeGst, setSimIncludeGst] = useState<boolean>(true);
  const [copiedQuote, setCopiedQuote] = useState<boolean>(false);

  // ── School Custom Rate Modal State ──────────────────────────────────────
  const [editingSchool, setEditingSchool] = useState<SchoolMarkupItem | null>(null);
  const [schoolForm, setSchoolForm] = useState({
    markup_type: 'fixed_per_min' as 'percentage' | 'fixed_per_min',
    markup_value: 15.0,
    currency: 'INR',
    tax_rate_percent: 18.0
  });
  const [savingSchool, setSavingSchool] = useState(false);

  // ── Per-Call Cost Adjustment Modal State ────────────────────────────────
  const [editingCallSnapshot, setEditingCallSnapshot] = useState<CallLedgerItem | null>(null);
  const [editCallForm, setEditCallForm] = useState({
    provider_total_cost: 0,
    customer_billable_total: 0,
    adjustment_reason: ''
  });
  const [savingCallCost, setSavingCallCost] = useState(false);

  const user = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  })();
  const userRole = user?.role || 'user';
  const isAdmin = userRole === 'admin' || Boolean(localStorage.getItem('admin_token'));

  // Active Billing Tab
  const [activeTab, setActiveTab] = useState<'economics' | 'quotation' | 'rates' | 'schools' | 'ledger' | 'invoices'>(
    isAdmin ? 'economics' : 'invoices'
  );

  const USD_TO_INR = 83.50;

  const fetchBillingData = async () => {
    setLoading(true);
    try {
      const [resRates, resSchools, resLedger, resEcon] = await Promise.all([
        api.get('/providers/rates'),
        isAdmin ? api.get('/providers/school-markups').catch(() => ({ data: { schools: [] } })) : Promise.resolve({ data: { schools: [] } }),
        isAdmin ? api.get('/providers/call-ledger').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
        isAdmin ? api.get('/providers/economics').catch(() => ({ data: { providers: [], summary: null } })) : Promise.resolve({ data: { providers: [], summary: null } })
      ]);

      if (resRates.data?.current_rates) {
        setRates(resRates.data.current_rates);
      }
      if (resRates.data?.active_provider) {
        setActiveProvider(resRates.data.active_provider);
        setSimProvider(resRates.data.active_provider);
      }
      if (resRates.data?.active_provider_title) {
        setActiveProviderTitle(resRates.data.active_provider_title);
      }
      if (resRates.data?.markup_settings) {
        setMarkupSettings(resRates.data.markup_settings);
      }
      if (resRates.data?.usage_metrics) {
        setUsageMetrics(resRates.data.usage_metrics);
      }
      if (resRates.data?.invoices) {
        setInvoices(resRates.data.invoices);
      }
      if (resSchools.data?.schools) {
        setSchoolMarkups(resSchools.data.schools);
      }
      if (Array.isArray(resLedger.data)) {
        setCallLedger(resLedger.data);
      }
      if (resEcon.data?.providers) {
        setProviderEconomics(resEcon.data.providers);
      }
      if (resEcon.data?.summary) {
        setEconomicsSummary(resEcon.data.summary);
      }
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to load billing data'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBillingData();
  }, []);

  const handleStartEditRate = (rate: RateItem) => {
    setEditingProvider(rate.provider);
    setEditRateValues({ ...rate });
  };

  const handleStartEditWholesale = (provider: string, currentInr: number) => {
    setEditingWholesaleProvider(provider);
    setEditWholesaleInr(Number(currentInr.toFixed(2)));
  };

  const handleSaveWholesaleCost = async (provider: string) => {
    if (editWholesaleInr <= 0) {
      showToast('Please enter a valid wholesale cost (> 0)', 'error');
      return;
    }
    setSavingWholesale(true);
    try {
      await api.put('/providers/rates', {
        provider,
        total_cost_inr_per_min: Number(editWholesaleInr)
      });
      showToast(`Updated Wholesale Cost for ${provider.toUpperCase()} to ₹${editWholesaleInr.toFixed(2)}/min`, 'success');
      setEditingWholesaleProvider(null);
      await fetchBillingData();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update wholesale cost'), 'error');
    } finally {
      setSavingWholesale(false);
    }
  };

  const handleSaveRate = async (provider: string) => {
    setSavingRate(true);
    try {
      await api.put('/providers/rates', {
        provider,
        platform_rate_per_min: Number(editRateValues.platform_rate_per_min || 0),
        telephony_rate_per_min: Number(editRateValues.telephony_rate_per_min || 0),
        stt_rate_per_min: Number(editRateValues.stt_rate_per_min || 0),
        llm_rate_per_min: Number(editRateValues.llm_rate_per_min || 0),
        tts_rate_per_min: Number(editRateValues.tts_rate_per_min || 0),
        currency: editRateValues.currency || 'USD'
      });
      showToast(`Updated rate version for ${provider.toUpperCase()}`, 'success');
      setEditingProvider(null);
      await fetchBillingData();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update rates'), 'error');
    } finally {
      setSavingRate(false);
    }
  };

  const handleSaveMarkup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMarkup(true);
    try {
      await api.put('/providers/markup', markupSettings);
      showToast('SaaS pricing and markup settings saved', 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save markup settings'), 'error');
    } finally {
      setSavingMarkup(false);
    }
  };

  const handleApplySimToPlatform = async () => {
    setSavingMarkup(true);
    try {
      const updatedMarkup = {
        markup_type: 'fixed_per_min',
        markup_value: simTargetClientRate,
        currency: 'INR',
        tax_rate_percent: 18.0
      };
      await api.put('/providers/markup', updatedMarkup);
      setMarkupSettings(updatedMarkup as any);
      showToast(`⚡ Live Platform Client Selling Rate set to ₹${simTargetClientRate.toFixed(2)}/min!`, 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to apply markup settings'), 'error');
    } finally {
      setSavingMarkup(false);
    }
  };

  const handleOpenSchoolEdit = (s: SchoolMarkupItem) => {
    setEditingSchool(s);
    setSchoolForm({
      markup_type: s.markup_type,
      markup_value: s.markup_value,
      currency: s.currency,
      tax_rate_percent: s.tax_rate_percent
    });
  };

  const handleSaveSchoolMarkup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSchool) return;
    setSavingSchool(true);
    try {
      await api.put(`/providers/school-markups/${editingSchool.school_id}`, schoolForm);
      showToast(`Custom rate saved for ${editingSchool.school_name}`, 'success');
      setEditingSchool(null);
      await fetchBillingData();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to save school rate'), 'error');
    } finally {
      setSavingSchool(false);
    }
  };

  const handleResetSchoolMarkup = async (schoolId: string, schoolName: string) => {
    try {
      await api.delete(`/providers/school-markups/${schoolId}`);
      showToast(`Reset ${schoolName} to platform default markup`, 'success');
      await fetchBillingData();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to reset school markup'), 'error');
    }
  };

  // ── Per-Call Cost Handlers ───────────────────────────────────────────────
  const handleOpenEditCall = (item: CallLedgerItem) => {
    setEditingCallSnapshot(item);
    setEditCallForm({
      provider_total_cost: Number((item.provider_total_cost || 0).toFixed(2)),
      customer_billable_total: Number((item.customer_billable_total || 0).toFixed(2)),
      adjustment_reason: ''
    });
  };

  const handleSaveCallCost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCallSnapshot) return;
    setSavingCallCost(true);
    try {
      await api.put(`/providers/call-ledger/${editingCallSnapshot.id}`, editCallForm);
      showToast(`Adjusted costing for call to ${editingCallSnapshot.contact_name}`, 'success');
      setEditingCallSnapshot(null);
      await fetchBillingData();
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to update call cost'), 'error');
    } finally {
      setSavingCallCost(false);
    }
  };

  // ── Computations for the Live Quotation Studio ───────────────────────────
  const simRateObj = rates.find(r => r.provider === simProvider) || rates[0] || {
    platform_rate_per_min: 0.03,
    telephony_rate_per_min: 0.015,
    stt_rate_per_min: 0.005,
    llm_rate_per_min: 0.02,
    tts_rate_per_min: 0.01,
    total_per_min: 0.08
  };

  const currentSimBaseUsd = simRateObj.total_per_min || (
    simRateObj.platform_rate_per_min +
    simRateObj.telephony_rate_per_min +
    simRateObj.stt_rate_per_min +
    simRateObj.llm_rate_per_min +
    simRateObj.tts_rate_per_min
  );
  const currentSimBaseInr = currentSimBaseUsd * USD_TO_INR;

  let calculatedClientRateExclTax = 0;
  let calculatedProfitPerMin = 0;
  let calculatedMarginPercent = 0;
  let calculatedMarkupPercent = 0;

  if (simMode === 'percentage') {
    calculatedProfitPerMin = currentSimBaseInr * (simMarkupPercent / 100.0);
    calculatedClientRateExclTax = currentSimBaseInr + calculatedProfitPerMin;
    calculatedMarkupPercent = simMarkupPercent;
    calculatedMarginPercent = calculatedClientRateExclTax > 0 ? (calculatedProfitPerMin / calculatedClientRateExclTax) * 100.0 : 0;
  } else {
    calculatedClientRateExclTax = simTargetClientRate;
    calculatedProfitPerMin = Math.max(0, simTargetClientRate - currentSimBaseInr);
    calculatedMarginPercent = calculatedClientRateExclTax > 0 ? (calculatedProfitPerMin / calculatedClientRateExclTax) * 100.0 : 0;
    calculatedMarkupPercent = currentSimBaseInr > 0 ? (calculatedProfitPerMin / currentSimBaseInr) * 100.0 : 0;
  }

  const calculatedGstPerMin = simIncludeGst ? calculatedClientRateExclTax * 0.18 : 0;
  const calculatedClientRateInclTax = calculatedClientRateExclTax + calculatedGstPerMin;

  const totalSimRevenue = calculatedClientRateExclTax * simVolumeMinutes;
  const totalSimProfit = calculatedProfitPerMin * simVolumeMinutes;
  const totalSimGst = calculatedGstPerMin * simVolumeMinutes;
  const totalSimInvoice = totalSimRevenue + totalSimGst;

  const simProviderTitle = simProvider === 'retell'
    ? 'Retell AI'
    : simProvider === 'omnidimension'
      ? 'OmniDimension AI'
      : 'Bolna AI';

  const handleCopyProposal = () => {
    const text = `📊 Response AI Admissions CRM - Voice Campaign Quotation\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🏢 Voice Engine: ${simProviderTitle} (Neural Ultra-Low Latency)\n` +
      `⏱️ Campaign Volume: ${simVolumeMinutes.toLocaleString()} Call Minutes\n\n` +
      `💳 Client Calling Rate: ₹${calculatedClientRateExclTax.toFixed(2)} / minute (excl. tax)\n` +
      `🏷️ Client Rate with 18% GST: ₹${calculatedClientRateInclTax.toFixed(2)} / minute\n\n` +
      `✨ Included Capabilities:\n` +
      `  • Multi-Turn Neural Conversational Voice Agent\n` +
      `  • High-Throughput Cloud Carrier Telephony & Instant Dialing\n` +
      `  • Real-Time Lead Qualification & Sentiment Scoring\n` +
      `  • Automated Cal.com & Campus Tour Booking\n\n` +
      `💰 Estimated Campaign Invoice: ₹${totalSimRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` +
      (simIncludeGst ? ` (+ ₹${totalSimGst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GST = ₹${totalSimInvoice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : '') +
      `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    navigator.clipboard.writeText(text);
    setCopiedQuote(true);
    showToast('Copied client quotation proposal to clipboard!', 'success');
    setTimeout(() => setCopiedQuote(false), 2500);
  };

  // ── Overall Profit KPI calculation ──────────────────────────────────────
  const grossProfit = Math.max(0, usageMetrics.total_billed_amount - usageMetrics.total_actual_cost);
  const grossMarginOnSales = usageMetrics.total_billed_amount > 0
    ? ((grossProfit / usageMetrics.total_billed_amount) * 100).toFixed(1)
    : '55.5';
  const markupOnCost = usageMetrics.total_actual_cost > 0
    ? ((grossProfit / usageMetrics.total_actual_cost) * 100).toFixed(1)
    : '124.6';

  return (
    <div className="page-container animate-fade-in" style={{ padding: '28px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Back Navigation Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
        <button
          onClick={() => window.history.length > 1 ? window.history.back() : (window.location.hash = '#dashboard')}
          className="btn btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.8rem', borderRadius: '8px' }}
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>/</span>
        <a href="#dashboard" style={{ color: 'var(--text-muted)', fontSize: '0.82rem', textDecoration: 'none' }}>Dashboard</a>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600 }}>Usage &amp; Billing</span>
      </div>

      {/* Top Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              {isAdmin ? 'Usage, Commercial Pricing & Provider Economics' : 'Usage & Billing Statements'}
            </h1>
            <span style={{
              background: 'rgba(16,185,129,0.12)',
              color: 'var(--accent-primary)',
              border: '1px solid rgba(16,185,129,0.25)',
              padding: '3px 10px',
              borderRadius: '20px',
              fontSize: '0.76rem',
              fontWeight: 700
            }}>
              {isAdmin ? 'Multi-Provider Engine' : 'Standard Rate: ₹15.00/min'}
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '4px', marginBottom: 0 }}>
            {isAdmin
              ? 'Wholesale carrier cost evidence, client pricing margin, multi-engine comparative profitability, and immutable ledger.'
              : 'Real-time connected call minutes, standard billing rate, and official monthly invoice statements.'}
          </p>
        </div>

        <button
          className="btn btn-secondary"
          onClick={fetchBillingData}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', fontSize: '0.85rem' }}
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh Metrics
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SCHOOL CLIENT VIEW: Clean, professional, 100% white-labeled               */}
      {/* ========================================================================= */}
      {!isAdmin ? (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* School Overview Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Current Calling Rate</span>
                <DollarSign size={18} color="var(--accent-primary)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                ₹15.00 <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>/ min</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                + 18% GST (₹17.70 / min total)
              </div>
            </div>

            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Total Connected Minutes</span>
                <Clock size={18} color="var(--accent-cyan)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                {usageMetrics.total_minutes.toLocaleString()} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-muted)' }}>min</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {usageMetrics.total_calls.toLocaleString()} total outbound connected calls
              </div>
            </div>

            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Total Billed Amount</span>
                <CreditCard size={18} color="var(--accent-primary)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                ₹{usageMetrics.total_billed_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Includes all completed campaign dials
              </div>
            </div>

            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Active Channels</span>
                <Layers size={18} color="var(--accent-success)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                {usageMetrics.active_channels} / {usageMetrics.max_channels} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--accent-success)' }}>Slots</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Instant dial capacity
              </div>
            </div>
          </div>

          {/* School Invoices Table */}
          <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileText size={19} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Invoices &amp; Statement History
                </h3>
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Official GST Invoices</span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 14px' }}>Invoice ID</th>
                    <th style={{ padding: '12px 14px' }}>Date</th>
                    <th style={{ padding: '12px 14px' }}>Billing Period</th>
                    <th style={{ padding: '12px 14px' }}>Calls</th>
                    <th style={{ padding: '12px 14px' }}>Total Minutes</th>
                    <th style={{ padding: '12px 14px' }}>Total Amount</th>
                    <th style={{ padding: '12px 14px' }}>Status</th>
                    <th style={{ padding: '12px 14px', textAlign: 'right' }}>Download</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No invoice statements generated yet. Statements generate automatically as outbound admission campaigns run.
                      </td>
                    </tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr key={inv.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>{inv.id}</td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.date}</td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.period}</td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.calls.toLocaleString()}</td>
                        <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.minutes.toLocaleString()} min</td>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>{inv.amount}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(34,197,94,0.12)', color: 'var(--accent-success)' }}>
                            ● {inv.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                          <button
                            className="btn-secondary"
                            onClick={() => showToast(`Downloaded invoice statement ${inv.id}`, 'success')}
                            style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Download size={13} /> PDF
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* PLATFORM ADMIN VIEW: Full Economics, Multi-Provider, Margin Studio        */
        /* ========================================================================= */
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Active Voice Provider Banner */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(16,185,129,0.10) 0%, rgba(6,182,212,0.06) 100%)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '16px',
            padding: '18px 22px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <Activity size={22} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-primary)' }}>
                    Active Voice Engine
                  </span>
                  <span style={{ background: '#10b981', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 800 }}>
                    ACTIVE PRIMARY
                  </span>
                </div>
                <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                  {activeProviderTitle} <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>(Standard Client Rate: ₹15.00/min | Wholesale Cost: ₹6.68/min)</span>
                </div>
              </div>
            </div>

            <a
              href="#providers"
              className="btn btn-primary"
              style={{ padding: '8px 16px', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
            >
              <Edit3 size={14} /> Switch Voice Engine
            </a>
          </div>

          {/* Admin KPI Matrix with Accurate Financial Terms */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px', border: '1px solid rgba(16,185,129,0.3)', background: 'linear-gradient(180deg, rgba(16,185,129,0.05) 0%, var(--bg-card) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--accent-primary)' }}>Gross Profit (Contribution)</span>
                <TrendingUp size={18} color="var(--accent-primary)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--accent-primary)', fontFamily: 'var(--font-display)' }}>
                ₹{grossProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--accent-primary)', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  {grossMarginOnSales}% Gross Margin
                </span>
                <span>({markupOnCost}% Markup on Cost)</span>
              </div>
            </div>

            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Client Revenue (Billed)</span>
                <DollarSign size={18} color="var(--accent-primary)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                ₹{usageMetrics.total_billed_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Standard client rate: <strong>₹15.00 / min</strong>
              </div>
            </div>

            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Wholesale Carrier Cost</span>
                <Clock size={18} color="var(--accent-warning)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                ₹{usageMetrics.total_actual_cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Average base cost: <strong>₹6.68 / min</strong> ($0.080)
              </div>
            </div>

            <div className="card hover-lift" style={{ padding: '20px', borderRadius: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>Unit Economics / Min</span>
                <Activity size={18} color="var(--accent-cyan)" />
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
                +₹8.32 <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--accent-primary)' }}>/ min Profit</span>
              </div>
              <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Revenue ₹15.00 − Cost ₹6.68 = Profit ₹8.32
              </div>
            </div>
          </div>

          {/* Admin Navigation Sub-Tabs */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '24px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveTab('economics')}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'economics' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'economics' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <PieChart size={16} /> Multi-Provider Comparative Economics
            </button>

            <button
              onClick={() => setActiveTab('quotation')}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'quotation' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'quotation' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Calculator size={16} /> Live Cost &amp; Client Quotation Studio
            </button>

            <button
              onClick={() => setActiveTab('rates')}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'rates' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'rates' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <CreditCard size={16} /> Provider Base Rates &amp; SaaS Markup
            </button>

            <button
              onClick={() => setActiveTab('schools')}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'schools' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'schools' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Building size={16} /> Per-School Custom Rate Cards ({schoolMarkups.length})
            </button>

            <button
              onClick={() => setActiveTab('ledger')}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'ledger' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'ledger' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <BarChart3 size={16} /> Real-Time Call Cost Ledger
            </button>

            <button
              onClick={() => setActiveTab('invoices')}
              style={{
                padding: '10px 18px',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === 'invoices' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === 'invoices' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <FileText size={16} /> Invoices &amp; Statements
            </button>
          </div>

          {/* TAB 1: Multi-Provider Comparative Economics */}
          {activeTab === 'economics' && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <PieChart size={20} color="var(--accent-primary)" />
                      <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                        Multi-Provider Comparative Economics
                      </h3>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: '4px', marginBottom: 0 }}>
                      Compare cost structures and discover which voice engine maximizes your gross margin per minute at the standard ₹15.00/min client price.
                    </p>
                  </div>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                        <th style={{ padding: '12px 14px' }}>Voice Engine</th>
                        <th style={{ padding: '12px 14px' }}>Cost Model</th>
                        <th style={{ padding: '12px 14px' }}>Wholesale Cost / Min</th>
                        <th style={{ padding: '12px 14px' }}>Client Selling Price</th>
                        <th style={{ padding: '12px 14px' }}>Profit / Min</th>
                        <th style={{ padding: '12px 14px' }}>Gross Margin on Sales</th>
                        <th style={{ padding: '12px 14px' }}>Markup on Cost</th>
                        <th style={{ padding: '12px 14px', textAlign: 'right' }}>Active Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {providerEconomics.map((p) => {
                        const isActive = p.provider === activeProvider;
                        return (
                          <tr key={p.provider} style={{ borderBottom: '1px solid var(--border-color)', background: isActive ? 'rgba(16,185,129,0.04)' : 'transparent' }}>
                            <td style={{ padding: '14px' }}>
                              <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>{p.provider_name}</strong>
                              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{p.description}</div>
                            </td>
                            <td style={{ padding: '14px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                              {p.provider === 'retell' ? 'Componentized (PSTN+STT+LLM+TTS)' : 'Bundled Platform + Telephony'}
                            </td>
                            <td style={{ padding: '12px 14px' }}>
                              {editingWholesaleProvider === p.provider ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)' }}>₹</span>
                                  <input
                                    type="number"
                                    step="0.05"
                                    min="0.10"
                                    value={editWholesaleInr}
                                    onChange={(e) => setEditWholesaleInr(parseFloat(e.target.value) || 0)}
                                    className="input-field"
                                    style={{ width: '85px', padding: '4px 6px', fontSize: '0.88rem', fontWeight: 800, color: 'var(--accent-primary)' }}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveWholesaleCost(p.provider);
                                      if (e.key === 'Escape') setEditingWholesaleProvider(null);
                                    }}
                                  />
                                  <button
                                    onClick={() => handleSaveWholesaleCost(p.provider)}
                                    disabled={savingWholesale}
                                    className="btn btn-primary"
                                    style={{ padding: '4px 8px', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    title="Save Wholesale Cost"
                                  >
                                    <Save size={12} /> {savingWholesale ? '...' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => setEditingWholesaleProvider(null)}
                                    className="btn btn-secondary"
                                    style={{ padding: '4px 6px', fontSize: '0.74rem' }}
                                    title="Cancel"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                                      ₹{p.cost_per_min.toFixed(2)}/min
                                    </strong>
                                    {isAdmin && (
                                      <button
                                        onClick={() => handleStartEditWholesale(p.provider, p.cost_per_min)}
                                        className="btn-icon hover-scale"
                                        title={`Edit Wholesale Cost for ${p.provider_name}`}
                                        style={{
                                          padding: '3px 6px',
                                          borderRadius: '6px',
                                          border: '1px solid var(--border-color)',
                                          background: 'var(--bg-secondary)',
                                          cursor: 'pointer',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          fontSize: '0.7rem',
                                          color: 'var(--accent-primary)'
                                        }}
                                      >
                                        <Edit3 size={11} /> Edit
                                      </button>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                    ${(p.cost_per_min / USD_TO_INR).toFixed(3)} USD / min
                                  </div>
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '12px 14px' }}>
                              {editingSellingPrice ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--accent-primary)' }}>₹</span>
                                  <input
                                    type="number"
                                    step="0.50"
                                    min="1.00"
                                    value={editSellingInr}
                                    onChange={(e) => setEditSellingInr(parseFloat(e.target.value) || 0)}
                                    className="input-field"
                                    style={{ width: '85px', padding: '4px 6px', fontSize: '0.88rem', fontWeight: 800, color: 'var(--accent-primary)' }}
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveClientSellingRate();
                                      if (e.key === 'Escape') setEditingSellingPrice(false);
                                    }}
                                  />
                                  <button
                                    onClick={handleSaveClientSellingRate}
                                    disabled={savingSelling}
                                    className="btn btn-primary"
                                    style={{ padding: '4px 8px', fontSize: '0.74rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    title="Save Client Selling Rate"
                                  >
                                    <Save size={12} /> {savingSelling ? '...' : 'Save'}
                                  </button>
                                  <button
                                    onClick={() => setEditingSellingPrice(false)}
                                    className="btn btn-secondary"
                                    style={{ padding: '4px 6px', fontSize: '0.74rem' }}
                                    title="Cancel"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.95rem' }}>
                                    ₹{p.revenue_per_min.toFixed(2)}/min
                                  </strong>
                                  {isAdmin && (
                                    <button
                                      onClick={() => {
                                        setEditSellingInr(p.revenue_per_min);
                                        setEditingSellingPrice(true);
                                      }}
                                      className="btn-icon hover-scale"
                                      title="Edit Client Selling Price"
                                      style={{
                                        padding: '3px 6px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color)',
                                        background: 'var(--bg-secondary)',
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '4px',
                                        fontSize: '0.7rem',
                                        color: 'var(--accent-primary)'
                                      }}
                                    >
                                      <Edit3 size={11} /> Edit
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '14px' }}>
                              <span style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--accent-primary)', padding: '3px 8px', borderRadius: '6px', fontWeight: 800, fontSize: '0.85rem' }}>
                                +₹{p.profit_per_min.toFixed(2)}/min
                              </span>
                            </td>
                            <td style={{ padding: '14px', fontWeight: 700, color: 'var(--accent-primary)' }}>
                              {p.gross_margin_percent.toFixed(1)}%
                            </td>
                            <td style={{ padding: '14px', color: 'var(--text-secondary)' }}>
                              {p.markup_on_cost_percent.toFixed(1)}%
                            </td>
                            <td style={{ padding: '14px', textAlign: 'right' }}>
                              {isActive ? (
                                <span style={{ background: '#10b981', color: '#fff', padding: '3px 10px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 800 }}>
                                  ACTIVE ENGINE
                                </span>
                              ) : (
                                <a href="#providers" className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.74rem', textDecoration: 'none' }}>
                                  Switch
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Live Cost & Margin Quotation Studio */}
          {activeTab === 'quotation' && (
            <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div className="card" style={{ padding: '24px', borderRadius: '16px', border: '1px solid rgba(99,102,241,0.2)', background: 'linear-gradient(180deg, rgba(99,102,241,0.03) 0%, var(--bg-card) 100%)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Sparkles size={20} color="var(--accent-primary)" />
                      <h2 style={{ fontSize: '1.3rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                        Live Carrier Cost &amp; Client Quotation Studio
                      </h2>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', marginTop: '4px', marginBottom: 0 }}>
                      Simulate client pricing proposals, customize profit margins per minute, and calculate exact campaign gross profits.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={handleCopyProposal}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '8px 14px' }}
                    >
                      {copiedQuote ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                      {copiedQuote ? 'Copied Quote!' : 'Copy Client Proposal'}
                    </button>

                    <button
                      className="btn btn-primary"
                      onClick={handleApplySimToPlatform}
                      disabled={savingMarkup}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', padding: '8px 14px' }}
                    >
                      <Zap size={14} /> {savingMarkup ? 'Applying...' : 'Apply as Default Platform Markup'}
                    </button>
                  </div>
                </div>

                {/* Provider Selector Tabs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', marginBottom: '24px' }}>
                  {[
                    { id: 'retell', name: 'Retell AI', defaultUsd: 0.080, desc: 'Ultra-low latency Neural Voice' },
                    { id: 'omnidimension', name: 'OmniDimension AI', defaultUsd: 0.067, desc: 'High-concurrency Smart Engine' },
                    { id: 'bolna', name: 'Bolna AI', defaultUsd: 0.060, desc: 'Cost-optimized Regional Engine' }
                  ].map(p => {
                    const isSelected = simProvider === p.id;
                    const r = rates.find(rt => rt.provider === p.id);
                    const rateUsd = r?.total_per_min ?? p.defaultUsd;
                    const costInr = rateUsd * USD_TO_INR;
                    return (
                      <div
                        key={p.id}
                        onClick={() => setSimProvider(p.id)}
                        style={{
                          padding: '14px 16px',
                          borderRadius: '12px',
                          cursor: 'pointer',
                          border: isSelected ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                          background: isSelected ? 'rgba(99,102,241,0.08)' : 'var(--bg-tertiary)',
                          transition: 'var(--transition-smooth)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '0.95rem', color: isSelected ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{p.name}</strong>
                          {p.id === activeProvider && (
                            <span style={{ fontSize: '0.66rem', background: '#10b981', color: '#fff', padding: '2px 6px', borderRadius: '8px', fontWeight: 700 }}>
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{p.desc}</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            Base Cost: <span style={{ color: 'var(--accent-primary)' }}>₹{costInr.toFixed(2)}/min</span> <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>(${rateUsd.toFixed(3)})</span>
                          </div>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEditWholesale(p.id, costInr);
                              }}
                              className="btn-icon hover-scale"
                              title="Edit Wholesale Rate"
                              style={{ padding: '2px 6px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '3px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--accent-primary)', cursor: 'pointer' }}
                            >
                              <Edit3 size={11} /> Edit
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Controls and Preset Pills */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px', marginBottom: '24px', background: 'var(--bg-tertiary)', padding: '20px', borderRadius: '14px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0, fontWeight: 700 }}>
                        Client Selling Rate per Minute (₹)
                      </label>
                      <span style={{ fontSize: '0.74rem', background: 'rgba(16,185,129,0.15)', color: 'var(--accent-primary)', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                        {calculatedMarginPercent.toFixed(1)}% Gross Margin
                      </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                      <span style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--text-primary)' }}>₹</span>
                      <input
                        type="number"
                        step="0.50"
                        min={currentSimBaseInr}
                        value={simTargetClientRate}
                        onChange={(e) => setSimTargetClientRate(parseFloat(e.target.value) || 0)}
                        className="input-field"
                        style={{ width: '100%', padding: '8px 12px', fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent-primary)' }}
                      />
                    </div>

                    {/* Quick Preset Buttons */}
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      {[
                        { val: 10, label: '₹10/min' },
                        { val: 12, label: '₹12/min' },
                        { val: 15, label: '₹15/min ⭐ (Standard)' },
                        { val: 18, label: '₹18/min' },
                        { val: 20, label: '₹20/min' },
                        { val: 25, label: '₹25/min (Enterprise)' }
                      ].map(p => (
                        <button
                          key={p.val}
                          type="button"
                          onClick={() => setSimTargetClientRate(p.val)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '0.74rem',
                            fontWeight: simTargetClientRate === p.val ? 800 : 500,
                            border: simTargetClientRate === p.val ? '2px solid var(--accent-primary)' : '1px solid var(--border-color)',
                            background: simTargetClientRate === p.val ? 'rgba(16,185,129,0.15)' : 'var(--bg-card)',
                            color: simTargetClientRate === p.val ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            cursor: 'pointer'
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', background: 'var(--bg-card)', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <div>Carrier Wholesale Cost: <strong>₹{currentSimBaseInr.toFixed(2)}/min</strong> (${currentSimBaseUsd.toFixed(3)})</div>
                      <div style={{ color: 'var(--accent-primary)', fontWeight: 700, marginTop: '2px' }}>
                        Your Gross Profit: +₹{calculatedProfitPerMin.toFixed(2)}/min ({calculatedMarginPercent.toFixed(1)}% Gross Margin on Sales)
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                      Simulated Campaign Volume: <strong style={{ color: 'var(--text-primary)' }}>{simVolumeMinutes.toLocaleString()} Minutes</strong>
                    </label>
                    <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                      {[1000, 2500, 5000, 10000, 25000, 50000].map(vol => (
                        <button
                          key={vol}
                          type="button"
                          onClick={() => setSimVolumeMinutes(vol)}
                          style={{
                            padding: '4px 10px',
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            fontWeight: simVolumeMinutes === vol ? 700 : 500,
                            border: simVolumeMinutes === vol ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                            background: simVolumeMinutes === vol ? 'rgba(99,102,241,0.15)' : 'var(--bg-card)',
                            color: simVolumeMinutes === vol ? 'var(--accent-primary)' : 'var(--text-secondary)',
                            cursor: 'pointer'
                          }}
                        >
                          {vol.toLocaleString()} min
                        </button>
                      ))}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px' }}>
                      <input
                        type="checkbox"
                        id="gstToggle"
                        checked={simIncludeGst}
                        onChange={(e) => setSimIncludeGst(e.target.checked)}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                      <label htmlFor="gstToggle" style={{ fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
                        Include 18% GST in Client Quotation Proposal
                      </label>
                    </div>
                  </div>
                </div>

                {/* Output Matrix */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Provider Wholesale Cost</span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                      ₹{currentSimBaseInr.toFixed(2)} <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)' }}>/ min</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      (${currentSimBaseUsd.toFixed(3)} USD @ ₹{USD_TO_INR.toFixed(2)})
                    </div>
                  </div>

                  <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '12px', padding: '16px' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--accent-primary)', textTransform: 'uppercase', fontWeight: 700 }}>Your Gross Profit</span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-primary)', marginTop: '4px' }}>
                      +₹{calculatedProfitPerMin.toFixed(2)} <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>/ min</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--accent-primary)', marginTop: '4px', fontWeight: 600 }}>
                      {calculatedMarginPercent.toFixed(1)}% Gross Margin ({calculatedMarkupPercent.toFixed(1)}% Markup)
                    </div>
                  </div>

                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Client Selling Rate</span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                      ₹{calculatedClientRateExclTax.toFixed(2)} <span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-muted)' }}>/ min</span>
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      With 18% GST: <strong>₹{calculatedClientRateInclTax.toFixed(2)}/min</strong>
                    </div>
                  </div>

                  <div style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(16,185,129,0.10) 100%)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '12px', padding: '16px' }}>
                    <span style={{ fontSize: '0.74rem', color: 'var(--accent-primary)', textTransform: 'uppercase', fontWeight: 700 }}>Total Campaign Contribution</span>
                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-primary)', marginTop: '4px' }}>
                      ₹{totalSimProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      Client Invoice: ₹{totalSimInvoice.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Provider Base Rates & SaaS Markup */}
          {activeTab === 'rates' && (
            <div className="animate-fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '24px' }}>
              <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CreditCard size={19} color="var(--accent-primary)" />
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      Provider Base Rates (Per Minute)
                    </h3>
                  </div>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>USD base / min</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {rates.map((r) => {
                    const isEditing = editingProvider === r.provider;
                    const isActive = r.provider === activeProvider;
                    const providerTitle = r.provider === 'retell'
                      ? 'Retell AI'
                      : r.provider === 'omnidimension'
                        ? 'OmniDimension AI'
                        : 'Bolna AI';

                    return (
                      <div
                        key={r.provider}
                        style={{
                          border: isActive ? '2px solid #10b981' : '1px solid var(--border-color)',
                          borderRadius: '14px',
                          padding: '18px',
                          background: isEditing
                            ? 'var(--bg-tertiary)'
                            : isActive
                              ? 'linear-gradient(180deg, rgba(16,185,129,0.06) 0%, var(--bg-card) 100%)'
                              : 'var(--bg-card)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <strong style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{providerTitle}</strong>
                            {isActive && (
                              <span style={{ background: '#10b981', color: '#fff', padding: '2px 9px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 800 }}>
                                ACTIVE
                              </span>
                            )}
                          </div>

                          <div>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button className="btn btn-secondary" onClick={() => setEditingProvider(null)} style={{ padding: '4px 10px', fontSize: '0.76rem' }}>Cancel</button>
                                <button className="btn btn-primary" onClick={() => handleSaveRate(r.provider)} disabled={savingRate} style={{ padding: '4px 12px', fontSize: '0.76rem' }}>Save</button>
                              </div>
                            ) : (
                              <button className="btn btn-secondary" onClick={() => handleStartEditRate(r)} style={{ padding: '4px 10px', fontSize: '0.76rem' }}>Edit Rates</button>
                            )}
                          </div>
                        </div>

                        {isEditing ? (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '0.8rem', marginTop: '12px' }}>
                            <div><label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>Platform</label><input type="number" step="0.001" className="input-field" value={editRateValues.platform_rate_per_min || 0} onChange={(e) => setEditRateValues(prev => ({ ...prev, platform_rate_per_min: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '6px 8px' }} /></div>
                            <div><label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>Telephony</label><input type="number" step="0.001" className="input-field" value={editRateValues.telephony_rate_per_min || 0} onChange={(e) => setEditRateValues(prev => ({ ...prev, telephony_rate_per_min: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '6px 8px' }} /></div>
                            <div><label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>STT</label><input type="number" step="0.001" className="input-field" value={editRateValues.stt_rate_per_min || 0} onChange={(e) => setEditRateValues(prev => ({ ...prev, stt_rate_per_min: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '6px 8px' }} /></div>
                            <div><label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>LLM</label><input type="number" step="0.001" className="input-field" value={editRateValues.llm_rate_per_min || 0} onChange={(e) => setEditRateValues(prev => ({ ...prev, llm_rate_per_min: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '6px 8px' }} /></div>
                            <div><label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.72rem' }}>TTS</label><input type="number" step="0.001" className="input-field" value={editRateValues.tts_rate_per_min || 0} onChange={(e) => setEditRateValues(prev => ({ ...prev, tts_rate_per_min: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '6px 8px' }} /></div>
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', padding: '10px 14px', borderRadius: '10px' }}>
                            <div><span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Platform:</span> <strong>${r.platform_rate_per_min}</strong></div>
                            <div><span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Telephony:</span> <strong>${r.telephony_rate_per_min}</strong></div>
                            <div><span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>AI Suite:</span> <strong>${(r.stt_rate_per_min + r.llm_rate_per_min + r.tts_rate_per_min).toFixed(3)}</strong></div>
                            <div><span style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: '0.72rem' }}>Total Base:</span> <strong>${r.total_per_min}</strong>/m (₹{(r.total_per_min * USD_TO_INR).toFixed(2)})</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Customer SaaS Markup & Tax Settings */}
              <div className="card" style={{ padding: '24px', borderRadius: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <Percent size={19} color="var(--accent-primary)" />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    Standard Client Rate &amp; SaaS Markup
                  </h3>
                </div>

                <form onSubmit={handleSaveMarkup} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      Standard Client Calling Price (₹/min)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={markupSettings.markup_value}
                      onChange={(e) => setMarkupSettings(prev => ({ ...prev, markup_value: parseFloat(e.target.value) || 0 }))}
                      className="input-field"
                      style={{ width: '100%', fontSize: '1.1rem', fontWeight: 800 }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                      Tax Rate (GST %)
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={markupSettings.tax_rate_percent}
                      onChange={(e) => setMarkupSettings(prev => ({ ...prev, tax_rate_percent: parseFloat(e.target.value) || 0 }))}
                      className="input-field"
                      style={{ width: '100%' }}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={savingMarkup}
                    style={{ marginTop: '10px', width: '100%', justifyContent: 'center', padding: '10px 18px', fontSize: '0.88rem' }}
                  >
                    <Save size={15} /> {savingMarkup ? 'Saving...' : 'Save Default Platform Rate'}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 4: Per-School Custom Rate Cards */}
          {activeTab === 'schools' && (
            <div className="card animate-fade-in" style={{ padding: '24px', borderRadius: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Building size={19} color="var(--accent-primary)" />
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      Per-School Client Rate Cards &amp; Custom Markups
                    </h3>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: '4px', marginBottom: 0 }}>
                    Set custom agreed per-minute client rates or specific profit margins for individual institutions.
                  </p>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 14px' }}>School / Tenant</th>
                      <th style={{ padding: '12px 14px' }}>Leads</th>
                      <th style={{ padding: '12px 14px' }}>Pricing Status</th>
                      <th style={{ padding: '12px 14px' }}>Client Selling Rate</th>
                      <th style={{ padding: '12px 14px' }}>Tax (GST)</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schoolMarkups.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          No schools onboarded yet. Onboard a school from Schools Multitenancy to assign custom rate cards.
                        </td>
                      </tr>
                    ) : (
                      schoolMarkups.map((s) => (
                        <tr key={s.school_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(99,102,241,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Building size={16} color="var(--accent-primary)" />
                              </div>
                              <div>
                                <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>{s.school_name}</strong>
                                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{s.school_slug}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{s.lead_count} leads</td>
                          <td style={{ padding: '12px 14px' }}>
                            {s.is_custom ? (
                              <span style={{ background: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)', padding: '3px 8px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 700 }}>
                                Custom Agreement
                              </span>
                            ) : (
                              <span style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', padding: '3px 8px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 600 }}>
                                Standard (₹15.00/min)
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <strong style={{ color: 'var(--accent-primary)', fontSize: '0.92rem' }}>
                              ₹{s.markup_value.toFixed(2)}/min
                            </strong>
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block' }}>
                              (₹{(s.markup_value * 1.18).toFixed(2)} incl. GST)
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{s.tax_rate_percent}% GST</td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <button
                              className="btn btn-secondary"
                              onClick={() => handleOpenSchoolEdit(s)}
                              style={{ padding: '4px 10px', fontSize: '0.76rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Edit3 size={12} /> Custom Rate
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: Real-Time Call Cost Ledger with Cost Source Auditing */}
          {activeTab === 'ledger' && (
            <div className="card animate-fade-in" style={{ padding: '24px', borderRadius: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BarChart3 size={19} color="var(--accent-primary)" />
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                      Real-Time Call Cost &amp; Profit Ledger
                    </h3>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: '4px', marginBottom: 0 }}>
                    Live audit log with exact provider carrier cost, client billable total, profit margin, and cost source verification.
                  </p>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 14px' }}>Date / Time</th>
                      <th style={{ padding: '12px 14px' }}>Contact</th>
                      <th style={{ padding: '12px 14px' }}>School</th>
                      <th style={{ padding: '12px 14px' }}>Provider</th>
                      <th style={{ padding: '12px 14px' }}>Cost Source</th>
                      <th style={{ padding: '12px 14px' }}>Duration</th>
                      <th style={{ padding: '12px 14px' }}>Carrier Base Cost</th>
                      <th style={{ padding: '12px 14px' }}>Client Billable</th>
                      <th style={{ padding: '12px 14px' }}>Your Net Margin</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callLedger.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          No call cost ledger records logged yet. As live outbound calls are placed, immutable billing snapshots will populate here.
                        </td>
                      </tr>
                    ) : (
                      callLedger.map((item) => (
                        <tr key={item.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                            {item.formatted_date}
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.contact_name}</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{item.contact_phone}</div>
                          </td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{item.school_name}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 700, background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)', textTransform: 'uppercase' }}>
                              {item.provider}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px' }}>
                            {item.cost_source === 'provider_actual' ? (
                              <span style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <CheckCircle size={11} /> Actual Data
                              </span>
                            ) : item.cost_source === 'manual_adjustment' ? (
                              <span style={{ background: 'rgba(245,158,11,0.15)', color: '#d97706', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <Edit3 size={11} /> Adjusted
                              </span>
                            ) : (
                              <span style={{ background: 'var(--bg-tertiary)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <AlertCircle size={11} /> Configured Rate
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '12px 14px', fontWeight: 600 }}>{item.duration_formatted}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-muted)' }}>₹{item.provider_total_cost.toFixed(2)}</td>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>₹{item.customer_billable_total.toFixed(2)}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ background: 'rgba(16,185,129,0.15)', color: 'var(--accent-primary)', padding: '3px 8px', borderRadius: '6px', fontWeight: 700, fontSize: '0.8rem' }}>
                              +₹{item.markup_amount.toFixed(2)} ({item.gross_margin_percent.toFixed(1)}%)
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            {isAdmin && (
                              <button
                                className="btn btn-secondary"
                                onClick={() => handleOpenEditCall(item)}
                                style={{ padding: '3px 8px', fontSize: '0.74rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                title="Adjust per-call costing & invoice amount"
                              >
                                <Edit3 size={11} /> Adjust
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: Invoices & Statements */}
          {activeTab === 'invoices' && (
            <div className="card animate-fade-in" style={{ padding: '24px', borderRadius: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={19} color="var(--accent-primary)" />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                    Invoices &amp; Statement History
                  </h3>
                </div>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Historical snapshots immutable</span>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 14px' }}>Invoice ID</th>
                      <th style={{ padding: '12px 14px' }}>Date</th>
                      <th style={{ padding: '12px 14px' }}>Billing Period</th>
                      <th style={{ padding: '12px 14px' }}>Calls</th>
                      <th style={{ padding: '12px 14px' }}>Total Minutes</th>
                      <th style={{ padding: '12px 14px' }}>Total Amount</th>
                      <th style={{ padding: '12px 14px' }}>Status</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>Download</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.length === 0 ? (
                      <tr>
                        <td colSpan={8} style={{ padding: '36px', textAlign: 'center', color: 'var(--text-muted)' }}>
                          No invoice statements generated yet. Statements will generate automatically as outbound admission campaigns run.
                        </td>
                      </tr>
                    ) : (
                      invoices.map((inv) => (
                        <tr key={inv.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={{ padding: '12px 14px', fontWeight: 600, color: 'var(--text-primary)' }}>{inv.id}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.date}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.period}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.calls.toLocaleString()}</td>
                          <td style={{ padding: '12px 14px', color: 'var(--text-secondary)' }}>{inv.minutes.toLocaleString()} min</td>
                          <td style={{ padding: '12px 14px', fontWeight: 700, color: 'var(--text-primary)' }}>{inv.amount}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(34,197,94,0.12)', color: 'var(--accent-success)' }}>
                              ● {inv.status}
                            </span>
                          </td>
                          <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                            <button
                              className="btn-secondary"
                              onClick={() => showToast(`Downloaded invoice statement ${inv.id}`, 'success')}
                              style={{ padding: '5px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <Download size={13} /> PDF
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit School Custom Rate Modal */}
      {editingSchool && (
        <div className="app-modal-backdrop">
          <div className="app-modal-dialog" style={{ maxWidth: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Building size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Custom Rate for {editingSchool.school_name}
                </h3>
              </div>
              <button
                className="btn-icon"
                onClick={() => setEditingSchool(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSchoolMarkup} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Client Selling Rate (₹/min)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={schoolForm.markup_value}
                  onChange={(e) => setSchoolForm(prev => ({ ...prev, markup_value: parseFloat(e.target.value) || 0 }))}
                  className="input-field"
                  style={{ width: '100%', fontSize: '1.1rem', fontWeight: 800 }}
                  required
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Tax Rate (GST %)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={schoolForm.tax_rate_percent}
                  onChange={(e) => setSchoolForm(prev => ({ ...prev, tax_rate_percent: parseFloat(e.target.value) || 0 }))}
                  className="input-field"
                  style={{ width: '100%' }}
                />
              </div>

              <div style={{ background: 'var(--bg-tertiary)', padding: '12px 14px', borderRadius: '10px', fontSize: '0.82rem' }}>
                <div style={{ color: 'var(--text-muted)' }}>Estimated Client Selling Price:</div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent-primary)', marginTop: '2px' }}>
                  ₹{schoolForm.markup_value.toFixed(2)} / min
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: 500, marginLeft: '6px' }}>
                    (₹{(schoolForm.markup_value * 1.18).toFixed(2)} with 18% GST)
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingSchool(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingSchool}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Save size={14} /> {savingSchool ? 'Saving...' : 'Save School Rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Per-Call Cost & Billing Adjustment Modal */}
      {editingCallSnapshot && (
        <div className="app-modal-backdrop">
          <div className="app-modal-dialog" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <DollarSign size={18} color="var(--accent-primary)" />
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  Adjust Cost for Call #{editingCallSnapshot.id.slice(0, 8)}
                </h3>
              </div>
              <button
                className="btn-icon"
                onClick={() => setEditingCallSnapshot(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ background: 'var(--bg-tertiary)', padding: '12px 14px', borderRadius: '10px', fontSize: '0.82rem', marginBottom: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div><strong>Contact:</strong> {editingCallSnapshot.contact_name}</div>
                <div><strong>Phone:</strong> {editingCallSnapshot.contact_phone}</div>
                <div><strong>Duration:</strong> {editingCallSnapshot.duration_formatted}</div>
                <div><strong>Provider:</strong> {editingCallSnapshot.provider.toUpperCase()}</div>
              </div>
            </div>

            <form onSubmit={handleSaveCallCost} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Carrier Wholesale Cost (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editCallForm.provider_total_cost}
                  onChange={(e) => setEditCallForm(prev => ({ ...prev, provider_total_cost: parseFloat(e.target.value) || 0 }))}
                  className="input-field"
                  style={{ width: '100%', fontSize: '1.05rem', fontWeight: 700 }}
                  required
                />
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Base carrier cost incurred for telephony, STT, LLM, and TTS.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Customer Billable Total (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editCallForm.customer_billable_total}
                  onChange={(e) => setEditCallForm(prev => ({ ...prev, customer_billable_total: parseFloat(e.target.value) || 0 }))}
                  className="input-field"
                  style={{ width: '100%', fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-primary)' }}
                  required
                />
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  Final invoice amount billed to the institution/client for this call.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Adjustment Reason (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Carrier rate discount, Dropped call credit, Client promo waiver"
                  value={editCallForm.adjustment_reason}
                  onChange={(e) => setEditCallForm(prev => ({ ...prev, adjustment_reason: e.target.value }))}
                  className="input-field"
                  style={{ width: '100%' }}
                />
              </div>

              {/* Real-time Recalculated Margin Preview */}
              {(() => {
                const profit = Math.max(0, editCallForm.customer_billable_total - editCallForm.provider_total_cost);
                const margin = editCallForm.customer_billable_total > 0 ? (profit / editCallForm.customer_billable_total * 100.0) : 0;
                return (
                  <div style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '10px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', fontWeight: 600, textTransform: 'uppercase' }}>
                      Recalculated Gross Profit
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--accent-primary)', marginTop: '2px' }}>
                      +₹{profit.toFixed(2)}
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, marginLeft: '8px' }}>
                        ({margin.toFixed(1)}% Gross Margin)
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setEditingCallSnapshot(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingCallCost}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Save size={14} /> {savingCallCost ? 'Saving...' : 'Save Call Cost Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
