import type { RequestHandler } from "express";
import fs from "fs";
import path from "path";

const BOT_USER_AGENTS = [
  "googlebot",
  "bingbot",
  "slurp",
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "whatsapp",
  "telegrambot",
  "chatgpt-user",
  "gptbot",
  "applebot",
  "discordbot",
  "pinterestbot",
  "redditbot",
];

function isBot(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some((bot) => ua.includes(bot));
}

const MARKETING_CONTENT = `
<div id="seo-content" style="position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;">
  <header>
    <h1>BlackRidge Platforms - Custom Portals &amp; Apps That Run Your Business</h1>
    <p>BlackRidge builds custom admin dashboards, client portals, and web applications with enterprise-grade security — automated backups, encrypted data, and 99.9% uptime. From e-commerce command centers to AI-powered CRMs, we deliver platforms that replace the tools you're outgrowing.</p>
    <p>Phone: <a href="tel:+14052015869">(405) 201-5869</a></p>
  </header>

  <nav aria-label="Main Navigation">
    <ul>
      <li><a href="#services">Services</a></li>
      <li><a href="#portfolio">Our Work</a></li>
      <li><a href="#process">Process</a></li>
      <li><a href="#about">About</a></li>
      <li><a href="#contact">Contact</a></li>
    </ul>
  </nav>

  <section id="services">
    <h2>Services Built for Impact</h2>
    <p>We build the digital infrastructure that ambitious businesses of every size depend on.</p>

    <article>
      <h3>Enterprise Web Platforms</h3>
      <p>Scalable, secure web platforms built to handle millions of users. Custom architecture designed for your exact business requirements.</p>
    </article>
    <article>
      <h3>Client Portals &amp; Dashboards</h3>
      <p>Intuitive, data-rich portals that empower your clients and teams with real-time insights and seamless self-service capabilities.</p>
    </article>
    <article>
      <h3>Custom Web Applications</h3>
      <p>Bespoke applications engineered from the ground up. Every line of code tailored to solve your unique business challenges.</p>
    </article>
    <article>
      <h3>Platform Architecture</h3>
      <p>Future-proof technical architecture that scales with your growth. Microservices, APIs, and cloud infrastructure done right.</p>
    </article>
    <article>
      <h3>Security &amp; Compliance</h3>
      <p>Enterprise-grade security baked into every layer. SOC 2, GDPR, and HIPAA compliance built from day one.</p>
    </article>
    <article>
      <h3>Performance Optimization</h3>
      <p>Sub-second load times and silky-smooth interactions. We obsess over every millisecond so your users never wait.</p>
    </article>
  </section>

  <section id="data-security">
    <h2>Enterprise-Grade Data Security</h2>
    <p>Your data is protected with automated nightly backups to Amazon S3, encrypted database storage, and secure cloud infrastructure. We maintain 99.9% uptime with redundant systems and continuous monitoring. Every platform we build includes enterprise-grade security as standard — not an add-on.</p>
  </section>

  <section id="portfolio">
    <h2>Platforms That Perform</h2>
    <p>A selection of digital platforms we've engineered for industry leaders.</p>

    <article>
      <h3>RKJ Investigations</h3>
      <p>Category: Professional Services</p>
      <p>Sleek, confidential website for a professional investigations firm. Dark premium design with service showcases, consultation booking, and court-ready documentation features.</p>
      <p>Technologies: React, Node.js, Tailwind CSS, PostgreSQL</p>
    </article>
    <article>
      <h3>Heatwave Fitness</h3>
      <p>Category: Fitness &amp; Wellness</p>
      <p>A bold, high-energy platform built for H.E.A.T. Fitness — an original workout format matching weight lifting choreography to music beats. Member portal with on-demand video access, class scheduling, and community features that boosted client retention.</p>
      <p>Technologies: React, Node.js, Tailwind CSS, Streaming</p>
    </article>
    <article>
      <h3>BudgetWise</h3>
      <p>Category: FinTech SaaS</p>
      <p>A clean, intuitive personal finance platform with smart budgeting, savings goal tracking, and subscription management. Full-stack application with a secure back-end portal and tiered subscription service.</p>
      <p>Technologies: React, Node.js, PostgreSQL, Stripe</p>
    </article>
    <article>
      <h3>Hometown Rock Supply</h3>
      <p>Category: E-Commerce &amp; Admin Portal</p>
      <p>End-to-end business platform with a public storefront featuring 65+ products and a powerful admin command center. Real-time order tracking, automated quoting, customer management, revenue dashboards, and automated nightly S3 backups — replacing three separate tools the client was juggling before.</p>
      <p>Technologies: React, Node.js, PostgreSQL, AWS S3</p>
    </article>
    <article>
      <h3>ITAD Portal</h3>
      <p>Category: R2-Certified IT Asset Disposition</p>
      <p>A full-featured operations portal for an R2-certified IT asset disposition company. Tracks assets through intake, data wipe, grading, and resale with chain-of-custody logging, compliance certificates, vendor management, and inventory controls.</p>
      <p>Technologies: React, Node.js, PostgreSQL, R2 Compliance</p>
    </article>
    <article>
      <h3>BlackRidge Ops</h3>
      <p>Category: All-in-One Business Operations</p>
      <p>Our flagship operations platform — a comprehensive suite powering CRM, project management, double-entry bookkeeping, tax planning, AI-powered outreach, invoicing with Stripe payments, and real-time business analytics. One platform that replaces Salesforce, QuickBooks, and Monday.com.</p>
      <p>Technologies: React, OpenAI, Stripe, PostgreSQL, Double-Entry Ledger</p>
    </article>
  </section>

  <section id="process">
    <h2>From Vision to Reality</h2>
    <p>Our proven four-phase process ensures every project is delivered on time, on budget, and beyond expectations.</p>
    <ol>
      <li><strong>Discovery &amp; Strategy</strong> — We dive deep into your business goals, user needs, and technical requirements to craft a comprehensive platform strategy.</li>
      <li><strong>Architecture &amp; Design</strong> — Our engineers design scalable system architecture while our designers create pixel-perfect interfaces that convert.</li>
      <li><strong>Engineering &amp; Build</strong> — Agile development sprints with continuous delivery. You see progress weekly and have full visibility into every milestone.</li>
      <li><strong>Launch &amp; Scale</strong> — Rigorous QA, performance testing, and a seamless launch. Then we optimize and scale based on real user data.</li>
    </ol>
  </section>

  <section id="testimonials">
    <h2>Trusted by Industry Leaders</h2>
    <blockquote>
      <p>"BlackRidge transformed our entire digital infrastructure. The platform they built handles 10x the traffic we anticipated and our conversion rate doubled within three months."</p>
      <cite>— Sarah Chen, CTO</cite>
    </blockquote>
    <blockquote>
      <p>"Their engineering team is on another level. They didn't just build what we asked for - they anticipated challenges we hadn't even considered and solved them proactively."</p>
      <cite>— Marcus Williams, VP Engineering</cite>
    </blockquote>
    <blockquote>
      <p>"BlackRidge built our website from the ground up and delivered exactly what we needed. Professional, discreet, and the final product speaks for itself. Highly recommend."</p>
      <cite>— Adam Taylor, CEO, RKJ Investigations</cite>
    </blockquote>
    <blockquote>
      <p>"Working with BlackRidge was seamless from start to finish. They took my vision and turned it into a platform that truly represents what we're about. Outstanding team."</p>
      <cite>— Chris, Founder, www.buildfromanywhere.com</cite>
    </blockquote>
    <blockquote>
      <p>"BlackRidge built our Heatwave Fitness platform and gave us a member portal that completely changed how we retain clients. They truly understood our brand."</p>
      <cite>— Crissy Mize, Founder, Heatwave Fitness</cite>
    </blockquote>
    <blockquote>
      <p>"We interviewed eight agencies. BlackRidge was the only team that truly understood our technical requirements and delivered a platform that exceeded every benchmark we set."</p>
      <cite>— Elena Rodriguez, Founder</cite>
    </blockquote>
  </section>

  <section id="about">
    <h2>About BlackRidge Platforms — Built Different. Built to Last.</h2>
    <p>BlackRidge Platforms was founded on a simple belief: every business deserves a digital platform as ambitious as their vision. Whether you're a startup ready to scale or an enterprise rethinking your digital presence, we bring senior-level engineering expertise to build custom platforms that become competitive advantages.</p>
    <p>Every project gets our A-team. Every line of code is written with intention. Every platform is built to scale. That's the BlackRidge standard, and we never compromise.</p>
    <ul>
      <li><strong>Uncompromising Quality</strong> — Every platform we ship meets the highest standards of performance, security, and reliability.</li>
      <li><strong>Speed to Market</strong> — Agile methodology and battle-tested processes mean your platform launches faster without cutting corners.</li>
      <li><strong>Transparent Partnership</strong> — Full visibility into progress, budgets, and timelines. No surprises, no hidden costs, no excuses.</li>
    </ul>
    <p>50+ Platforms Delivered | 99.9% Uptime Guarantee | 4.9/5 Client Rating</p>
  </section>

  <section id="contact">
    <h2>Ready to Build Something Extraordinary?</h2>
    <p>Tell us about your project and we'll get back to you within 24 hours with a strategic assessment and proposed approach.</p>
    <address>
      <p>Email: <a href="mailto:chris@blackridgeplatforms.com">chris@blackridgeplatforms.com</a></p>
      <p>Phone: <a href="tel:+14052015869">405-201-5869</a></p>
      <p>Location: Edmond, OK</p>
    </address>
  </section>

  <footer>
    <p>&copy; 2025 BlackRidge Platforms. All rights reserved.</p>
  </footer>
</div>
`;

export function createSeoMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.path !== "/" && req.path !== "") {
      return next();
    }

    if (!isBot(req.headers["user-agent"])) {
      return next();
    }

    let templatePath: string;
    const currentDir = path.dirname(new URL(import.meta.url).pathname);
    const distPath = path.resolve(currentDir, "public");
    const devPath = path.resolve(currentDir, "..", "client", "index.html");

    if (process.env.NODE_ENV === "production" && fs.existsSync(path.join(distPath, "index.html"))) {
      templatePath = path.join(distPath, "index.html");
    } else if (fs.existsSync(devPath)) {
      templatePath = devPath;
    } else {
      return next();
    }

    try {
      let html = fs.readFileSync(templatePath, "utf-8");
      html = html.replace(
        '<div id="root"></div>',
        `<div id="root">${MARKETING_CONTENT}</div>`
      );
      res.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch {
      next();
    }
  };
}
