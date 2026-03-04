"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import React from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/lib/firebase";
import { ref, get } from "firebase/database";
import * as XLSX from "xlsx";

type Summary = {
  fileName: string;
  totalProfitPct: number;
  totalLossPct: number;
  netPnLPct: number;
  winRate: number;
  byDate?: Record<string, number>;
  sortedByDate?: { date: string; pnl: number }[];
};

type SortKey = "netPnL" | "winRate";
type SortOrder = "desc" | "asc";

function AnalysisContent() {
  const searchParams = useSearchParams();
  const analysisId = searchParams.get("analysisId");
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{show: boolean; message: string}>({show: false, message: ''});

  const [sortKey, setSortKey] = useState<SortKey>("netPnL");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    if (!analysisId) {
      setLoading(false);
      return;
    }

    get(ref(db, `analyses/${analysisId}`)).then((snap) => {
      if (snap.exists()) setAnalysis(snap.val());
      setLoading(false);
    });
  }, [analysisId]);

  const summaries: Summary[] = analysis?.summaries || [];

  // ---------- OVERALL METRICS ----------
  const overallNetPnL = summaries.reduce((sum, s) => sum + s.netPnLPct, 0);

  const overallWinRate =
    summaries.length > 0
      ? summaries.reduce((sum, s) => sum + s.winRate, 0) / summaries.length
      : 0;

  // ---------- SORTING ----------
  const sortedSummaries = useMemo(() => {
    return [...summaries].sort((a, b) => {
      const aVal = sortKey === "netPnL" ? a.netPnLPct : a.winRate;
      const bVal = sortKey === "netPnL" ? b.netPnLPct : b.winRate;

      return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [summaries, sortKey, sortOrder]);

  const handleDownloadExcel = () => {
    const fileName = prompt("Enter file name for download:", "strategy-analysis");
    if (!fileName) return;

    // Create header info
    const headerData = [
      ["Strategy:", analysis.strategyName || "Strategy Analysis"],
      ["Dates:", analysis.selectedDates.join(", ")],
      ["Files:", summaries.length],
      [], // Empty row
    ];

    // Create table data
    const tableData = [
      ["File", "Profit %", "Loss %", "Net P&L %", "Win Rate %"],
      ...sortedSummaries.map(s => [
        s.fileName,
        `${s.totalProfitPct.toFixed(2)}%`,
        `${s.totalLossPct.toFixed(2)}%`,
        `${s.netPnLPct.toFixed(2)}%`,
        `${s.winRate.toFixed(2)}%`,
      ])
    ];

    // Combine all data
    const allData = [...headerData, ...tableData];

    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(allData);

    // Set column widths
    ws['!cols'] = [
      { wch: 60 }, // File column
      { wch: 12 }, // Profit %
      { wch: 12 }, // Loss %
      { wch: 12 }, // Net P&L %
      { wch: 12 }, // Win Rate %
    ];

    // Create workbook and download
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Analysis");
    XLSX.writeFile(wb, `${fileName}.xlsx`);
    
    setToast({show: true, message: `✓ Downloaded ${fileName}.xlsx successfully!`});
    setTimeout(() => setToast({show: false, message: ''}), 3000);
  };

  if (loading) return <div className="p-8">Loading analysis...</div>;
  if (!analysis) return <div className="p-8">Analysis not found</div>;

  return (
    <div className="p-8 bg-gray-50 min-h-screen space-y-8">
      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg bg-green-600 text-white font-medium animate-slide-in">
          {toast.message}
        </div>
      )}

      {/* HEADER */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {analysis.strategyName || "Strategy Analysis"}
          </h1>
          <p className="text-sm text-gray-500">
            Dates: {analysis.selectedDates.join(", ")} · Files: {summaries.length}
          </p>
        </div>
        <button
          onClick={handleDownloadExcel}
          className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
        >
          Download Excel
        </button>
      </div>

      {/* OVERALL STATS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Overall Net P&L %" value={overallNetPnL} suffix="%" />
        <StatCard title="Average Win Rate" value={overallWinRate} suffix="%" />
        <StatCard title="Files Compared" value={summaries.length} />
      </div>

      {/* SORT CONTROLS */}
      <div className="flex gap-4 items-center">
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="netPnL">Sort by Net P&L %</option>
          <option value="winRate">Sort by Win Rate</option>
        </select>

        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="border rounded px-3 py-2 text-sm"
        >
          <option value="desc">High → Low</option>
          <option value="asc">Low → High</option>
        </select>
      </div>

      {/* TABLE */}
      <div className="bg-white rounded-xl shadow-sm border">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="p-4 text-sm">File</th>
              <th className="p-4 text-sm">Profit %</th>
              <th className="p-4 text-sm">Loss %</th>
              <th className="p-4 text-sm">Net P&L %</th>
              <th className="p-4 text-sm">Win Rate %</th>
              <th className="p-4 text-sm">Strategy P&L</th>
            </tr>
          </thead>
          <tbody>
            {sortedSummaries.map((s) => (
              <React.Fragment key={s.fileName}>
                <tr className="border-b hover:bg-gray-50">
                  <td className="p-4 font-medium">
                    <span>{s.fileName}</span>
                  </td>

                  <td className="p-4 text-green-600">
                    {s.totalProfitPct.toFixed(2)}%
                  </td>

                  <td className="p-4 text-red-600">
                    {s.totalLossPct.toFixed(2)}%
                  </td>

                  <td
                    className={`p-4 font-semibold ${
                      s.netPnLPct >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {s.netPnLPct.toFixed(2)}%
                  </td>

                  <td className="p-4">{s.winRate.toFixed(2)}%</td>
                  
                  <td className="p-4">
                    {s.byDate && Object.keys(s.byDate).length > 0 && (
                      <button
                        onClick={() => setExpandedRow(expandedRow === s.fileName ? null : s.fileName)}
                        className="text-gray-600 hover:text-gray-800 transition"
                      >
                        {expandedRow === s.fileName ? '▼' : '▶'}
                      </button>
                    )}
                  </td>
                </tr>
                {expandedRow === s.fileName && s.byDate && Object.keys(s.byDate).length > 0 && (
                  <tr className="bg-gray-50">
                    <td colSpan={6} className="p-4">
                      <div className="bg-white rounded-lg border p-4">
                        <h4 className="font-semibold text-gray-700 mb-3">Strategy P&L - Date Order</h4>
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="p-2 text-left">#</th>
                                <th className="p-2 text-left">Date</th>
                                <th className="p-2 text-right">P&L %</th>
                                <th className="p-2 text-center">Result</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analysis.selectedDates.map((date: string, idx: number) => {
                                const pnl = s.byDate?.[date] || 0;
                                return (
                                  <tr key={idx} className="border-b last:border-0">
                                    <td className="p-2 text-gray-500">{idx + 1}</td>
                                    <td className="p-2">{date}</td>
                                    <td className={`p-2 text-right font-medium ${
                                      pnl > 0 ? 'text-green-600' : pnl < 0 ? 'text-red-600' : 'text-gray-600'
                                    }`}>
                                      {pnl.toFixed(2)}%
                                    </td>
                                    <td className="p-2 text-center">
                                      <span className={`px-2 py-1 rounded text-xs ${
                                        pnl > 0 ? 'bg-green-100 text-green-700' : 
                                        pnl < 0 ? 'bg-red-100 text-red-700' : 
                                        'bg-gray-100 text-gray-700'
                                      }`}>
                                        {pnl > 0 ? 'Profit' : pnl < 0 ? 'Loss' : 'No Trade'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  suffix = "",
}: {
  title: string;
  value: number;
  suffix?: string;
}) {
  const color = value < 0 ? "text-red-600" : "text-green-600";

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6">
      <p className="text-sm text-gray-500">{title}</p>
      <p className={`text-2xl font-bold mt-2 ${color}`}>
        {value.toFixed(2)}
        {suffix}
      </p>
    </div>
  );
}

function AnalysisLoading() {
  return <div className="p-8">Loading analysis...</div>;
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<AnalysisLoading />}>
      <AnalysisContent />
    </Suspense>
  );
}
