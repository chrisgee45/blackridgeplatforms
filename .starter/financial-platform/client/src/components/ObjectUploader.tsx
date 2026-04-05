import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Paperclip, Loader2 } from "lucide-react";

interface ObjectUploaderProps {
  onUploadComplete?: (url: string) => void;
  directory?: string;
  accept?: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
  className?: string;
}

export function ObjectUploader({
  onUploadComplete,
  accept = "image/*,.pdf",
  label = "Upload",
  variant = "outline",
  size = "sm",
  className,
}: ObjectUploaderProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => inputRef.current?.click();

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        onUploadComplete?.(data.url || data.path);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" />
      <Button variant={variant} size={size} onClick={handleClick} disabled={uploading} className={className}>
        {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Paperclip className="w-4 h-4 mr-1" />}
        {label}
      </Button>
    </>
  );
}
