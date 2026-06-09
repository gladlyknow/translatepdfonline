/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { Auth } from "./components/Auth";
import { Dashboard } from "./components/Dashboard";
import { User } from "./types";
import { motion, AnimatePresence } from "motion/react";
import { Languages, User as UserIcon, X, Globe } from "lucide-react";
import { UserMenu } from "./components/UserMenu";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);
  const [lang, setLang] = useState<'en' | 'zh'>('en');

  useEffect(() => {
    const savedUser = localStorage.getItem("user");
    const token = localStorage.getItem("token");
    if (savedUser && token) {
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setUser(null);
  };

  if (loading) return null;

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A] font-sans selection:bg-emerald-100 flex flex-col">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-black/5">
        <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
                <Languages size={16} />
              </div>
              <span className="text-lg font-semibold tracking-tight">Lumina</span>
            </div>
            
            <div className="hidden md:flex items-center gap-1 bg-black/5 p-1 rounded-full">
              <button 
                onClick={() => setLang('en')}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${lang === 'en' ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black'}`}
              >
                EN
              </button>
              <button 
                onClick={() => setLang('zh')}
                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full transition-all ${lang === 'zh' ? 'bg-white text-black shadow-sm' : 'text-black/40 hover:text-black'}`}
              >
                中文
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <UserMenu user={user} onLogout={handleLogout} onUpdateUser={setUser} />
            ) : (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowAuth(true)}
                  className="px-4 py-1.5 text-xs font-semibold text-black/60 hover:text-black transition-colors"
                >
                  Sign In
                </button>
                <button 
                  onClick={() => setShowAuth(true)}
                  className="px-4 py-1.5 bg-black text-white text-xs font-semibold rounded-full hover:bg-black/80 transition-all active:scale-[0.98]"
                >
                  Get Started
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-1 flex flex-col max-w-[1600px] mx-auto w-full px-6 py-6 overflow-hidden">
        <Dashboard user={user} onAuthRequired={() => setShowAuth(true)} />
      </main>

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuth && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuth(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#F5F5F5] rounded-[32px] shadow-2xl overflow-hidden"
            >
              <button 
                onClick={() => setShowAuth(false)}
                className="absolute top-6 right-6 p-2 hover:bg-black/5 rounded-full transition-colors z-10"
              >
                <X size={20} />
              </button>
              <div className="p-8 pt-12">
                <Auth onLogin={(user) => {
                  setUser(user);
                  setShowAuth(false);
                }} />
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-black/5">
        <div className="flex flex-col md:flex-row justify-between items-center gap-6 text-sm text-black/40">
          <p>© 2026 Lumina PDF Translator. Professional Grade Translation.</p>
          <div className="flex gap-8">
            <a href="#" className="hover:text-black transition-colors">Privacy</a>
            <a href="#" className="hover:text-black transition-colors">Terms</a>
            <a href="#" className="hover:text-black transition-colors">Support</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

