import React, { useState, useRef } from "react";
import { User } from "../types";
import { LogOut, User as UserIcon, Camera, Loader2, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface UserMenuProps {
  user: User;
  onLogout: () => void;
  onUpdateUser: (user: User) => void;
}

export function UserMenu({ user, onLogout, onUpdateUser }: UserMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 500 * 1024) {
      alert("Image size must be less than 500KB");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const res = await fetch("/api/user/avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: formData,
      });

      if (res.ok) {
        const { avatarUrl } = await res.json();
        const updatedUser = { ...user, avatar_url: avatarUrl };
        localStorage.setItem("user", JSON.stringify(updatedUser));
        onUpdateUser(updatedUser);
      }
    } catch (err) {
      console.error("Failed to upload avatar", err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 p-1 pr-3 rounded-full hover:bg-black/5 transition-colors"
      >
        <div className="relative w-8 h-8 rounded-full overflow-hidden bg-emerald-100 flex items-center justify-center border border-black/5">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <UserIcon size={16} className="text-emerald-600" />
          )}
        </div>
        <span className="text-sm font-medium text-black/70 hidden sm:inline-block max-w-[120px] truncate">
          {user.email.split('@')[0]}
        </span>
        <ChevronDown size={14} className={`text-black/30 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-black/5 z-20 overflow-hidden"
            >
              <div className="p-4 border-b border-black/5 flex flex-col items-center gap-3">
                <div className="relative group cursor-pointer" onClick={handleAvatarClick}>
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-emerald-100 flex items-center justify-center border-2 border-white shadow-sm">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <UserIcon size={32} className="text-emerald-600" />
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {isUploading ? <Loader2 size={20} className="text-white animate-spin" /> : <Camera size={20} className="text-white" />}
                  </div>
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold truncate w-56">{user.email}</p>
                  <p className="text-[10px] uppercase tracking-widest text-black/40 font-bold mt-1">
                    {user.provider || 'Email'} Account
                  </p>
                </div>
              </div>

              <div className="p-2">
                <button
                  onClick={onLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <LogOut size={18} />
                  Sign Out
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
