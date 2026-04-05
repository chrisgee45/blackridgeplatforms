import { useState, useEffect, useRef } from "react";
import { useRoute } from "wouter";

interface FormData {
  businessName: string;
  businessDescription: string;
  idealCustomer: string;
  differentiator: string;
  hasWebsite: string;
  existingUrl: string;
  websiteChanges: string;
  existingBrand: string;
  brandColors: string;
  fonts: string;
  brandPersonality: string[];
  brandPersonalityOther: string;
  pagesNeeded: string[];
  pagesCustom: string;
  homepageGoal: string;
  inspirationSites: string;
  sitesToAvoid: string;
  copyWriter: string;
  hasProfessionalPhotos: string;
  needsStockPhotography: string;
  hasVideoContent: string;
  videoLinks: string;
  featuresNeeded: string[];
  featuresCustom: string;
  thirdPartyIntegrations: string;
  lockedInTools: string;
  ownsDomain: string;
  domainRegistrar: string;
  existingHosting: string;
  loginsToShare: string;
  socialPlatforms: string[];
  socialHandles: string;
  pointOfContact: string;
  preferredContact: string;
  bestTimes: string;
  hasDeadline: string;
  deadlineDetails: string;
  nervousAbout: string;
  anythingElse: string;
}

const defaultFormData: FormData = {
  businessName: "", businessDescription: "", idealCustomer: "", differentiator: "",
  hasWebsite: "", existingUrl: "", websiteChanges: "",
  existingBrand: "", brandColors: "", fonts: "", brandPersonality: [], brandPersonalityOther: "",
  pagesNeeded: [], pagesCustom: "", homepageGoal: "", inspirationSites: "", sitesToAvoid: "",
  copyWriter: "", hasProfessionalPhotos: "", needsStockPhotography: "", hasVideoContent: "", videoLinks: "",
  featuresNeeded: [], featuresCustom: "", thirdPartyIntegrations: "", lockedInTools: "",
  ownsDomain: "", domainRegistrar: "", existingHosting: "", loginsToShare: "", socialPlatforms: [], socialHandles: "",
  pointOfContact: "", preferredContact: "", bestTimes: "", hasDeadline: "", deadlineDetails: "", nervousAbout: "", anythingElse: "",
};

const brandPersonalityOptions = [
  "Professional / Corporate", "Bold / Confident", "Clean / Minimal", "Warm / Approachable",
  "Rugged / Industrial", "Luxury / High-End", "Friendly / Casual", "Innovative / Tech-Forward",
];

const pageOptions = [
  "Home", "About", "Services", "Individual Service Pages", "Portfolio / Work Showcase", "Blog",
  "Team / Staff", "Testimonials", "FAQ", "Contact", "Booking / Scheduling", "E-Commerce / Shop", "Client Login Portal",
];

const featureOptions = [
  "Contact form", "Online booking / scheduling", "Payment processing", "E-commerce / product catalog",
  "Client login portal", "CRM integration", "Invoicing and billing", "Project management tools",
  "Live chat", "Newsletter / email capture", "Social media feeds", "Review / testimonial display",
  "AI-powered tools", "Custom automations",
];

const socialOptions = ["Facebook", "Instagram", "LinkedIn", "TikTok", "YouTube", "X"];

function SectionHeader({ number, title }: { number: number; title: string }) {
  return (
    <div className="mb-6 mt-10 first:mt-0">
      <p className="text-[#C9A840] text-[10px] font-bold tracking-[4px] uppercase mb-1">Section {number}</p>
      <h2 className="text-white text-xl font-bold tracking-tight">{title}</h2>
      <div className="w-12 h-0.5 bg-[#C9A840] mt-2" />
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-gray-300 mb-1.5">
      {children}
      {required && <span className="text-[#C9A840] ml-1">*</span>}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, type = "text" }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#C9A840] focus:ring-1 focus:ring-[#C9A840]/30 transition-colors"
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 4 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-[#C9A840] focus:ring-1 focus:ring-[#C9A840]/30 transition-colors resize-y"
    />
  );
}

