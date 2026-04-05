import { db } from "./db";
import { qaTemplates } from "@shared/schema";
import { eq } from "drizzle-orm";

type ProjectType = "marketing_website" | "crm_portal" | "saas_platform" | "ecommerce_site" | "internal_tool";

const CATEGORIES: Record<string, { items: string[]; types: ProjectType[] }> = {
  "Frontend UI/UX": {
    items: [
      "All pages render correctly across Chrome, Firefox, Safari, Edge",
      "Typography hierarchy is consistent across all pages",
      "Color palette matches approved design system",
      "All interactive elements have hover/focus/active states",
      "Loading states display correctly for async operations",
      "Empty states are handled gracefully",
      "Animations and transitions are smooth and performant",
      "Icons and images render at correct resolution",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Mobile Responsiveness": {
    items: [
      "Layout adapts correctly at 320px, 768px, 1024px, 1440px breakpoints",
      "Touch targets are at least 44x44px",
      "Navigation menu functions correctly on mobile",
      "Images scale properly without overflow",
      "Text remains readable without horizontal scrolling",
      "Modals and dialogs work on small screens",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Forms & Validation": {
    items: [
      "All required fields show validation errors on empty submission",
      "Email fields validate format correctly",
      "Phone number fields accept valid formats",
      "Form submission shows success/error feedback",
      "Form data persists correctly after submission",
      "File upload fields accept correct file types and sizes",
      "Multi-step forms maintain state between steps",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Backend Logic": {
    items: [
      "All API endpoints return correct status codes",
      "Input validation prevents malformed data",
      "Business logic produces expected results",
      "Background jobs execute reliably",
      "Rate limiting is configured appropriately",
      "API responses follow consistent format",
    ],
    types: ["crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Database Integrity": {
    items: [
      "Foreign key constraints are enforced",
      "Unique constraints prevent duplicate data",
      "Cascading deletes work correctly",
      "Indexes exist for frequently queried columns",
      "Data types match expected values",
      "Null handling is consistent across all fields",
    ],
    types: ["crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Authentication & Authorization": {
    items: [
      "Login flow works with valid credentials",
      "Invalid credentials show appropriate error messages",
      "Session expiration is handled gracefully",
      "Protected routes redirect unauthenticated users",
      "Role-based access control enforces permissions",
      "Password reset flow functions correctly",
      "Logout clears session completely",
    ],
    types: ["crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Payments & Billing": {
    items: [
      "Payment processing completes successfully with test cards",
      "Failed payments show clear error messages",
      "Subscription creation and cancellation work correctly",
      "Invoice generation produces accurate amounts",
      "Refund flow processes correctly",
      "Payment receipts are sent to customers",
      "Webhook handlers process Stripe events correctly",
    ],
    types: ["saas_platform", "ecommerce_site"],
  },
  "Security": {
    items: [
      "HTTPS is enforced on all pages",
      "SQL injection is prevented via parameterized queries",
      "XSS protection is active",
      "CSRF protection is implemented",
      "Sensitive data is not exposed in API responses",
      "Environment variables are not leaked to the client",
      "File uploads are validated and sanitized",
      "Content Security Policy headers are configured",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Performance": {
    items: [
      "Page load time is under 3 seconds on average connection",
      "Images are optimized and lazy-loaded where appropriate",
      "JavaScript bundle size is reasonable",
      "Database queries execute within acceptable time",
      "No memory leaks on sustained use",
      "Large data sets are paginated",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "SEO & Metadata": {
    items: [
      "Every page has a unique, descriptive title tag",
      "Meta descriptions are present and accurate",
      "Open Graph tags are configured for social sharing",
      "Canonical URLs are set correctly",
      "Sitemap.xml is generated and accessible",
      "Robots.txt is configured appropriately",
      "Structured data (JSON-LD) is implemented where relevant",
      "Alt text is present on all meaningful images",
    ],
    types: ["marketing_website", "ecommerce_site"],
  },
  "Accessibility": {
    items: [
      "All interactive elements are keyboard accessible",
      "ARIA labels are present on non-text elements",
      "Color contrast meets WCAG AA standards",
      "Screen reader navigation flow is logical",
      "Focus indicators are visible on all interactive elements",
      "Form labels are associated with inputs",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Error Handling & Logging": {
    items: [
      "404 page displays correctly for unknown routes",
      "500 errors show user-friendly messages",
      "Network failures display retry/fallback UI",
      "Error boundaries catch React component errors",
      "Server errors are logged with sufficient context",
      "Client-side errors are captured and reported",
    ],
    types: ["crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Backup & Recovery": {
    items: [
      "Database backups are scheduled and verified",
      "Restore from backup has been tested",
      "File storage (Object Storage) backup strategy is documented",
      "Disaster recovery plan is documented",
    ],
    types: ["crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
  "Legal & Compliance": {
    items: [
      "Privacy policy is accessible and up to date",
      "Terms of service are accessible and up to date",
      "Cookie consent banner is implemented (if applicable)",
      "Data handling complies with relevant regulations",
      "Third-party service usage is disclosed",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site"],
  },
  "Final Real-World Simulation Test": {
    items: [
      "Complete user journey tested end-to-end as a real user",
      "All primary call-to-action flows work correctly",
      "Contact/inquiry forms deliver submissions to the right inbox",
      "Payment flows complete successfully with real-world scenarios",
      "Email notifications are delivered correctly",
      "Mobile experience tested on actual devices",
      "Cross-browser testing completed on latest versions",
      "Client walkthrough completed with no issues flagged",
    ],
    types: ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"],
  },
};

export async function seedQaTemplates() {
  const existing = await db.select().from(qaTemplates).limit(1);
  if (existing.length > 0) {
    return;
  }

  const rows: Array<{
    projectType: ProjectType;
    category: string;
    itemDescription: string;
    sortOrder: number;
  }> = [];

  const categoryOrder = Object.keys(CATEGORIES);

  for (const type of ["marketing_website", "crm_portal", "saas_platform", "ecommerce_site", "internal_tool"] as ProjectType[]) {
    let globalSort = 0;
    for (let ci = 0; ci < categoryOrder.length; ci++) {
      const cat = categoryOrder[ci];
      const def = CATEGORIES[cat];
      if (!def.types.includes(type)) continue;
      for (const item of def.items) {
        rows.push({
          projectType: type,
          category: cat,
          itemDescription: item,
          sortOrder: globalSort++,
        });
      }
    }
  }

  if (rows.length > 0) {
    await db.insert(qaTemplates).values(rows);
  }

  console.log(`QA templates seeded: ${rows.length} items across 5 project types`);
}
