import React, { useState, useRef, useEffect } from "react";
import { User, TranslationJob, Language } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { 
  Upload, 
  FileText, 
  X, 
  Download, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Languages,
  ArrowRight,
  History
} from "lucide-react";
import { translatePdf } from "../services/TranslationService";
import { PdfPreview } from "./PdfPreview";

interface DashboardProps {
  user: User | null;
  onAuthRequired: () => void;
}

export function Dashboard({ user, onAuthRequired }: DashboardProps) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceLang, setSourceLang] = useState<Language>("English");
  const [targetLang, setTargetLang] = useState<Language>("Chinese");
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<TranslationJob[]>([]);
  const [error, setError] = useState("");
  const [translatedBlob, setTranslatedBlob] = useState<Blob | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user) {
      fetchHistory();
    } else {
      setHistory([]);
    }
  }, [user]);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/translations", {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err) {
      console.error("Failed to fetch history");
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === "application/pdf") {
      setFile(droppedFile);
      setTranslatedBlob(null);
    }
  };

  const handleTranslate = async () => {
    if (!file) return;
    
    if (!user) {
      onAuthRequired();
      return;
    }

    setIsTranslating(true);
    setProgress(0);
    setError("");

    try {
      const blob = await translatePdf(file, sourceLang, targetLang, (p) => setProgress(p));
      setTranslatedBlob(blob);
      fetchHistory();
    } catch (err: any) {
      setError(err.message || "Translation failed. Please try again.");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleDownload = () => {
    if (!translatedBlob || !file) return;
    const url = window.URL.createObjectURL(translatedBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `[Lumina]_${targetLang}_${file.name}`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Top Row: Upload & Settings */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch">
        {/* Upload Area */}
        <div 
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={() => !file && fileInputRef.current?.click()}
          className={`flex-1 min-h-[100px] rounded-3xl border border-black/5 bg-white flex items-center px-6 gap-4 transition-all ${!file ? 'cursor-pointer hover:border-emerald-500/30 hover:bg-emerald-50/10' : ''}`}
        >
          <input type="file" ref={fileInputRef} className="hidden" accept=".pdf" onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            setTranslatedBlob(null);
          }} />
          
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${file ? 'bg-emerald-50 text-emerald-600' : 'bg-black/5 text-black/20'}`}>
            {file ? <FileText size={24} /> : <Upload size={24} />}
          </div>

          <div className="flex-1 min-w-0">
            {file ? (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{file.name}</p>
                  <p className="text-[10px] text-black/40 uppercase tracking-widest font-bold">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setFile(null); setTranslatedBlob(null); }} className="p-2 hover:bg-red-50 hover:text-red-500 rounded-full transition-colors">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold">Upload PDF</p>
                <p className="text-xs text-black/30">Drag and drop or click to browse</p>
              </div>
            )}
          </div>
        </div>

        {/* Settings Area */}
        <div className="flex-[1.5] bg-white rounded-3xl border border-black/5 p-2 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-black/30">From</span>
            <select 
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value as Language)}
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
            >
              <option>English</option>
              <option>Chinese</option>
              <option>Spanish</option>
            </select>
          </div>
          
          <div className="w-8 h-8 rounded-full bg-black/5 flex items-center justify-center text-black/20">
            <ArrowRight size={14} />
          </div>

          <div className="flex-1 flex items-center gap-2 px-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-black/30">To</span>
            <select 
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value as Language)}
              className="flex-1 bg-transparent text-sm font-medium focus:outline-none cursor-pointer"
            >
              <option>Chinese</option>
              <option>English</option>
              <option>Spanish</option>
            </select>
          </div>

          <button
            onClick={handleTranslate}
            disabled={!file || isTranslating}
            className="h-full px-8 bg-emerald-600 text-white rounded-2xl text-sm font-semibold flex items-center gap-2 hover:bg-emerald-700 transition-all active:scale-[0.98] disabled:opacity-50 disabled:bg-black/5 disabled:text-black/20"
          >
            {isTranslating ? <Loader2 className="animate-spin" size={18} /> : <Languages size={18} />}
            <span>{isTranslating ? `${Math.round(progress)}%` : 'Translate'}</span>
          </button>
        </div>

        {/* History Toggle */}
        <button 
          onClick={() => setShowHistory(!showHistory)}
          className={`px-4 rounded-3xl border transition-all flex items-center gap-2 text-sm font-medium ${showHistory ? 'bg-black text-white border-black' : 'bg-white text-black/60 border-black/5 hover:border-black/20'}`}
        >
          <History size={18} />
          <span className="hidden lg:inline">History</span>
        </button>
      </div>

      {/* Main Content: Preview & History */}
      <div className="flex-1 flex gap-6 min-h-0">
        {/* Preview Area */}
        <div className="flex-1 relative min-h-0">
          <PdfPreview file={translatedBlob || file} />
          
          {/* Transparent Download Button */}
          <AnimatePresence>
            {translatedBlob && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                onClick={handleDownload}
                className="absolute bottom-8 right-8 p-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl text-black/60 hover:bg-white/20 hover:text-black transition-all group shadow-sm flex items-center gap-2"
              >
                <Download size={20} />
                <span className="text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">Download Translated PDF</span>
              </motion.button>
            )}
          </AnimatePresence>

          {error && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 flex items-center gap-3 p-4 bg-red-50 text-red-600 rounded-2xl border border-red-100 shadow-lg z-20">
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
              <button onClick={() => setError("")} className="p-1 hover:bg-red-100 rounded-full"><X size={14} /></button>
            </div>
          )}
        </div>

        {/* History Sidebar */}
        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="hidden lg:flex flex-col gap-4 min-h-0"
            >
              <div className="flex items-center justify-between px-2">
                <h3 className="text-xs font-bold uppercase tracking-widest text-black/30">Recent Activity</h3>
                <Clock size={14} className="text-black/20" />
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-3 scrollbar-hide">
                {!user ? (
                  <div className="bg-white/50 border border-black/5 rounded-3xl p-6 text-center space-y-4">
                    <p className="text-xs text-black/40 leading-relaxed">
                      Sign in to save your translation history and access files anywhere.
                    </p>
                    <button 
                      onClick={onAuthRequired}
                      className="text-xs font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 transition-colors"
                    >
                      Sign In
                    </button>
                  </div>
                ) : history.length === 0 ? (
                  <div className="bg-white/50 border border-black/5 rounded-3xl p-8 text-center">
                    <p className="text-xs text-black/30">No history yet.</p>
                  </div>
                ) : (
                  history.map((job) => (
                    <div 
                      key={job.id}
                      className="bg-white p-4 rounded-2xl border border-black/5 shadow-sm hover:shadow-md transition-all group cursor-pointer"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 bg-[#F5F5F5] rounded-lg flex items-center justify-center text-black/40 shrink-0">
                            <FileText size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate">{job.filename}</p>
                            <p className="text-[9px] text-black/40 uppercase tracking-widest font-bold">
                              {job.source_lang} → {job.target_lang}
                            </p>
                          </div>
                        </div>
                        <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-black/5">
                        <span className="text-[9px] text-black/30">
                          {new Date(job.created_at).toLocaleDateString()}
                        </span>
                        <button className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 hover:text-emerald-700 flex items-center gap-1">
                          <Download size={12} />
                          Get
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
