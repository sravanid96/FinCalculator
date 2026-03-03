import { useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Loader2, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export function LabReportUpload() {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      const token = localStorage.getItem("auth_token");
      const res = await fetch("/api/health/lab-reports", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/health/lab-reports"] });
      setSelectedFile(null);
      toast({ title: "Lab report uploaded", description: "Your report has been analyzed successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const file = e.dataTransfer.files[0];
    if (file?.type === "application/pdf") {
      setSelectedFile(file);
    } else {
      toast({ title: "Invalid file", description: "Please upload a PDF file.", variant: "destructive" });
    }
  }, [toast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
    e.target.value = "";
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          {uploadMutation.isPending ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm font-medium">Analyzing lab report with AI...</p>
              <p className="text-xs text-muted-foreground">This may take 10-20 seconds</p>
            </div>
          ) : selectedFile ? (
            <div className="flex flex-col items-center gap-3">
              <FileText className="h-10 w-10 text-primary" />
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{selectedFile.name}</span>
                <button onClick={() => setSelectedFile(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Button onClick={() => uploadMutation.mutate(selectedFile)} size="sm">
                <Upload className="mr-2 h-4 w-4" />
                Upload & Analyze
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Drop your lab report PDF here</p>
                <p className="text-xs text-muted-foreground">or click to browse</p>
              </div>
              <label>
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileSelect} />
                <Button variant="outline" size="sm" asChild>
                  <span>Choose File</span>
                </Button>
              </label>
            </div>
          )}
        </div>

        {uploadMutation.isError && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{uploadMutation.error.message}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
