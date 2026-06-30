'use client';

export default function CompareViewer({ sdkUrl }: { sdkUrl: string }) {
  return (
    <div className="w-full" style={{ height: 'calc(100vh - 180px)', minHeight: 600 }}>
      <iframe
        src={sdkUrl}
        className="h-full w-full border-0 rounded-lg"
        allow="clipboard-write"
        title="Document Comparison Result"
      />
    </div>
  );
}
