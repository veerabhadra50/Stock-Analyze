"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { get, ref, set } from "firebase/database";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { v4 as uuidv4 } from "uuid";

import { ArrowUpTrayIcon, DocumentIcon } from "@heroicons/react/24/outline";

type FileItem = {
  id: string;
  file?: File;
  name: string;
  date: string;
  size: string;
  type: string;
  s3Key?: string;
  headers?: string[];
};

type ExistingFileType = {
  id: string;
  fileName: string;
  s3Key: string;
  size: number;
  type: string;
  uploadedAt: string;
  date?: string;
  file?: File;
};
const mapExistingToFileItem = (file: ExistingFileType): FileItem => ({
  id: file.id,
  name: file.fileName,
  s3Key: file.s3Key,
  size: file.size.toString(),
  type: file.type,
  date: file.uploadedAt,
  file: undefined,
  headers: [],
});

export default function UploadPage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [strategyName, setStrategyName] = useState("");

  const [dateColumn, setDateColumn] = useState<string>("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  type DateSelectionMode = "range" | "multiple";
  const [dateMode, setDateMode] = useState<DateSelectionMode>("range");
  const [randomDates, setRandomDates] = useState<Date[]>([]);
  const [rangeView, setRangeView] = useState<"day" | "month" | "year">("day");
  const [multiView, setMultiView] = useState<"day" | "month" | "year">("day");
  const [manualDateInput, setManualDateInput] = useState<string>("");
  const [showBulkDateModal, setShowBulkDateModal] = useState(false);
  const [bulkDateInput, setBulkDateInput] = useState<string>("");
  const [toast, setToast] = useState<{show: boolean; message: string}>({show: false, message: ''});
  const [strategyOptions, setStrategyOptions] = useState<string[]>([]);
  const [strategyMode, setStrategyMode] = useState<"new" | "existing">("new");
  const [selectedStrategy, setSelectedStrategy] = useState<string>(""); // for existing

  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({}); 

  const [existingFiles, setExistingFiles] = useState<ExistingFileType[]>([]);

  useEffect(() => {
    const fetchStrategies = async () => {
      const snapshot = await get(ref(db, "strategies"));
      if (snapshot.exists()) {
        setStrategyOptions(Object.keys(snapshot.val()));
      }
    };

    fetchStrategies();
  }, []);

  useEffect(() => {
    console.log("strategyMode:", strategyMode);
    console.log("selectedStrategy:", selectedStrategy);

    if (strategyMode !== "existing" || !selectedStrategy) {
      setExistingFiles([]);
      return;
    }

    const path = `strategies/${selectedStrategy}/files`;
    console.log("Firebase path:", path);

    const filesRef = ref(db, path);

    get(filesRef).then((snapshot) => {
      console.log("Snapshot exists:", snapshot.exists());
      console.log("Snapshot value:", snapshot.val());

      if (snapshot.exists()) {
        const data = snapshot.val();
        setExistingFiles(
          Object.entries(data).map(([id, f]: any) => ({
            id,
            ...f,
          }))
        );
      } else {
        setExistingFiles([]);
      }
    });
  }, [strategyMode, selectedStrategy]);

  const mapExistingToFileItem = (file: ExistingFileType): FileItem => ({
    id: file.id,
    name: file.fileName,
    s3Key: file.s3Key,
    size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
    type: file.type,
    date: new Date(file.uploadedAt).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    file: undefined,
    headers: [], // will fetch later
  });

  const fetchHeadersForExistingFile = async (file: FileItem) => {
    if (!file.s3Key) return;

    try {
      const fetchedFile = await fetchFileFromS3(file.s3Key, file.name);
      let fileHeaders: string[] = [];

      if (fetchedFile.name.endsWith(".csv")) {
        const text = await fetchedFile.text();
        const parsed = Papa.parse(text, { header: true });
        fileHeaders = parsed.meta.fields || [];
      } else if (fetchedFile.name.endsWith(".xlsx")) {
        const data = await fetchedFile.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
        }) as string[][];
        fileHeaders = json[0] || [];
      }

      setHeaders(fileHeaders); // ✅ populate dropdown
      file.headers = fileHeaders; // update FileItem
    } catch (err) {
      console.error("Failed to fetch headers from S3 file", err);
      alert("Cannot fetch headers from S3 file");
    }
  };

  /* ---------------- FILE UPLOAD ---------------- */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const uploaded: FileItem[] = [];

    for (const file of Array.from(e.target.files)) {
      let fileHeaders: string[] = [];

      // 👇 READ HEADERS PER FILE
      if (file.name.endsWith(".csv")) {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true });
        fileHeaders = parsed.meta.fields || [];
      } else if (file.name.endsWith(".xlsx")) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
        }) as string[][];
        fileHeaders = json[0] || [];
      }

      uploaded.push({
        id: uuidv4(),
        file,
        name: file.name,
        date: new Date().toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
        type: file.type || "Unknown",
        headers: fileHeaders, // ⭐ STORE HEADERS HERE
      });
    }

    setFiles((prev) => [...uploaded, ...prev]);

    // 👇 For dropdown UI only (first file headers)
    if (uploaded[0]) {
      setHeaders(uploaded[0].headers ?? []);
    }
  };

  /* ---------------- MULTI SELECT ---------------- */
  const toggleFileSelection = (file: FileItem) => {
    setSelectedFiles((prev) =>
      prev.some((f) => f.id === file.id)
        ? prev.filter((f) => f.id !== file.id)
        : [...prev, file]
    );
  };

  /* ---------------- HELPER TO GENERATE SELECTED DATES ARRAY ---------------- */
  const generateSelectedDates = (): string[] => {
    if (dateMode === "range") {
      // Range mode logic
      if (!startDate) return [];
      const dates: string[] = [];
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : start;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const day = d.getDate().toString().padStart(2, "0");
        const month = (d.getMonth() + 1).toString().padStart(2, "0");
        const year = d.getFullYear();
        dates.push(`${day}-${month}-${year}`);
      }
      return dates;
    } else {
      // Multiple random dates mode
      return randomDates.map((date) => {
        const day = date.getDate().toString().padStart(2, "0");
        const month = (date.getMonth() + 1).toString().padStart(2, "0");
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
      });
    }
  };

  const calculateStatsFromByDate = (byDate: Record<string, number>) => {
    const entries = Object.entries(byDate);

    const totalDays = entries.length;
    const winDays = entries.filter(([_, pnl]) => pnl > 0).length;

    const winRate =
      totalDays === 0 ? 0 : Number(((winDays / totalDays) * 100).toFixed(2));

    const sortedByDate = entries
      .map(([date, pnl]) => ({ date, pnl }))
      .sort((a, b) => b.pnl - a.pnl); // High → Low

    return { winRate, sortedByDate };
  };

 const resolveDateColumnForFile = async (file: FileItem): Promise<string> => {
  if (!file.headers || file.headers.length === 0) return "";
  
  const normalizedHeaders = file.headers.map(h => h.toLowerCase().trim());
  
  // Comprehensive list of possible date column names
  const dateKeywords = [
    // Exact matches
    'date', 'time', 'datetime', 'timestamp', 'dt',
    // Partial matches
    'exit', 'entry', 'order', 'trade', 'trans',
    // Common abbreviations
    't', 'd', 'td', 'orddt', 'trddt',
    // Excel headers
    'exit date/time', 'entry date/time', 'order datetime'
  ];

  // Priority 1: Check for exact keyword matches
  for (const keyword of dateKeywords) {
    const exactMatch = file.headers.find(h => 
      h.toLowerCase().trim() === keyword
    );
    if (exactMatch) return exactMatch;
  }

  // Priority 2: Check for keywords in header names
  for (const keyword of dateKeywords) {
    const containsMatch = file.headers.find(h => 
      h.toLowerCase().trim().includes(keyword)
    );
    if (containsMatch) return containsMatch;
  }

  // Priority 3: Check common patterns
  // Look for "Date" in any form (case-insensitive)
  const dateMatch = file.headers.find(h => 
    /\bdate\b/i.test(h) || /\btime\b/i.test(h) || /\bdatetime\b/i.test(h)
  );
  if (dateMatch) return dateMatch;

  // Priority 4: Check for columns that might contain dates by position
  // First column is often a date column
  if (normalizedHeaders[0]) {
    // Check if first column name suggests it might be a date
    const firstCol = normalizedHeaders[0];
    if (
      firstCol.includes('col') || 
      firstCol.includes('field') ||
      firstCol.includes('column') ||
      firstCol.length <= 3 || // Short column names like "D", "DT"
      /^[a-d]$/i.test(firstCol) // Single letters A, B, C, D
    ) {
      // First column might be unlabeled date column
      return file.headers[0];
    }
  }

  // Priority 5: Try to peek at the actual data for date-like values
  try {
    let fileContent: string = '';
    
    if (file.file) {
      // For local files
      fileContent = await file.file.text();
    } else if (file.s3Key) {
      // For S3 files, we need to fetch a sample
      try {
        const fetchedFile = await fetchFileFromS3(file.s3Key, file.name);
        const blobSlice = fetchedFile.slice(0, 10000); // First 10KB
        fileContent = await blobSlice.text();
      } catch (s3Error) {
        console.log("Could not fetch from S3 for date detection:", s3Error);
        return "";
      }
    }
    
    if (fileContent) {
      const firstLine = fileContent.split('\n')[0]; // Headers
      const secondLine = fileContent.split('\n')[1]; // First data row
      
      if (secondLine) {
        const headers = firstLine.split(',');
        const values = secondLine.split(',').map(v => v.trim());
        
        for (let i = 0; i < values.length; i++) {
          const value = values[i];
          // Check if value looks like a date
          if (value && (
            /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(value) || // DD/MM/YY or similar
            /^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}$/.test(value) || // YYYY-MM-DD
            /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/.test(value) || // 01 Jan 2024
            /^\d{1,2}:[0-5]\d(:[0-5]\d)?\s*(am|pm)?$/i.test(value) || // Time
            (value.includes('/') && value.length >= 8) || 
            (value.includes('-') && value.length >= 8) ||
            (value.includes('.') && value.length >= 8)
          )) {
            return headers[i] || `Column ${i + 1}`;
          }
        }
      }
    }
  } catch (e) {
    console.log("Could not sample file data for date detection", e);
  }

  // Last resort: Return empty string
  console.warn(`No date column detected for ${file.name}. Headers:`, file.headers);
  return "";
};
  const normalizeDate = (value: any): string | null => {
    if (!value) return null;

    // Excel serial number
    if (typeof value === "number") {
      const date = XLSX.SSF.parse_date_code(value);
      if (!date) return null;
      return `${String(date.d).padStart(2, "0")}-${String(date.m).padStart(
        2,
        "0"
      )}-${date.y}`;
    }

    const cleaned = value.toString().split(" ")[0];

    const parts = cleaned.includes("/")
      ? cleaned.split("/")
      : cleaned.split("-");

    if (parts.length !== 3) return null;

    let day, month, year;

    // yyyy-mm-dd
    if (parts[0].length === 4) {
      year = parts[0];
      month = parts[1];
      day = parts[2];
    } else {
      day = parts[0];
      month = parts[1];
      year = parts[2];
    }

    return `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
  };

  const parseCSV = (file: File, dateCol: string, selectedDates: string[]) =>
    new Promise<{
      totalProfitPct: number;
      totalLossPct: number;
      netPnLPct: number;
      byDate: Record<string, number>;
      winRate: number;
      sortedByDate: { date: string; pnl: number }[];
    }>((resolve) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          let totalProfitPct = 0;
          let totalLossPct = 0;
          let totalTrades = 0;
          let winningTrades = 0;

          const byDate: Record<string, number> = {};

          results.data.forEach((row: any) => {
            // Skip if Type column exists and is not "exit"
            if (row["Type"] && !row["Type"]?.toLowerCase().includes("exit")) return;

            const dateOnly = normalizeDate(row[dateCol]);
            if (!dateOnly || !selectedDates.includes(dateOnly)) return;

            const pnlKey = Object.keys(row).find(
              (k) => k.toLowerCase().includes("net") && k.includes("%")
            );

            const pnlPct = pnlKey ? parseFloat(row[pnlKey]) || 0 : 0;

            // Track trade outcomes for win rate
            totalTrades++;
            if (pnlPct > 0) {
              winningTrades++;
              totalProfitPct += pnlPct;
            } else {
              totalLossPct += pnlPct;
            }

            byDate[dateOnly] = (byDate[dateOnly] || 0) + pnlPct;
          });

          const { winRate, sortedByDate } = calculateStatsFromByDate(byDate);

          resolve({
            totalProfitPct,
            totalLossPct,
            netPnLPct: totalProfitPct + totalLossPct,
            byDate,
            winRate, // ✅ day-based win rate
            sortedByDate,
          });

          resolve({
            totalProfitPct,
            totalLossPct,
            netPnLPct: totalProfitPct + totalLossPct,
            byDate,
            winRate, // ✅ Correct win rate based on individual trades
            sortedByDate,
          });
        },
        error: () =>
          resolve({
            totalProfitPct: 0,
            totalLossPct: 0,
            netPnLPct: 0,
            byDate: {},
            winRate: 0,
            sortedByDate: [],
          }),
      });
    });

  const parseXLSX = async (
    file: File,
    dateCol: string,
    selectedDates: string[]
  ) => {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet) as any[];

    let totalProfitPct = 0;
    let totalLossPct = 0;
    let totalTrades = 0;
    let winningTrades = 0;
    const byDate: Record<string, number> = {};

    json.forEach((row) => {
      // Skip if Type column exists and is not "exit"
      if (row["Type"] && !row["Type"]?.toLowerCase().includes("exit")) return;

      const dateOnly = normalizeDate(row[dateCol]);
      if (!dateOnly || !selectedDates.includes(dateOnly)) return;

      // Try to find Net P&L % column
      const pnlKey = Object.keys(row).find(
        (k) => k.toLowerCase().includes("net") && k.includes("%")
      );
      const pnlPct = pnlKey ? parseFloat(row[pnlKey]) || 0 : 0;

      // Track trade outcomes for win rate
      totalTrades++;
      if (pnlPct > 0) {
        winningTrades++;
        totalProfitPct += pnlPct;
      } else {
        totalLossPct += pnlPct;
      }

      byDate[dateOnly] = (byDate[dateOnly] || 0) + pnlPct;
    });

    // Calculate win rate based on trades
    // const winRate =
    //   totalTrades === 0
    //     ? 0
    //     : Number(((winningTrades / totalTrades) * 100).toFixed(2));
    const { winRate, sortedByDate } = calculateStatsFromByDate(byDate);

    return {
      totalProfitPct,
      totalLossPct,
      netPnLPct: totalProfitPct + totalLossPct,
      byDate,
      winRate, // ✅ Correct win rate
      sortedByDate,
    };
  };
  //upload to S3 function
  const uploadFileToS3 = async (
    file: File,
    strategyName: string
  ): Promise<{ s3Key: string; fileId: string }> => {
    // 1️⃣ Ask backend for signed URL
    const res = await fetch("/api/s3/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        strategyName,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to get signed URL");
    }

    const { uploadUrl, s3Key, fileId } = await res.json();

    // 2️⃣ Upload file directly to S3
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: {
        "Content-Type": file.type,
      },
    });

    if (!uploadRes.ok) {
      throw new Error("S3 upload failed");
    }

    return { s3Key, fileId };
  };

  async function fetchFileFromS3(
    s3Key: string,
    fileName: string
  ): Promise<File> {
    const res = await fetch("/api/s3/download", {
      method: "POST", // ✅ use POST
      headers: { "Content-Type": "application/json" }, // ✅ JSON body
      body: JSON.stringify({ s3Key }), // ✅ send s3Key in body
    });

    if (!res.ok) throw new Error("Failed to fetch file from S3");

    const blob = await res.blob();
    return new File([blob], fileName, { type: blob.type });
  }

  /* ---------------- ANALYZE ---------------- */
  const analyzeSelectedFiles = async () => {
    if (!dateColumn) return alert("Please select the Date column.");

    const datesArr = generateSelectedDates();
    if (datesArr.length === 0)
      return alert("Please select at least one date or range.");

    const validFiles = selectedFiles.filter((f) => f.file || f.s3Key);
    if (validFiles.length === 0)
      return alert("Selected files are no longer available.");

    const analysisId = `analysis_${Date.now()}`;
    const createdAt = new Date().toISOString();

    const summaries = await Promise.all(
      validFiles.map(async (fileItem, index) => {
        let fileToAnalyze: File;

        if (fileItem.file) {
          fileToAnalyze = fileItem.file;
        } else if (fileItem.s3Key) {
          fileToAnalyze = await fetchFileFromS3(fileItem.s3Key, fileItem.name);
        } else {
          throw new Error("No file source available");
        }

        let summaryData;
        const fileDateColumn = await resolveDateColumnForFile(fileItem);

        if (!fileDateColumn) {
          console.warn(`No date column found for ${fileItem.name}`);
          return {
            fileName: fileItem.name,
            analysisId: `${analysisId}_${index + 1}`,
            createdAt,
            totalProfitPct: 0,
            totalLossPct: 0,
            netPnLPct: 0,
            byDate: {},
            winRate: 0,
            sortedByDate: [],
          };
        }

        if (fileItem.name.endsWith(".csv")) {
          summaryData = await parseCSV(fileToAnalyze, fileDateColumn, datesArr);
        } else if (fileItem.name.endsWith(".xlsx")) {
          summaryData = await parseXLSX(
            fileToAnalyze,
            fileDateColumn,
            datesArr
          );
        } else {
          summaryData = {
            totalProfitPct: 0,
            totalLossPct: 0,
            netPnLPct: 0,
            winRate: 0,
            byDate: {},
          };
        }

        return {
          fileName: fileItem.name,
          analysisId: `${analysisId}_${index + 1}`,
          createdAt,
          ...summaryData,
        };
      })
    );

    await set(ref(db, `analyses/${analysisId}`), {
      createdAt,
      strategyName,
      dateColumn,
      selectedDates: datesArr,
      summaries,
    });

    setSelectedFiles([]);
    router.push(`/analysis?analysisId=${analysisId}`);
  };

  const allSelected = files.length > 0 && selectedFiles.length === files.length;

  const isIndeterminate =
    selectedFiles.length > 0 && selectedFiles.length < files.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedFiles([]);
      setSelectedFileIds([]);
    } else {
      setSelectedFiles(files.map((f) => ({ ...f })));
      setSelectedFileIds(files.map((f) => f.id));
    }
  };

  const handleExistingFileToggle = async (file: ExistingFileType) => {
    const exists = selectedFileIds.includes(file.id);

    if (exists) {
      setSelectedFileIds((prev) => prev.filter((id) => id !== file.id));
      setSelectedFiles((prev) => prev.filter((f) => f.id !== file.id));
    } else {
      const mapped = mapExistingToFileItem(file);
      setSelectedFileIds((prev) => [...prev, file.id]);
      setSelectedFiles((prev) => [...prev, mapped]);

      // ✅ Fetch headers only for first selected file
      
        await fetchHeadersForExistingFile(mapped);
      
    }
  };

  //delete file from list
  const deleteExistingFile = async (fileId: string, s3Key: string) => {
  if (!confirm("Are you sure you want to delete this file permanently?")) {
    return;
  }

  try {
    // 1. Delete from Firebase
    await set(ref(db, `strategies/${selectedStrategy}/files/${fileId}`), null);
    
    // 2. Delete from S3
    const res = await fetch("/api/s3/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s3Key }),
    });

    // ADD ERROR DETAILS
    if (!res.ok) {
      const errorText = await res.text();
      console.error("S3 Delete error details:", {
        status: res.status,
        error: errorText,
        s3Key: s3Key
      });
      throw new Error(`Failed to delete from S3: ${res.status} - ${errorText}`);
    }

    // 3. Remove from local state
    setExistingFiles(prev => prev.filter(f => f.id !== fileId));
    setSelectedFiles(prev => prev.filter(f => f.id !== fileId));
    setSelectedFileIds(prev => prev.filter(id => id !== fileId));
    
    alert("File deleted successfully!");
  } catch (error) {
    console.error("Delete error:", error);
    alert(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* Toast Notification */}
      {toast.show && (
        <div className="fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg bg-green-600 text-white font-medium animate-slide-in">
          {toast.message}
        </div>
      )}

      {/* Bulk Date Input Modal */}
      {showBulkDateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-3">Bulk Add Dates</h3>
            <p className="text-sm text-gray-600 mb-3">
              Enter dates (one per line or comma-separated):
              <br />
              Format: DD/MM/YYYY or DD-MM-YYYY
            </p>
            <textarea
              value={bulkDateInput}
              onChange={(e) => setBulkDateInput(e.target.value)}
              placeholder="12/02/2026&#10;13/03/2026&#10;14-04-2026"
              className="border rounded px-3 py-2 w-full h-40 text-sm"
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => {
                  const input = bulkDateInput.trim();
                  if (!input) {
                    alert('Please enter at least one date');
                    return;
                  }
                  
                  const lines = input.split(/[\n,]+/).map(l => l.trim()).filter(l => l);
                  const newDates: Date[] = [];
                  const errors: string[] = [];
                  
                  lines.forEach((line, idx) => {
                    const parts = line.includes('/') ? line.split('/') : line.split('-');
                    if (parts.length !== 3) {
                      errors.push(`Line ${idx + 1} (${line}): Invalid format`);
                      return;
                    }
                    
                    const day = parseInt(parts[0]);
                    const month = parseInt(parts[1]) - 1;
                    const year = parseInt(parts[2]);
                    
                    if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 0 || month > 11 || year < 1900) {
                      errors.push(`Line ${idx + 1} (${line}): Invalid date values`);
                      return;
                    }
                    
                    const newDate = new Date(year, month, day);
                    if (!randomDates.some(d => d.toDateString() === newDate.toDateString()) &&
                        !newDates.some(d => d.toDateString() === newDate.toDateString())) {
                      newDates.push(newDate);
                    }
                  });
                  
                  if (errors.length > 0 && newDates.length === 0) {
                    alert('All dates have errors:\n' + errors.join('\n'));
                    return;
                  }
                  
                  if (newDates.length > 0) {
                    setRandomDates(prev => [...prev, ...newDates]);
                    setBulkDateInput('');
                    setShowBulkDateModal(false);
                    setToast({show: true, message: `✓ Successfully added ${newDates.length} date(s)!${errors.length > 0 ? ` Skipped ${errors.length} invalid.` : ''}`});
                    setTimeout(() => setToast({show: false, message: ''}), 3000);
                  } else {
                    alert('No new dates to add (all dates already selected or invalid)');
                  }
                }}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              >
                Add Dates
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowBulkDateModal(false);
                  setBulkDateInput('');
                }}
                className="flex-1 bg-gray-300 text-gray-700 px-4 py-2 rounded hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Upload Files</h1>
          <p className="text-gray-500 text-sm">
            Upload CSV/XLSX files with Net P&L INR column
          </p>
        </div>
        <label className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 transition cursor-pointer">
          <ArrowUpTrayIcon className="w-5 h-5" />
          Upload file
          <input
            type="file"
            multiple
            accept=".csv,.xlsx"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* LEFT COLUMN: Date Selection */}
        <div className="space-y-4">
          {/* Date Column Selection */}
          {headers.length > 0 && (
            <div className="bg-white p-4 rounded-lg border">
              <label className="text-gray-700 font-medium block mb-2">
                Select Date/Time Column:
              </label>
              <select
                value={dateColumn}
                onChange={(e) => setDateColumn(e.target.value)}
                className="border rounded px-3 py-2 w-full"
              >
                <option value="">--Select--</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date Mode Selection */}
          {dateColumn && (
            <div className="bg-white p-4 rounded-lg border">
              <label className="text-gray-700 font-medium mb-2 block">
                Date Selection Mode:
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDateMode("range")}
                  className={`px-4 py-2 rounded-lg transition ${
                    dateMode === "range"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Date Range
                </button>
                <button
                  type="button"
                  onClick={() => setDateMode("multiple")}
                  className={`px-4 py-2 rounded-lg transition ${
                    dateMode === "multiple"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Multiple Random Dates
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDateMode("multiple");
                    setShowBulkDateModal(true);
                  }}
                  className={`px-4 py-2 rounded-lg transition ${
                    showBulkDateModal
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  Bulk Add Dates
                </button>
              </div>
            </div>
          )}

          {/* Modern Date Picker */}
          {dateColumn && (
            <div className="bg-white p-4 rounded-lg border">
              <label className="text-gray-700 font-medium mb-1 block">
                Select Date(s) for Analysis:
              </label>

              {dateMode === "range" ? (
                // Range mode (existing)
                <div>
                  <DatePicker
                    selected={startDate}
                    onChange={(
                      dates: [Date | null, Date | null] | Date | null,
                    ) => {
                      if (!dates) {
                        setStartDate(null);
                        setEndDate(null);
                        return;
                      }
                      if (Array.isArray(dates)) {
                        const [start, end] = dates;
                        setStartDate(start || null);
                        setEndDate(end || null);
                      } else setStartDate(dates);
                    }}
                    startDate={startDate}
                    endDate={endDate}
                    selectsRange
                    isClearable
                    placeholderText="Select date range"
                    className="border rounded px-3 py-2 w-full"
                    inline
                    showMonthYearPicker={rangeView === "month"}
                    showYearPicker={rangeView === "year"}
                    onMonthChange={() => setRangeView("day")}
                    onYearChange={() => setRangeView("month")}
                    renderCustomHeader={({
                      date,
                      decreaseMonth,
                      increaseMonth,
                      decreaseYear,
                      increaseYear,
                    }) => (
                      <div className="flex items-center justify-between px-2 py-2">
                        <button
                          onClick={rangeView === "year" ? decreaseYear : decreaseMonth}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          ←
                        </button>
                        <button
                          onClick={() => {
                            if (rangeView === "day") setRangeView("month");
                            else if (rangeView === "month") setRangeView("year");
                            else setRangeView("day");
                          }}
                          className="font-semibold hover:bg-gray-100 px-3 py-1 rounded"
                        >
                          {rangeView === "day" && date.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                          {rangeView === "month" && date.getFullYear()}
                          {rangeView === "year" && `${date.getFullYear() - 5} - ${date.getFullYear() + 6}`}
                        </button>
                        <button
                          onClick={rangeView === "year" ? increaseYear : increaseMonth}
                          className="p-1 hover:bg-gray-100 rounded"
                        >
                          →
                        </button>
                      </div>
                    )}
                  />
                  {startDate && !endDate && (
                    <p className="text-sm text-gray-500 mt-1">
                      Single date selected: {startDate.toLocaleDateString()}
                    </p>
                  )}
                </div>
              ) : (
                // Multiple random dates mode
                <div className="space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    <div className="lg:w-1/2">
                      <DatePicker
                        selected={null}
                        onChange={(date: Date | null) => {
                          if (
                            date &&
                            multiView === "day" &&
                            !randomDates.some(
                              (d) => d.toDateString() === date.toDateString(),
                            )
                          ) {
                            setRandomDates((prev) => [...prev, date]);
                          }
                        }}
                        placeholderText="Click to pick a date"
                        className="border rounded px-3 py-2 w-full"
                        inline
                        showMonthYearPicker={multiView === "month"}
                        showYearPicker={multiView === "year"}
                        onMonthChange={(date) => {
                          setMultiView("day");
                        }}
                        onYearChange={(date) => {
                          setMultiView("month");
                        }}
                        renderCustomHeader={({
                          date,
                          decreaseMonth,
                          increaseMonth,
                          decreaseYear,
                          increaseYear,
                        }) => (
                          <div className="flex items-center justify-between px-2 py-2">
                            <button
                              onClick={multiView === "year" ? decreaseYear : decreaseMonth}
                              className="p-1 hover:bg-gray-100 rounded"
                            >
                              ←
                            </button>
                            <button
                              onClick={() => {
                                if (multiView === "day") setMultiView("month");
                                else if (multiView === "month") setMultiView("year");
                                else setMultiView("day");
                              }}
                              className="font-semibold hover:bg-gray-100 px-3 py-1 rounded"
                            >
                              {multiView === "day" && date.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                              {multiView === "month" && date.getFullYear()}
                              {multiView === "year" && `${date.getFullYear() - 5} - ${date.getFullYear() + 6}`}
                            </button>
                            <button
                              onClick={multiView === "year" ? increaseYear : increaseMonth}
                              className="p-1 hover:bg-gray-100 rounded"
                            >
                              →
                            </button>
                          </div>
                        )}
                      />
                    </div>

                    <div className="lg:w-1/2">
                      <div className="mb-3">
                        <p className="text-sm text-gray-600 mb-2">
                          Click dates on calendar to add them
                        </p>
                        <div className="flex gap-2 mb-3">
                          <input
                            type="text"
                            value={manualDateInput}
                            onChange={(e) => setManualDateInput(e.target.value)}
                            placeholder="DD-MM-YYYY or DD/MM/YYYY"
                            className="border rounded px-3 py-1.5 text-sm flex-1"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const input = manualDateInput.trim();
                              if (!input) return;
                              
                              const parts = input.includes('/') ? input.split('/') : input.split('-');
                              if (parts.length !== 3) {
                                alert('Invalid format. Use DD-MM-YYYY or DD/MM/YYYY');
                                return;
                              }
                              
                              const day = parseInt(parts[0]);
                              const month = parseInt(parts[1]) - 1;
                              const year = parseInt(parts[2]);
                              
                              if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 0 || month > 11) {
                                alert('Invalid date values');
                                return;
                              }
                              
                              const newDate = new Date(year, month, day);
                              if (!randomDates.some(d => d.toDateString() === newDate.toDateString())) {
                                setRandomDates(prev => [...prev, newDate]);
                                setManualDateInput('');
                              }
                            }}
                            className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm hover:bg-blue-700"
                          >
                            Add
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRandomDates([])}
                          className="text-sm text-red-600 hover:text-red-700"
                        >
                          Clear All Dates
                        </button>
                      </div>

                      {/* Display selected dates */}
                      {randomDates.length > 0 ? (
                        <div className="border rounded p-3 bg-gray-50 max-h-40 overflow-y-auto">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">
                            Selected Dates ({randomDates.length}):
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {randomDates
                              .sort((a, b) => a.getTime() - b.getTime())
                              .map((date, index) => (
                                <div
                                  key={index}
                                  className="flex items-center gap-1 bg-white border rounded px-3 py-1 text-sm"
                                >
                                  <span>{date.toLocaleDateString()}</span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRandomDates((prev) =>
                                        prev.filter((_, i) => i !== index),
                                      )
                                    }
                                    className="ml-1 text-gray-400 hover:text-red-500"
                                  >
                                    ×
                                  </button>
                                </div>
                              ))}
                          </div>
                        </div>
                      ) : (
                        <div className="border rounded p-4 text-center text-gray-400 bg-gray-50">
                          No dates selected yet
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* RIGHT COLUMN: Strategy Section */}
        <div className="space-y-4">
          {/* Strategy Selection Section */}
          <div className="bg-white p-4 rounded-lg border">
            <label className="block text-gray-700 font-medium mb-2">
              Strategy Mode
            </label>
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setStrategyMode("new")}
                className={`px-4 py-2 rounded-lg transition ${
                  strategyMode === "new"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                New Strategy
              </button>
              <button
                type="button"
                onClick={() => setStrategyMode("existing")}
                className={`px-4 py-2 rounded-lg transition ${
                  strategyMode === "existing"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                }`}
              >
                Existing Strategy
              </button>
            </div>

            {/* Strategy Name Input OR Existing Strategy Dropdown */}
            {strategyMode === "new" ? (
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  New Strategy Name
                </label>
                <input
                  type="text"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  placeholder="Enter new strategy name (e.g., Intraday Scalping)"
                  className="border rounded px-3 py-2 w-full"
                />
                <p className="text-sm text-gray-500 mt-1">
                  Enter a name for your new strategy and upload files to it
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-gray-700 font-medium mb-1">
                  Select Existing Strategy
                </label>
                <select
                  value={selectedStrategy}
                  onChange={(e) => setSelectedStrategy(e.target.value)}
                  className="border rounded px-3 py-2 w-full"
                >
                  <option value="">--Select Strategy--</option>
                  {strategyOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <p className="text-sm text-gray-500 mt-1">
                  Select an existing strategy to upload new files or analyze
                  existing ones
                </p>
              </div>
            )}
          </div>

          {/* Existing Files Table (only when existing strategy is selected) */}
          {strategyMode === "existing" && selectedStrategy && (
            <div className="bg-white rounded-lg border">
              <div className="p-4 border-b bg-gray-50">
                <h3 className="text-lg font-semibold">
                  Existing Files in Strategy: {selectedStrategy}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Select files to include in analysis
                </p>
                {/* ADD THIS SELECT ALL CHECKBOX */}
                <div className="flex items-center gap-2 mt-3">
                  <input
                    type="checkbox"
                    id="selectAllExisting"
                    checked={
                      selectedFileIds.length === existingFiles.length &&
                      existingFiles.length > 0
                    }
                    onChange={async (e) => {
                      if (e.target.checked) {
                        // Select all files
                        const allIds = existingFiles.map((f) => f.id);
                        const allMappedFiles = existingFiles.map(
                          mapExistingToFileItem,
                        );
                        setSelectedFileIds(allIds);
                        setSelectedFiles((prev) => {
                          // Combine with existing selected files, avoiding duplicates
                          const newFiles = allMappedFiles.filter(
                            (newFile) => !prev.some((p) => p.id === newFile.id),
                          );
                          return [...prev, ...newFiles];
                        });

                        // ADD THIS: Fetch headers for all newly selected files
                        for (const file of allMappedFiles) {
                          await fetchHeadersForExistingFile(file);
                        }
                      } else {
                        // Deselect all files from this strategy
                        const idsToRemove = existingFiles.map((f) => f.id);
                        setSelectedFileIds((prev) =>
                          prev.filter((id) => !idsToRemove.includes(id)),
                        );
                        setSelectedFiles((prev) =>
                          prev.filter((f) => !idsToRemove.includes(f.id)),
                        );
                      }
                    }}
                    className="w-4 h-4 accent-purple-600"
                  />
                  <label
                    htmlFor="selectAllExisting"
                    className="text-sm font-medium text-gray-700"
                  >
                    Select All ({existingFiles.length} files)
                  </label>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b sticky top-0">
                    <tr>
                      <th className="p-3 text-left">Select</th>
                      <th className="p-3 text-left">File Name</th>
                      <th className="p-3 text-left">Uploaded At</th>
                      <th className="p-3 text-left">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {existingFiles.map((file) => (
                      <tr key={file.id} className="border-b hover:bg-gray-50">
                        <td className="p-3">
                          <input
                            type="checkbox"
                            checked={selectedFileIds.includes(file.id)}
                            onChange={() => handleExistingFileToggle(file)}
                            className="w-4 h-4 accent-purple-600"
                          />
                        </td>
                        <td className="p-3 text-sm">{file.fileName}</td>
                        <td className="p-3 text-sm text-gray-500">
                          {new Date(file.uploadedAt).toLocaleDateString()}
                        </td>
                        <td className="p-3">
                          {" "}
                          {/* ADD THIS */}
                          <button
                            onClick={() =>
                              deleteExistingFile(file.id, file.s3Key)
                            }
                            className="text-red-600 hover:text-red-800 text-sm px-3 py-1 bg-red-50 hover:bg-red-100 rounded transition"
                            title="Delete file permanently"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {existingFiles.length === 0 && (
                <div className="p-8 text-center">
                  <DocumentIcon className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <h4 className="text-gray-500 font-medium">
                    No files in this strategy
                  </h4>
                  <p className="text-sm text-gray-400 mt-1 mb-4">
                    Upload new files using the file upload button above
                  </p>
                  <label className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition cursor-pointer">
                    <ArrowUpTrayIcon className="w-4 h-4" />
                    Upload New Files
                    <input
                      type="file"
                      multiple
                      accept=".csv,.xlsx"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Analyze Button */}
          {selectedFiles.length > 0 &&
            dateColumn &&
            ((dateMode === "range" && startDate) ||
              (dateMode === "multiple" && randomDates.length > 0)) && (
              <div className="flex justify-end">
                <button
                  onClick={analyzeSelectedFiles}
                  className="bg-green-600 text-white px-5 py-2 rounded-lg hover:bg-green-700 transition"
                >
                  Analyze Selected ({selectedFiles.length})
                </button>
              </div>
            )}
        </div>
      </div>

      {/* Uploaded Files Table - Full Width at Bottom */}
      <div className="bg-white rounded-xl shadow-sm border">
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold">Uploaded Files</h3>
            <p className="text-sm text-gray-500 mt-1">
              Select files to include in analysis
            </p>
          </div>

          <button
            onClick={async () => {
              // 1. Get ALL local files that are SELECTEDN
              const localFilesToUpload = files.filter(
                (f) => f.file && selectedFiles.some((sf) => sf.id === f.id),
              );

              if (localFilesToUpload.length === 0) {
                alert("Please select at least one file to upload");
                return;
              }

              const finalStrategyName =
                strategyMode === "new" ? strategyName.trim() : selectedStrategy;

              if (!finalStrategyName) {
                alert(
                  strategyMode === "new"
                    ? "Please enter a new strategy name."
                    : "Please select an existing strategy.",
                );
                return;
              }

              setIsUploading(true);
              const uploadResults = [];

              try {
                // 2. Upload EACH selected local file
                for (const fileItem of localFilesToUpload) {
                  try {
                    const { s3Key, fileId } = await uploadFileToS3(
                      fileItem.file!,
                      finalStrategyName,
                    );

                    // Save to Firebase
                    await set(
                      ref(
                        db,
                        `strategies/${finalStrategyName}/files/${fileId}`,
                      ),
                      {
                        fileName: fileItem.name,
                        s3Key,
                        size: fileItem.file!.size,
                        type: fileItem.file!.type,
                        uploadedAt: new Date().toISOString(),
                      },
                    );

                    uploadResults.push({
                      success: true,
                      fileName: fileItem.name,
                      fileId,
                    });
                  } catch (error) {
                    console.error(`Failed to upload ${fileItem.name}:`, error);
                    uploadResults.push({
                      success: false,
                      fileName: fileItem.name,
                      error,
                    });
                  }
                }

                // 3. Set createdAt timestamp for NEW strategies only
                if (strategyMode === "new") {
                  await set(
                    ref(db, `strategies/${finalStrategyName}/createdAt`),
                    new Date().toISOString(),
                  );
                }

                // 4. Show results
                const successful = uploadResults.filter((r) => r.success);
                const failed = uploadResults.filter((r) => !r.success);

                if (failed.length === 0) {
                  alert(
                    `Successfully uploaded ${successful.length} file(s) to "${finalStrategyName}"!`,
                  );
                } else {
                  alert(
                    `Uploaded ${successful.length} file(s), ${failed.length} failed. Check console.`,
                  );
                }
              } catch (err) {
                console.error("Upload process failed:", err);
                alert("Upload process failed. Please try again.");
              } finally {
                setIsUploading(false);
              }
            }}
            disabled={isUploading}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition whitespace-nowrap disabled:bg-blue-400 disabled:cursor-not-allowed"
          >
            {isUploading ? "Uploading..." : `Upload Selected to S3`}
          </button>
        </div>
        <table className="w-full text-left">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="p-4 text-sm font-semibold text-gray-600">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isIndeterminate;
                    }}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 accent-purple-600"
                  />
                  Select All
                </div>
              </th>
              <th className="p-4 text-sm font-semibold text-gray-600">Name</th>
              <th className="p-4 text-sm font-semibold text-gray-600">Date</th>
              <th className="p-4 text-sm font-semibold text-gray-600">Size</th>
            </tr>
          </thead>
          <tbody>
            {files.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-gray-400">
                  No files uploaded yet
                </td>
              </tr>
            ) : (
              files.map((file) => (
                <tr
                  key={file.id}
                  className="border-b last:border-b-0 hover:bg-gray-50 transition"
                >
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selectedFiles.some((f) => f.id === file.id)}
                      onChange={() => toggleFileSelection(file)}
                      className="w-4 h-4 accent-purple-600"
                    />
                  </td>
                  <td className="p-4 flex items-center gap-3">
                    <DocumentIcon className="w-6 h-6 text-gray-400" />
                    {file.name}
                  </td>
                  <td className="p-4 text-gray-600">{file.date}</td>
                  <td className="p-4 text-gray-600">{file.size}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
