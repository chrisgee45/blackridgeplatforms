import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, ShieldCheck, ShieldOff, Copy, CheckCircle2 } from "lucide-react";

export function MfaSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [setupData, setSetupData] = useState<{ qrCode: string; secret: string } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: mfaStatus, isLoading: statusLoading } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/mfa/status"],
    enabled: open,
  });

  const setupMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mfa/setup", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      setSetupData({ qrCode: data.qrCode, secret: data.secret });
    },
    onError: () => {
      toast({ title: "Failed to start MFA setup", variant: "destructive" });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mfa/verify-setup", { code: verifyCode });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "MFA enabled!", description: "Two-factor authentication is now active on your account." });
      queryClient.invalidateQueries({ queryKey: ["/api/mfa/status"] });
      setSetupData(null);
      setVerifyCode("");
    },
    onError: (err: Error) => {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/mfa/disable", { code: disableCode });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "MFA disabled", description: "Two-factor authentication has been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/mfa/status"] });
      setDisableCode("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to disable MFA", description: err.message, variant: "destructive" });
    },
  });

  const handleCopySecret = () => {
    if (setupData?.secret) {
      navigator.clipboard.writeText(setupData.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setSetupData(null);
    setVerifyCode("");
    setDisableCode("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="max-w-md" data-testid="dialog-mfa-settings">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Two-Factor Authentication
          </DialogTitle>
        </DialogHeader>

        {statusLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : mfaStatus?.enabled ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-200 dark:border-emerald-800">
              <ShieldCheck className="h-8 w-8 text-emerald-600 shrink-0" />
              <div>
                <p className="font-medium text-emerald-800 dark:text-emerald-200">MFA is Active</p>
                <p className="text-sm text-emerald-600 dark:text-emerald-400">Your account is protected with two-factor authentication.</p>
              </div>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-2">Disable MFA</p>
              <p className="text-xs text-muted-foreground mb-3">Enter a code from your authenticator app to disable MFA.</p>
              <div className="flex gap-2">
                <Input
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  className="text-center font-mono tracking-widest"
                  data-testid="input-mfa-disable-code"
                />
                <Button
                  variant="destructive"
                  onClick={() => disableMutation.mutate()}
                  disabled={disableCode.length !== 6 || disableMutation.isPending}
                  data-testid="btn-disable-mfa"
                >
                  {disableMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4 mr-1" />}
                  Disable
                </Button>
              </div>
            </div>
          </div>
        ) : setupData ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
            <div className="flex justify-center">
              <img src={setupData.qrCode} alt="MFA QR Code" className="w-48 h-48 rounded-lg border" data-testid="img-mfa-qr" />
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Or enter this secret manually:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-muted rounded text-xs font-mono break-all select-all" data-testid="text-mfa-secret">
                  {setupData.secret}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopySecret} data-testid="btn-copy-secret">
                  {copied ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Verify Setup</p>
              <p className="text-xs text-muted-foreground mb-2">Enter the 6-digit code from your authenticator app:</p>
              <div className="flex gap-2">
                <Input
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  className="text-center text-lg font-mono tracking-widest"
                  autoFocus
                  data-testid="input-mfa-verify-code"
                />
                <Button
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyCode.length !== 6 || verifyMutation.isPending}
                  data-testid="btn-verify-mfa"
                >
                  {verifyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
              <Shield className="h-8 w-8 text-amber-600 shrink-0" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-200">MFA is Not Enabled</p>
                <p className="text-sm text-amber-600 dark:text-amber-400">Add an extra layer of security to your account.</p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Two-factor authentication adds an additional security layer by requiring a verification code from your authenticator app at every login.</p>
              <p>Supported apps: Google Authenticator, Authy, 1Password, Microsoft Authenticator, and more.</p>
            </div>

            <Button
              className="w-full"
              onClick={() => setupMutation.mutate()}
              disabled={setupMutation.isPending}
              data-testid="btn-setup-mfa"
            >
              {setupMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Setting up...</>
              ) : (
                <><ShieldCheck className="h-4 w-4 mr-2" />Enable Two-Factor Authentication</>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
