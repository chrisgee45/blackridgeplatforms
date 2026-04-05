import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, CheckCircle, XCircle, AlertTriangle } from "lucide-react";

export default function AuditTestPage() {
  const [businessName, setBusinessName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");

  const auditMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/outreach/audits/run", {
        businessName,
        websiteUrl,
        industry: industry || undefined,
        city: city || undefined,
        phone: phone || undefined,
      });
      return res.json();
    },
  });

  const result = auditMutation.data;
  const audit = result?.audit;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900" data-testid="text-page-title">Website Audit Test Tool</h1>
        <p className="text-sm text-gray-500 mt-1">Run a single-site audit to test the Bad Website Finder pipeline.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Business Name *</Label>
              <Input
                id="businessName"
                data-testid="input-business-name"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Joe's Plumbing"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="websiteUrl">Website URL *</Label>
              <Input
                id="websiteUrl"
                data-testid="input-website-url"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="joesplumbing.com"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                data-testid="input-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Plumbing"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                data-testid="input-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Dallas"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                data-testid="input-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>
          <Button
            data-testid="button-run-audit"
            onClick={() => auditMutation.mutate()}
            disabled={!businessName || !websiteUrl || auditMutation.isPending}
            className="w-full"
          >
            {auditMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running Audit...
              </>
            ) : (
              <>
                <Search className="w-4 h-4 mr-2" />
                Run Audit
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {auditMutation.isError && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-red-700">
              <XCircle className="w-5 h-5" />
              <span data-testid="text-error">{(auditMutation.error as any)?.message || "Audit failed"}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {result && !result.success && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              <div>
                <p className="font-medium" data-testid="text-fetch-status">Fetch status: {result.fetchStatus}</p>
                <p className="text-sm" data-testid="text-fetch-error">{result.fetchError}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {audit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Audit Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-4 gap-4">
              <ScoreCard label="Rule Score" value={audit.ruleScore} testId="text-rule-score" />
              <ScoreCard label="AI Score" value={audit.aiScore} testId="text-ai-score" />
              <ScoreCard label="Bad Site Score" value={audit.badSiteScore} testId="text-bad-site-score" />
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">Redesign Worthy</p>
                <Badge
                  data-testid="badge-redesign-worthy"
                  variant={audit.redesignWorthy ? "default" : "secondary"}
                  className={audit.redesignWorthy ? "bg-green-600" : ""}
                >
                  {audit.redesignWorthy ? "Yes" : "No"}
                </Badge>
              </div>
            </div>

            {audit.screenshotUrl && (
              <ResultSection title="Screenshot" testId="text-screenshot">
                <img
                  src={audit.screenshotUrl}
                  alt={`Screenshot of ${audit.websiteUrl}`}
                  className="rounded-lg border border-gray-200 max-w-full"
                  data-testid="img-screenshot"
                />
              </ResultSection>
            )}

            {audit.topProblems && (
              <ResultSection title="Top Problems" testId="text-top-problems">
                <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                  {(audit.topProblems as string[]).map((p: string, i: number) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </ResultSection>
            )}

            {audit.pitchAngle && (
              <ResultSection title="Pitch Angle" testId="text-pitch-angle">
                <p className="text-sm text-gray-700">{audit.pitchAngle}</p>
              </ResultSection>
            )}

            {audit.openingLine && (
              <ResultSection title="Opening Line" testId="text-opening-line">
                <p className="text-sm text-gray-700 italic">"{audit.openingLine}"</p>
              </ResultSection>
            )}

            {audit.visualStyleAssessment && (
              <ResultSection title="Visual Style Assessment" testId="text-visual-style">
                <p className="text-sm text-gray-700">{audit.visualStyleAssessment}</p>
              </ResultSection>
            )}

            {audit.conversionAssessment && (
              <ResultSection title="Conversion Assessment" testId="text-conversion">
                <p className="text-sm text-gray-700">{audit.conversionAssessment}</p>
              </ResultSection>
            )}

            <div className="text-xs text-gray-400 pt-2 border-t">
              Audit ID: {audit.id}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ScoreCard({ label, value, testId }: { label: string; value: number | string | null; testId: string }) {
  const num = value != null ? Number(value) : null;
  return (
    <div className="text-center p-3 bg-gray-50 rounded-lg">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900" data-testid={testId}>
        {num != null ? num : "—"}
      </p>
    </div>
  );
}

function ResultSection({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">{title}</h3>
      <div data-testid={testId}>{children}</div>
    </div>
  );
}
