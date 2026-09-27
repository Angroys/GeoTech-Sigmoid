import { Upload } from "lucide-react";
import { useId, useState, type ChangeEvent, type DragEvent, type FC } from "react";

import { cn } from "@/shared/lib/cn";

type FileDropZoneProps = {
  prompt: string;
  accept: string;
  describedBy: string;
  onFiles: (files: File[]) => void;
};

export const FileDropZone: FC<FileDropZoneProps> = ({ prompt, accept, describedBy, onFiles }) => {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

  const takeFiles = (list: FileList | null) => {
    if (list && list.length > 0) onFiles([...list]);
  };
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    takeFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    takeFiles(event.dataTransfer.files);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
      className={cn(
        "grid content-center justify-items-center gap-2 rounded-lg border-2 border-dashed px-5 py-8 text-center transition-colors motion-reduce:transition-none",
        isDragging ? "border-primary bg-primary/5" : "border-input bg-muted/40",
      )}
    >
      <Upload className="text-muted-foreground size-6" aria-hidden />
      <p className="text-sm font-medium">{prompt}</p>
      <p className="text-muted-foreground text-sm">
        or{" "}
        <label
          htmlFor={inputId}
          className="text-primary cursor-pointer font-medium underline-offset-4 hover:underline has-[+input:focus-visible]:underline"
        >
          choose files
        </label>
      </p>
      <input
        id={inputId}
        type="file"
        multiple
        accept={accept}
        onChange={onChange}
        aria-describedby={describedBy}
        className="sr-only"
      />
    </div>
  );
};
