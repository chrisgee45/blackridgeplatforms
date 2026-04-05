import { useEffect } from "react";
import { useLocation } from "wouter";

export default function OAuthCallback() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthStateId = params.get("oauth_state_id");
    if (oauthStateId) {
      setLocation(`/admin/ops/financials?oauth_state_id=${oauthStateId}`);
    } else {
      setLocation("/admin/ops/financials");
    }
  }, [setLocation]);

  return (
    <div className="flex items-center justify-center min-h-screen" data-testid="oauth-callback">
      <p className="text-muted-foreground">Completing bank connection...</p>
    </div>
  );
}