function RadioGroup({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <div key={opt.value} onClick={() => onChange(opt.value)} className="flex items-center gap-3 cursor-pointer group" data-testid={`radio-${opt.value}`}>
          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${value === opt.value ? "border-[#C9A840] bg-[#C9A840]" : "border-gray-500 group-hover:border-gray-400"}`}>
            {value === opt.value && <div className="w-1.5 h-1.5 bg-black rounded-full" />}
          </div>
          <span className="text-sm text-gray-300">{opt.label}</span>
        </div>
      ))}
    </div>
  );
}

function CheckboxGroup({ selected, onChange, options }: { selected: string[]; onChange: (v: string[]) => void; options: string[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {options.map((opt) => (
        <div key={opt} onClick={() => onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt])} className="flex items-center gap-3 cursor-pointer group" data-testid={`checkbox-${opt}`}>
          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selected.includes(opt) ? "border-[#C9A840] bg-[#C9A840]" : "border-gray-500 group-hover:border-gray-400"}`}>
            {selected.includes(opt) && (
              <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
            )}
          </div>
          <span className="text-sm text-gray-300">{opt}</span>
        </div>
      ))}
    </div>
  );
}

interface UploadedFile {
  name: string;
  url: string;
  size: number;
  type: string;
}

function FileUploadField({ label, accept, maxFiles = 10, files, onFilesChange, token }: {
  label: string; accept?: string; maxFiles?: number; files: UploadedFile[]; onFilesChange: (f: UploadedFile[]) => void; token: string;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    const newFiles: UploadedFile[] = [];
    for (let i = 0; i < Math.min(fileList.length, maxFiles - files.length); i++) {
      const file = fileList[i];
      try {
        const res = await fetch("/api/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `kickoff/${token}/${file.name}`, size: file.size, contentType: file.type }),
        });
        const data = await res.json();
        await fetch(data.uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
        newFiles.push({ name: file.name, url: data.objectPath, size: file.size, type: file.type });
      } catch {
        console.error("Upload failed for", file.name);
      }
    }
    onFilesChange([...files, ...newFiles]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <div
        className="border-2 border-dashed border-[#333] rounded-lg p-6 text-center cursor-pointer hover:border-[#C9A840]/50 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" multiple accept={accept} onChange={(e) => handleFiles(e.target.files)} className="hidden" />
        {uploading ? (
          <p className="text-sm text-gray-400">Uploading...</p>
        ) : (
          <>
            <svg className="w-8 h-8 mx-auto text-gray-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <p className="text-sm text-gray-400">Click to upload or drag files here</p>
            <p className="text-xs text-gray-600 mt-1">Max {maxFiles} files</p>
          </>
        )}
      </div>
      {files.length > 0 && (
        <div className="space-y-1">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 bg-[#1a1a1a] rounded px-3 py-2">
              <svg className="w-4 h-4 text-[#C9A840] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <span className="text-sm text-gray-300 truncate flex-1">{f.name}</span>
              <span className="text-xs text-gray-500">{(f.size / 1024).toFixed(0)} KB</span>
              <button onClick={(e) => { e.stopPropagation(); onFilesChange(files.filter((_, j) => j !== i)); }} className="text-gray-500 hover:text-red-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KickoffForm() {
  const [, params] = useRoute("/kickoff/:token");
  const token = params?.token || "";
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "submitted">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [meta, setMeta] = useState<{ clientName: string; clientEmail: string; companyName: string; projectName: string } | null>(null);
  const [form, setForm] = useState<FormData>(defaultFormData);
  const [logoFiles, setLogoFiles] = useState<UploadedFile[]>([]);
  const [brandAssetFiles, setBrandAssetFiles] = useState<UploadedFile[]>([]);
  const [photoFiles, setPhotoFiles] = useState<UploadedFile[]>([]);
  const [videoFiles, setVideoFiles] = useState<UploadedFile[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackError, setAckError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const ackRef = useRef<HTMLDivElement>(null);

  const update = (key: keyof FormData, value: any) => setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (!token) return;
    fetch(`/api/kickoff/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json();
          setErrorMsg(data.error || "Invalid link.");
          setStatus("error");
          return;
        }
        const data = await r.json();
        setMeta(data);
        setForm((prev) => ({ ...prev, businessName: data.companyName || "" }));
        setStatus("ready");
      })
      .catch(() => {
        setErrorMsg("Something went wrong. Please try again later.");
        setStatus("error");
      });
  }, [token]);

  async function handleSubmit() {
    if (!acknowledged) {
      setAckError(true);
      ackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSubmitting(true);
    try {
      const allFiles = [...logoFiles, ...brandAssetFiles, ...photoFiles, ...videoFiles];
      const res = await fetch(`/api/kickoff/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: form, uploadedFiles: allFiles, acknowledged }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Submission failed.");
        setSubmitting(false);
        return;
      }
      setStatus("submitted");
    } catch {
      alert("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#C9A840] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-4">
        <div className="bg-[#111] rounded-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </div>
          <h2 className="text-white text-lg font-semibold mb-2">Oops</h2>
          <p className="text-gray-400 text-sm">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (status === "submitted") {
    return (
      <div className="min-h-screen bg-[#0A0A0A]">
        <div className="bg-black border-b border-[#222] py-4 px-4 text-center">
          <h1 className="text-white text-xl font-bold tracking-[3px]">BLACKRIDGE</h1>
          <p className="text-[#C9A840] text-[10px] tracking-[4px] mt-0.5">PLATFORMS</p>
        </div>
        <div className="flex items-center justify-center min-h-[80vh] px-4">
          <div className="bg-[#111] rounded-xl p-10 max-w-lg w-full text-center">
            <div className="w-16 h-16 rounded-full bg-[#C9A840]/10 flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-[#C9A840]" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <h2 className="text-white text-2xl font-bold mb-3">You're locked in.</h2>
            <p className="text-gray-400 text-base leading-relaxed">I'll review everything and reach out within 1 business day with next steps. Let's build something great.</p>
            <p className="text-[#C9A840] text-sm font-semibold mt-6">— Chris, BlackRidge Platforms</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A]">
      <div className="bg-black border-b border-[#222] py-4 px-4 text-center sticky top-0 z-50">
        <h1 className="text-white text-xl font-bold tracking-[3px]">BLACKRIDGE</h1>
        <p className="text-[#C9A840] text-[10px] tracking-[4px] mt-0.5">PLATFORMS</p>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 pb-20">
        <div className="mb-8">
          <h1 className="text-white text-2xl sm:text-3xl font-bold" data-testid="text-kickoff-title">Client Kickoff Discovery</h1>
          <p className="text-gray-400 text-sm mt-2">Hey {meta?.clientName} — fill this out and I'll have everything I need to get started on <span className="text-white font-medium">{meta?.projectName}</span>. Be as detailed as you can.</p>
        </div>

        <SectionHeader number={1} title="Your Business" />
        <div className="space-y-5">
          <div>
            <FieldLabel required>What is your business name?</FieldLabel>
            <TextInput value={form.businessName} onChange={(v) => update("businessName", v)} placeholder="Your business name" />
          </div>
          <div>
            <FieldLabel required>What do you do and who do you serve?</FieldLabel>
            <TextArea value={form.businessDescription} onChange={(v) => update("businessDescription", v)} placeholder="Tell me about your business in your own words" />
          </div>
          <div>
            <FieldLabel>Who is your ideal customer?</FieldLabel>
            <TextArea value={form.idealCustomer} onChange={(v) => update("idealCustomer", v)} placeholder="Describe them like you're telling a friend" />
          </div>
          <div>
            <FieldLabel>What makes you different from your competitors?</FieldLabel>
            <TextArea value={form.differentiator} onChange={(v) => update("differentiator", v)} placeholder="Your unique edge" />
          </div>
          <div>
            <FieldLabel>Do you have an existing website?</FieldLabel>
            <RadioGroup value={form.hasWebsite} onChange={(v) => update("hasWebsite", v)} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
          </div>
          {form.hasWebsite === "yes" && (
            <>
              <div>
                <FieldLabel>What is the URL?</FieldLabel>
                <TextInput value={form.existingUrl} onChange={(v) => update("existingUrl", v)} placeholder="https://..." />
              </div>
              <div>
                <FieldLabel>What do you want to keep, change, or throw out entirely?</FieldLabel>
                <TextArea value={form.websiteChanges} onChange={(v) => update("websiteChanges", v)} placeholder="Be honest — I can handle it" />
              </div>
            </>
          )}
        </div>

        <SectionHeader number={2} title="Brand Identity" />
        <div className="space-y-5">
          <div>
            <FieldLabel>Do you have an existing brand?</FieldLabel>
            <RadioGroup value={form.existingBrand} onChange={(v) => update("existingBrand", v)} options={[
              { value: "fully_developed", label: "Yes — fully developed" },
              { value: "somewhat", label: "Yes — somewhat" },
              { value: "scratch", label: "No — starting from scratch" },
            ]} />
          </div>
          <div>
            <FieldLabel>Primary brand colors</FieldLabel>
            <TextInput value={form.brandColors} onChange={(v) => update("brandColors", v)} placeholder="List hex codes or describe them" />
          </div>
          <div>
            <FieldLabel>Fonts you use or love</FieldLabel>
            <TextInput value={form.fonts} onChange={(v) => update("fonts", v)} placeholder="e.g. Montserrat, Playfair Display" />
          </div>
          <div>
            <FieldLabel>Words that describe your brand personality</FieldLabel>
            <CheckboxGroup selected={form.brandPersonality} onChange={(v) => update("brandPersonality", v)} options={brandPersonalityOptions} />
            <div className="mt-2">
              <TextInput value={form.brandPersonalityOther} onChange={(v) => update("brandPersonalityOther", v)} placeholder="Other — describe it" />
            </div>
          </div>
          <FileUploadField label="Upload your logo files" accept=".png,.svg,.ai,.pdf,.jpg,.jpeg" maxFiles={5} files={logoFiles} onFilesChange={setLogoFiles} token={token} />
          <FileUploadField label="Other brand assets (brand guide, color swatches, existing materials)" accept="*" maxFiles={5} files={brandAssetFiles} onFilesChange={setBrandAssetFiles} token={token} />
        </div>

        <SectionHeader number={3} title="Website & Pages" />
        <div className="space-y-5">
          <div>
            <FieldLabel>What pages do you need?</FieldLabel>
            <CheckboxGroup selected={form.pagesNeeded} onChange={(v) => update("pagesNeeded", v)} options={pageOptions} />
            <div className="mt-2">
              <TextInput value={form.pagesCustom} onChange={(v) => update("pagesCustom", v)} placeholder="Other custom pages..." />
            </div>
          </div>
          <div>
            <FieldLabel>What should your homepage accomplish?</FieldLabel>
            <TextArea value={form.homepageGoal} onChange={(v) => update("homepageGoal", v)} placeholder="What should someone feel and do when they land on it?" />
          </div>
          <div>
            <FieldLabel>Websites you love and want to draw inspiration from</FieldLabel>
            <TextArea value={form.inspirationSites} onChange={(v) => update("inspirationSites", v)} placeholder="List URLs or describe what you like about them" />
          </div>
          <div>
            <FieldLabel>Websites you hate</FieldLabel>
            <TextArea value={form.sitesToAvoid} onChange={(v) => update("sitesToAvoid", v)} placeholder="What do you want to avoid?" />
          </div>
        </div>

        <SectionHeader number={4} title="Content & Copy" />
        <div className="space-y-5">
          <div>
            <FieldLabel>Who is writing the copy for the site?</FieldLabel>
            <RadioGroup value={form.copyWriter} onChange={(v) => update("copyWriter", v)} options={[
              { value: "self", label: "I'll write it myself" },
              { value: "blackridge", label: "I need BlackRidge to write it" },
              { value: "partial", label: "I have some — need help finishing it" },
            ]} />
          </div>
          <div>
            <FieldLabel>Do you have professional photos?</FieldLabel>
            <RadioGroup value={form.hasProfessionalPhotos} onChange={(v) => update("hasProfessionalPhotos", v)} options={[
              { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "some", label: "Some — need more" },
            ]} />
          </div>
          {(form.hasProfessionalPhotos === "yes" || form.hasProfessionalPhotos === "some") && (
            <FileUploadField label="Upload your photos" accept=".jpg,.jpeg,.png,.webp" maxFiles={10} files={photoFiles} onFilesChange={setPhotoFiles} token={token} />
          )}
          <div>
            <FieldLabel>Do you need stock photography?</FieldLabel>
            <RadioGroup value={form.needsStockPhotography} onChange={(v) => update("needsStockPhotography", v)} options={[
              { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "not_sure", label: "Not sure yet" },
            ]} />
          </div>
          <div>
            <FieldLabel>Do you have video content?</FieldLabel>
            <RadioGroup value={form.hasVideoContent} onChange={(v) => update("hasVideoContent", v)} options={[
              { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "planning", label: "Planning to get some" },
            ]} />
          </div>
          {form.hasVideoContent === "yes" && (
            <>
              <div>
                <FieldLabel>Video links</FieldLabel>
                <TextArea value={form.videoLinks} onChange={(v) => update("videoLinks", v)} placeholder="Paste URLs or describe your video content" rows={2} />
              </div>
              <FileUploadField label="Upload video files" accept="video/*" maxFiles={5} files={videoFiles} onFilesChange={setVideoFiles} token={token} />
            </>
          )}
        </div>

        <SectionHeader number={5} title="Features & Functionality" />
        <div className="space-y-5">
          <div>
            <FieldLabel>What features does your site or portal need?</FieldLabel>
            <CheckboxGroup selected={form.featuresNeeded} onChange={(v) => update("featuresNeeded", v)} options={featureOptions} />
            <div className="mt-2">
              <TextInput value={form.featuresCustom} onChange={(v) => update("featuresCustom", v)} placeholder="Other features..." />
            </div>
          </div>
          <div>
            <FieldLabel>Third-party tools to integrate</FieldLabel>
            <TextArea value={form.thirdPartyIntegrations} onChange={(v) => update("thirdPartyIntegrations", v)} placeholder="e.g. Google Calendar, Stripe, QuickBooks, Acuity" rows={2} />
          </div>
          <div>
            <FieldLabel>Tools you're locked into that we need to work around</FieldLabel>
            <TextArea value={form.lockedInTools} onChange={(v) => update("lockedInTools", v)} placeholder="Any tools or platforms that are non-negotiable" rows={2} />
          </div>
        </div>

        <SectionHeader number={6} title="Access & Accounts" />
        <div className="space-y-5">
          <div>
            <FieldLabel>Do you own your domain?</FieldLabel>
            <RadioGroup value={form.ownsDomain} onChange={(v) => update("ownsDomain", v)} options={[
              { value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "not_sure", label: "Not sure" },
            ]} />
          </div>
          {form.ownsDomain === "yes" && (
            <div>
              <FieldLabel>Where is it registered?</FieldLabel>
              <TextInput value={form.domainRegistrar} onChange={(v) => update("domainRegistrar", v)} placeholder="e.g. GoDaddy, Namecheap, Google Domains" />
            </div>
          )}
          <div>
            <FieldLabel>Do you have existing hosting?</FieldLabel>
            <RadioGroup value={form.existingHosting} onChange={(v) => update("existingHosting", v)} options={[
              { value: "yes", label: "Yes" }, { value: "no_blackridge", label: "No — BlackRidge will handle it" },
            ]} />
          </div>
          <div>
            <FieldLabel>Logins or platform access you'll need to share</FieldLabel>
            <TextArea value={form.loginsToShare} onChange={(v) => update("loginsToShare", v)} placeholder="e.g. GoDaddy, Wix, WordPress, Google account — DO NOT include passwords here" rows={3} />
          </div>
          <div>
            <FieldLabel>Social media platforms you're active on</FieldLabel>
            <CheckboxGroup selected={form.socialPlatforms} onChange={(v) => update("socialPlatforms", v)} options={socialOptions} />
          </div>
          <div>
            <FieldLabel>Social handles or profile URLs</FieldLabel>
            <TextArea value={form.socialHandles} onChange={(v) => update("socialHandles", v)} placeholder="List your handles or profile URLs" rows={2} />
          </div>
        </div>

        <SectionHeader number={7} title="Communication & Timeline" />
        <div className="space-y-5">
          <div>
            <FieldLabel required>Main point of contact for this project</FieldLabel>
            <TextInput value={form.pointOfContact} onChange={(v) => update("pointOfContact", v)} placeholder="Name and role" />
          </div>
          <div>
            <FieldLabel>Best way to reach you during the build</FieldLabel>
            <RadioGroup value={form.preferredContact} onChange={(v) => update("preferredContact", v)} options={[
              { value: "email", label: "Email" }, { value: "text", label: "Text" }, { value: "phone", label: "Phone call" }, { value: "portal", label: "Portal messages" },
            ]} />
          </div>
          <div>
            <FieldLabel>Best days and times to reach you</FieldLabel>
            <TextInput value={form.bestTimes} onChange={(v) => update("bestTimes", v)} placeholder="e.g. Weekdays after 3pm" />
          </div>
          <div>
            <FieldLabel>Any hard deadlines?</FieldLabel>
            <RadioGroup value={form.hasDeadline} onChange={(v) => update("hasDeadline", v)} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
          </div>
          {form.hasDeadline === "yes" && (
            <div>
              <FieldLabel>Describe the deadline and why it matters</FieldLabel>
              <TextArea value={form.deadlineDetails} onChange={(v) => update("deadlineDetails", v)} placeholder="Launch events, grand openings, campaigns..." />
            </div>
          )}
          <div>
            <FieldLabel>Anything you're nervous about or want to make sure we get right?</FieldLabel>
            <TextArea value={form.nervousAbout} onChange={(v) => update("nervousAbout", v)} placeholder="No wrong answers here" />
          </div>
          <div>
            <FieldLabel>Anything else I should know before we start?</FieldLabel>
            <TextArea value={form.anythingElse} onChange={(v) => update("anythingElse", v)} placeholder="Last chance to dump your brain" />
          </div>
        </div>

        <SectionHeader number={8} title="Acknowledgment" />
        <div ref={ackRef} className={`rounded-lg p-5 transition-colors ${ackError && !acknowledged ? "bg-[#C9A840]/10 border-2 border-[#C9A840]" : "bg-[#111] border border-[#333]"}`}>
          <label className="flex items-start gap-3 cursor-pointer" data-testid="checkbox-acknowledgment">
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center mt-0.5 transition-colors shrink-0 ${acknowledged ? "border-[#C9A840] bg-[#C9A840]" : "border-gray-500"}`}
              onClick={() => { setAcknowledged(!acknowledged); setAckError(false); }}
            >
              {acknowledged && (
                <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              )}
            </div>
            <span className="text-sm text-gray-300 leading-relaxed">
              I confirm that the information I've provided is accurate and complete to the best of my knowledge. I understand that missing or incomplete information may affect project timelines, and I agree to provide any additional assets or access requested by BlackRidge Platforms promptly.
            </span>
          </label>
          {ackError && !acknowledged && (
            <p className="text-[#C9A840] text-xs mt-2 font-medium">Please acknowledge above to submit.</p>
          )}
        </div>

        <div className="mt-8 mb-12">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-[#C9A840] text-black font-bold text-lg py-4 rounded-lg hover:bg-[#b8942f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="button-submit-kickoff"
          >
            {submitting ? "Submitting..." : "Submit Kickoff Form"}
          </button>
        </div>
      </div>
    </div>
  );
}
