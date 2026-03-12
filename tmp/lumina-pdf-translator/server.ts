import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || "lumina-secret-key-123";
const db = new Database("database.sqlite");

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    avatar_url TEXT,
    provider TEXT DEFAULT 'email',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    filename TEXT,
    source_lang TEXT,
    target_lang TEXT,
    status TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

const app = express();
app.use(express.json());
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 500 * 1024 } // 500KB limit
});

// Auth Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// --- API Routes ---

app.post("/api/auth/signup", async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${email}`;
    const stmt = db.prepare("INSERT INTO users (email, password, avatar_url) VALUES (?, ?, ?)");
    const info = stmt.run(email, hashedPassword, avatarUrl);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT') {
      res.status(400).json({ error: "Email already exists" });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  const user: any = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  
  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, avatar_url: user.avatar_url, provider: user.provider } });
});

app.post("/api/user/avatar", authenticateToken, upload.single("avatar"), (req: any, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  
  const avatarUrl = `/uploads/${req.file.filename}`;
  db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").run(avatarUrl, req.user.id);
  
  res.json({ avatarUrl });
});

app.get("/api/translations", authenticateToken, (req: any, res) => {
  const translations = db.prepare("SELECT * FROM translations WHERE user_id = ? ORDER BY created_at DESC").all(req.user.id);
  res.json(translations);
});

app.post("/api/translate", authenticateToken, async (req: any, res) => {
  const { filename, sourceLang, targetLang } = req.body;

  // Record translation job
  const stmt = db.prepare("INSERT INTO translations (user_id, filename, source_lang, target_lang, status) VALUES (?, ?, ?, ?, ?)");
  const info = stmt.run(req.user.id, filename, sourceLang, targetLang, "completed");
  const jobId = info.lastInsertRowid;
  
  res.json({ jobId, status: "completed" });
});

// Proxy Gemini calls to keep API key safe
app.post("/api/ai/translate", authenticateToken, async (req: any, res) => {
  const { text, targetLang } = req.body;
  
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "Gemini API key not configured" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const model = ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Translate the following text to ${targetLang}. Preserve the tone and formatting as much as possible. Only return the translated text.\n\nText:\n${text}`,
    });
    
    const result = await model;
    res.json({ translatedText: result.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Translation failed" });
  }
});

// --- Vite Integration ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
