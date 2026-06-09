import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as pdfjs from "pdfjs-dist";
import { Language } from "../types";

// Setup PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

export async function translatePdf(
  file: File,
  sourceLang: Language,
  targetLang: Language,
  onProgress: (progress: number) => void
): Promise<Blob> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  
  const translatedPdf = await PDFDocument.create();
  const font = await translatedPdf.embedFont(StandardFonts.Helvetica);
  // For Chinese, we'd ideally embed a CJK font, but for this demo, 
  // we'll use standard fonts and focus on the translation flow.
  // In a production app, you'd use a font like 'NotoSansSC' for Chinese.

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const textItems = textContent.items.map((item: any) => item.str).join(" ");
    
    // Split text into chunks to avoid Gemini token limits if necessary
    // For simplicity, we'll translate the whole page text
    const translatedText = await callTranslationApi(textItems, targetLang);
    
    const newPage = translatedPdf.addPage();
    const { width, height } = newPage.getSize();
    
    // Draw translated text
    // This is a simplified layout preservation. 
    // Real layout preservation requires mapping coordinates.
    newPage.drawText(translatedText, {
      x: 50,
      y: height - 50,
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
      maxWidth: width - 100,
      lineHeight: 14,
    });

    onProgress((i / totalPages) * 100);
  }

  // Record translation in DB via API
  await recordTranslation(file.name, sourceLang, targetLang);

  const pdfBytes = await translatedPdf.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

async function callTranslationApi(text: string, targetLang: string): Promise<string> {
  const token = localStorage.getItem("token");
  const res = await fetch("/api/ai/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text, targetLang }),
  });

  if (!res.ok) throw new Error("Translation API failed");
  const data = await res.json();
  return data.translatedText;
}

async function recordTranslation(filename: string, sourceLang: string, targetLang: string) {
  const token = localStorage.getItem("token");
  await fetch("/api/translate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ filename, sourceLang, targetLang }),
  });
}
