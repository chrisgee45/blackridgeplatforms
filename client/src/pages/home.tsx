import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import rkjScreenshot from "@assets/Screenshot_2026-02-11_110341_1770829532587.png";
import heatwaveScreenshot from "@assets/Screenshot_2026-02-16_190342_1771290376120.png";
import budgetwiseScreenshot from "@assets/Screenshot_2026-02-16_194159_1771292597157.png";
import hometownRockScreenshot from "@assets/Screenshot_2026-02-27_110410_1772212031645.png";
import hometownRockDashboard from "@assets/Screenshot_2026-03-08_094917_1772981413057.png";
import taxCenterScreenshot from "@assets/taxcenter_1772212401403.png";
import outreachScreenshot from "@assets/opps_portal_1772212410625.png";
import itadLight from "@assets/Screenshot_2026-03-08_123040_1772992484875.png";
import itadDark from "@assets/Screenshot_2026-03-08_123101_1772992555208.png";
import itadAssetDetail from "@assets/Screenshot_2026-03-08_123145_1772992555209.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertContactSchema, type InsertContact } from "@shared/schema";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Globe,
  Shield,
  Zap,
  Code2,
  Layers,
  ArrowRight,
  CheckCircle2,
  Star,
  Menu,
  X,
  ChevronRight,
  Monitor,
  Database,
  Lock,
  Rocket,
  Users,
  BarChart3,
  Mail,
  MapPin,
  Mountain,
  Phone,
  CloudCog,
  ShieldCheck,
  HardDrive,
  Brain,
  Cpu,
  Wrench,
} from "lucide-react";

const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
};

function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileOpen(false);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-4 h-16">
        <button
          onClick={() => scrollTo("hero")}
          className="flex items-center gap-2"
          data-testid="link-home"
        >
          <Mountain className="h-6 w-6 text-primary" />
          <span className="text-lg font-bold tracking-tight text-foreground">
            BlackRidge<span className="text-primary"> Platforms</span>
          </span>
        </button>

        <div className="hidden md:flex items-center gap-8">
          {[
            { label: "Services", id: "services" },
            { label: "Work", id: "portfolio" },
            { label: "Process", id: "process" },
            { label: "About", id: "about" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => scrollTo(item.id)}
              className="text-sm text-muted-foreground transition-colors duration-200"
              style={{ cursor: "pointer" }}
              data-testid={`link-${item.id}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-3">
          <a
            href="tel:+14052015869"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
            data-testid="link-phone-nav"
          >
            <Phone className="h-4 w-4" />
            <span>(405) 201-5869</span>
          </a>
          <Button
            variant="default"
            onClick={() => scrollTo("contact")}
            data-testid="button-start-project-nav"
          >
            Start a Project
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          data-testid="button-mobile-menu"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {mobileOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="md:hidden border-t border-border bg-background"
        >
          <div className="flex flex-col p-6 gap-4">
            {["services", "portfolio", "process", "about", "contact"].map((id) => (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className="text-sm text-muted-foreground py-2 text-left capitalize"
                data-testid={`link-mobile-${id}`}
              >
                {id === "portfolio" ? "Work" : id.charAt(0).toUpperCase() + id.slice(1)}
              </button>
            ))}
            <a
              href="tel:+14052015869"
              className="flex items-center gap-2 text-sm text-muted-foreground py-2"
              data-testid="link-phone-mobile"
            >
              <Phone className="h-4 w-4" />
              (405) 201-5869
            </a>
            <Button onClick={() => scrollTo("contact")} data-testid="button-start-project-mobile">
              Start a Project
            </Button>
          </div>
        </motion.div>
      )}
    </nav>
  );
}

function HeroSection() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section id="hero" className="relative min-h-screen flex items-center overflow-hidden">
      <div className="absolute inset-0">
        <img
          src="/images/hero-bg.jpg"
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/90 via-background/70 to-background" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/60" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 pt-32 pb-20 w-full">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="max-w-3xl"
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-6 text-primary border-primary/30 bg-primary/5">
              AI-Powered Systems Integration
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeInUp}
            className="text-4xl sm:text-5xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6"
          >
            We Architect the Business Systems
            <span className="text-primary block mt-2">That AI Chatbots Can't Build</span>
          </motion.h1>

          <motion.p
            variants={fadeInUp}
            className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed"
          >
            Stop outgrowing your software. We leverage enterprise AI development tools to architect
            custom CRMs, client portals, and operational dashboards faster than traditional
            agencies—and with the complex business logic that DIY builders cannot handle.
          </motion.p>

          <motion.div variants={fadeInUp} className="flex flex-wrap gap-4">
            <Button
              size="lg"
              onClick={() => scrollTo("contact")}
              data-testid="button-start-project-hero"
            >
              Start Your Project
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="backdrop-blur-sm bg-background/20"
              onClick={() => scrollTo("portfolio")}
              data-testid="button-view-work"
            >
              View Our Work
            </Button>
          </motion.div>

          <motion.div
            variants={fadeInUp}
            className="flex flex-wrap items-center gap-6 mt-14 pt-8 border-t border-border/30"
          >
            {[
              { value: "50+", label: "Platforms Delivered" },
              { value: "99.9%", label: "Uptime Guarantee" },
              { value: "4.9/5", label: "Client Rating" },
            ].map((stat) => (
              <div key={stat.label} className="flex flex-col">
                <span className="text-2xl md:text-3xl font-bold text-primary" data-testid={`text-stat-${stat.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  {stat.value}
                </span>
                <span className="text-sm text-muted-foreground">{stat.label}</span>
              </div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

const services = [
  {
    icon: Globe,
    title: "Enterprise Web Platforms",
    description:
      "Scalable, secure web platforms built to handle millions of users. Custom architecture designed for your exact business requirements.",
  },
  {
    icon: Monitor,
    title: "Client Portals & Dashboards",
    description:
      "Intuitive, data-rich portals that empower your clients and teams with real-time insights and seamless self-service capabilities.",
  },
  {
    icon: Code2,
    title: "Custom Web Applications",
    description:
      "Bespoke applications engineered from the ground up. Every line of code tailored to solve your unique business challenges.",
  },
  {
    icon: Database,
    title: "Platform Architecture",
    description:
      "Future-proof technical architecture that scales with your growth. Microservices, APIs, and cloud infrastructure done right.",
  },
  {
    icon: Lock,
    title: "Security & Compliance",
    description:
      "Enterprise-grade security baked into every layer. SOC 2, GDPR, and HIPAA compliance built from day one.",
  },
  {
    icon: Rocket,
    title: "Performance Optimization",
    description:
      "Sub-second load times and silky-smooth interactions. We obsess over every millisecond so your users never wait.",
  },
  {
    icon: Brain,
    title: "Enterprise AI Integration",
    description:
      "We don't just use AI to build your system; we build AI into your system. From automated lead scoring and predictive analytics to custom internal chatbots trained on your proprietary data.",
  },
];

function BlackridgeAdvantageSection() {
  const advantages = [
    {
      icon: Cpu,
      title: "Speed of AI, Precision of Engineering",
      description:
        "We use advanced AI development environments to cut development time in half, but every line of code is architected by senior engineers to ensure it scales.",
    },
    {
      icon: Layers,
      title: "Complex Business Logic",
      description:
        "Consumer AI can build a landing page. We build multi-tenant SaaS platforms, double-entry ledgers, and HIPAA-compliant portals.",
    },
    {
      icon: Wrench,
      title: "Day 2 Reliability",
      description:
        "We don't just generate code and walk away. We provide the ongoing strategic partnership required to maintain and scale enterprise systems.",
    },
  ];

  return (
    <section className="py-24 md:py-32 border-b border-border/20">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="text-center mb-16"
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
              Why Choose Us
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeInUp}
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
          >
            The Blackridge
            <span className="text-primary"> Advantage</span>
          </motion.h2>
          <motion.p
            variants={fadeInUp}
            className="text-muted-foreground max-w-2xl mx-auto text-lg"
          >
            We combine the speed of AI with the precision of senior engineering.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={staggerContainer}
          className="grid md:grid-cols-3 gap-6"
        >
          {advantages.map((item) => (
            <motion.div key={item.title} variants={fadeInUp}>
              <Card className="h-full hover-elevate group border-border/50 bg-card/50">
                <CardContent className="p-6 pt-6">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-5">
                    <item.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3
                    className="text-lg font-semibold mb-3"
                    data-testid={`text-advantage-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {item.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function ServicesSection() {
  return (
    <section id="services" className="py-24 md:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="text-center mb-16"
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
              What We Build
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeInUp}
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
          >
            Services Built for
            <span className="text-primary"> Impact</span>
          </motion.h2>
          <motion.p
            variants={fadeInUp}
            className="text-muted-foreground max-w-2xl mx-auto text-lg"
          >
            We build the digital infrastructure that ambitious businesses
            of every size depend on.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={staggerContainer}
          className="grid md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {services.map((service) => (
            <motion.div key={service.title} variants={fadeInUp}>
              <Card className="h-full hover-elevate group border-border/50 bg-card/50">
                <CardContent className="p-6 pt-6">
                  <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center mb-5">
                    <service.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3
                    className="text-lg font-semibold mb-3"
                    data-testid={`text-service-${service.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {service.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {service.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

type CarouselSlide = {
  image: string;
  label: string;
};

type PortfolioItem = {
  title: string;
  category: string;
  description: string;
  tags: string[];
  image?: string;
  slides?: CarouselSlide[];
};

function PortfolioCarousel({ slides }: { slides: CarouselSlide[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const advance = useCallback(() => {
    setActiveIndex((i) => (i + 1) % slides.length);
  }, [slides.length]);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(advance, 4500);
    return () => clearInterval(timer);
  }, [paused, advance]);

  return (
    <div
      className="relative overflow-hidden rounded-t-xl"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <AnimatePresence mode="wait">
        <motion.img
          key={activeIndex}
          src={slides[activeIndex].image}
          alt={slides[activeIndex].label}
          loading="lazy"
          decoding="async"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full aspect-video object-cover"
          data-testid={`img-carousel-${slides[activeIndex].label.toLowerCase().replace(/\s+/g, '-')}`}
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
      <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
        {slides.map((slide, i) => (
          <button
            key={slide.label}
            onClick={() => setActiveIndex(i)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-all ${
              i === activeIndex
                ? "bg-primary text-primary-foreground"
                : "bg-background/70 text-muted-foreground backdrop-blur-sm hover:bg-background/90"
            }`}
            data-testid={`carousel-tab-${slide.label.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {slide.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const portfolio: PortfolioItem[] = [
  {
    title: "RKJ Investigations",
    category: "Professional Services",
    description:
      "Sleek, confidential website for a professional investigations firm. Dark premium design with service showcases, consultation booking, and court-ready documentation features.",
    image: rkjScreenshot,
    tags: ["React", "Node.js", "Tailwind CSS", "PostgreSQL"],
  },
  {
    title: "Heatwave Fitness",
    category: "Fitness & Wellness",
    description:
      "Increased member retention by 40%. A bold member portal with on-demand video access, class scheduling, and community features that keep members engaged between sessions.",
    image: heatwaveScreenshot,
    tags: ["React", "Node.js", "Tailwind CSS", "Streaming"],
  },
  {
    title: "BudgetWise",
    category: "FinTech SaaS",
    description:
      "A clean, intuitive personal finance platform with smart budgeting, savings goal tracking, and subscription management. We built the full-stack application with a secure back-end portal for user management and a tiered subscription service powering free and premium plans.",
    image: budgetwiseScreenshot,
    tags: ["React", "Node.js", "PostgreSQL", "Stripe"],
  },
  {
    title: "Hometown Rock Supply",
    category: "E-Commerce & Admin Portal",
    description:
      "End-to-end business platform with a public storefront featuring 65+ products and a powerful admin command center. Real-time order tracking, automated quoting, customer management, revenue dashboards, and automated nightly S3 backups — replacing three separate tools the client was juggling before.",
    slides: [
      { image: hometownRockScreenshot, label: "Storefront" },
      { image: hometownRockDashboard, label: "Command Center" },
    ],
    tags: ["React", "Node.js", "PostgreSQL", "AWS S3"],
  },
  {
    title: "ITAD Portal",
    category: "R2-Certified IT Asset Disposition",
    description:
      "Reduced compliance reporting time by 80%. A full-featured operations portal tracking assets through intake, data wipe, grading, and resale with chain-of-custody logging and R2 compliance certificates.",
    slides: [
      { image: itadLight, label: "Light Mode" },
      { image: itadDark, label: "Dark Mode" },
      { image: itadAssetDetail, label: "Asset Detail" },
    ],
    tags: ["React", "Node.js", "PostgreSQL", "R2 Compliance"],
  },
  {
    title: "BlackRidge Ops",
    category: "All-in-One Business Operations",
    description:
      "Our flagship operations platform. One platform that replaces Salesforce, QuickBooks, and Monday.com. Features CRM, project management, double-entry bookkeeping, tax planning, and AI-powered outreach.",
    slides: [
      { image: taxCenterScreenshot, label: "Tax Center" },
      { image: outreachScreenshot, label: "Outreach" },
    ],
    tags: ["React", "OpenAI", "Stripe", "PostgreSQL", "Double-Entry Ledger"],
  },
];

function PortfolioSection() {
  return (
    <section id="portfolio" className="py-24 md:py-32 bg-card/30">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="text-center mb-16"
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
              Our Work
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeInUp}
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
          >
            Platforms That
            <span className="text-primary"> Perform</span>
          </motion.h2>
          <motion.p
            variants={fadeInUp}
            className="text-muted-foreground max-w-2xl mx-auto text-lg"
          >
            A selection of digital platforms we've engineered for industry leaders.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={staggerContainer}
          className="grid md:grid-cols-2 gap-6"
        >
          {portfolio.map((project, index) => (
            <motion.div key={project.title} variants={fadeInUp}>
              <Card className="group hover-elevate border-border/50 bg-card/80">
                {project.slides ? (
                  <PortfolioCarousel slides={project.slides} />
                ) : (
                  <div className="relative overflow-hidden rounded-t-xl">
                    <img
                      src={project.image}
                      alt={project.title}
                      loading="lazy"
                      decoding="async"
                      className="w-full aspect-video object-cover transition-transform duration-500 group-hover:scale-105"
                      data-testid={`img-portfolio-${index}`}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
                  </div>
                )}
                <CardContent className="p-6">
                  <Badge variant="secondary" className="mb-3 text-xs">
                    {project.category}
                  </Badge>
                  <h3
                    className="text-xl font-semibold mb-2"
                    data-testid={`text-portfolio-title-${index}`}
                  >
                    {project.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                    {project.description}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {project.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs text-muted-foreground border-border/50">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

const processSteps = [
  {
    number: "01",
    title: "Discovery & Strategy",
    description:
      "We dive deep into your business goals, user needs, and technical requirements to craft a comprehensive platform strategy.",
    icon: Users,
  },
  {
    number: "02",
    title: "Architecture & Design",
    description:
      "Our engineers design scalable system architecture while our designers create pixel-perfect interfaces that convert.",
    icon: Layers,
  },
  {
    number: "03",
    title: "Engineering & Build",
    description:
      "Agile development sprints with continuous delivery. You see progress weekly and have full visibility into every milestone.",
    icon: Code2,
  },
  {
    number: "04",
    title: "Launch & Scale",
    description:
      "Rigorous QA, performance testing, and a seamless launch. Then we optimize and scale based on real user data.",
    icon: BarChart3,
  },
];

function ProcessSection() {
  return (
    <section id="process" className="py-24 md:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="text-center mb-16"
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
              How We Work
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeInUp}
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
          >
            From Vision to
            <span className="text-primary"> Reality</span>
          </motion.h2>
          <motion.p
            variants={fadeInUp}
            className="text-muted-foreground max-w-2xl mx-auto text-lg"
          >
            Our proven four-phase process ensures every project is delivered on
            time, on budget, and beyond expectations.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={staggerContainer}
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {processSteps.map((step) => (
            <motion.div key={step.number} variants={fadeInUp}>
              <Card className="h-full border-border/50 bg-card/50 hover-elevate">
                <CardContent className="p-6 pt-6">
                  <div className="flex items-center justify-between mb-6">
                    <span className="text-4xl font-bold text-primary/20">
                      {step.number}
                    </span>
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                      <step.icon className="h-5 w-5 text-primary" />
                    </div>
                  </div>
                  <h3 className="text-lg font-semibold mb-3">{step.title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {step.description}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

const testimonials = [
  {
    quote:
      "BlackRidge transformed our entire digital infrastructure. The platform they built handles 10x the traffic we anticipated and our conversion rate doubled within three months.",
    author: "Sarah Chen",
    role: "CTO",
    rating: 5,
  },
  {
    quote:
      "Their engineering team is on another level. They didn't just build what we asked for - they anticipated challenges we hadn't even considered and solved them proactively.",
    author: "Marcus Williams",
    role: "VP Engineering",
    rating: 5,
  },
  {
    quote:
      "BlackRidge built our website from the ground up and delivered exactly what we needed. Professional, discreet, and the final product speaks for itself. Highly recommend.",
    author: "Adam Taylor",
    role: "CEO, RKJ Investigations",
    rating: 5,
  },
  {
    quote:
      "Working with BlackRidge was seamless from start to finish. They took my vision for buildfromanywhere.com and turned it into a platform that truly represents what we're about. Outstanding team.",
    author: "Chris",
    role: "Founder, www.buildfromanywhere.com",
    rating: 5,
  },
  {
    quote:
      "BlackRidge built our Heatwave Fitness platform and gave us a member portal that completely changed how we retain clients. Our members stay engaged between classes with on-demand videos and scheduling tools. They truly understood our brand and delivered something that feels as powerful as our workouts.",
    author: "Crissy Mize",
    role: "Founder, Heatwave Fitness",
    rating: 4,
  },
  {
    quote:
      "We interviewed eight agencies. BlackRidge was the only team that truly understood our technical requirements and delivered a platform that exceeded every benchmark we set.",
    author: "Elena Rodriguez",
    role: "Founder",
    rating: 5,
  },
];

function TestimonialsSection() {
  return (
    <section className="py-24 md:py-32 bg-card/30">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="text-center mb-16"
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
              Client Results
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeInUp}
            className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
          >
            Trusted by
            <span className="text-primary"> Industry Leaders</span>
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={staggerContainer}
          className="grid md:grid-cols-3 gap-6"
        >
          {testimonials.map((t, index) => (
            <motion.div key={index} variants={fadeInUp}>
              <Card className="h-full border-border/50 bg-card/50">
                <CardContent className="p-6 pt-6 flex flex-col h-full">
                  <div className="flex gap-1 mb-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        key={i}
                        className={`h-4 w-4 ${i < t.rating ? "fill-primary text-primary" : "text-muted-foreground/30"}`}
                      />
                    ))}
                  </div>
                  <p
                    className="text-foreground/90 text-sm leading-relaxed mb-6 flex-1 italic"
                    data-testid={`text-testimonial-${index}`}
                  >
                    "{t.quote}"
                  </p>
                  <div className="border-t border-border/30 pt-4">
                    <p className="font-semibold text-sm">{t.author}</p>
                    <p className="text-muted-foreground text-xs">{t.role}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function AboutSection() {
  const values = [
    {
      icon: Shield,
      title: "Uncompromising Quality",
      description: "Every platform we ship meets the highest standards of performance, security, and reliability.",
    },
    {
      icon: Zap,
      title: "Speed to Market",
      description: "Agile methodology and battle-tested processes mean your platform launches faster without cutting corners.",
    },
    {
      icon: CheckCircle2,
      title: "Transparent Partnership",
      description: "Full visibility into progress, budgets, and timelines. No surprises, no hidden costs, no excuses.",
    },
  ];

  return (
    <section id="about" className="py-24 md:py-32">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            <motion.div variants={fadeInUp}>
              <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
                About BlackRidge
              </Badge>
            </motion.div>
            <motion.h2
              variants={fadeInUp}
              className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6"
            >
              Built Different.
              <span className="text-primary block mt-1">Built to Last.</span>
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-muted-foreground text-lg leading-relaxed mb-6"
            >
              Blackridge Platforms was founded on the belief that the future of software
              isn't writing every line of code by hand—it's architecting brilliant systems.
              We are an AI-native agency. By combining senior-level systems architecture
              with cutting-edge AI development tools, we deliver enterprise-grade platforms
              faster, more securely, and more cost-effectively than legacy agencies.
            </motion.p>
            <motion.p
              variants={fadeInUp}
              className="text-muted-foreground leading-relaxed"
            >
              Every project gets our A-team. Every platform is built to scale.
              That's the BlackRidge standard.
            </motion.p>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="space-y-6"
          >
            {values.map((value) => (
              <motion.div key={value.title} variants={fadeInUp}>
                <Card className="border-border/50 bg-card/50 hover-elevate">
                  <CardContent className="p-6 pt-6 flex gap-4">
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <value.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold mb-1">{value.title}</h3>
                      <p className="text-muted-foreground text-sm leading-relaxed">
                        {value.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  const { toast } = useToast();
  const form = useForm<InsertContact>({
    resolver: zodResolver(
      insertContactSchema.extend({
        name: insertContactSchema.shape.name.min(2, "Name is required"),
        email: insertContactSchema.shape.email.email("Valid email required"),
        message: insertContactSchema.shape.message.min(10, "Tell us more about your project"),
      })
    ),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      projectType: "",
      budget: "",
      message: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: InsertContact) => {
      const res = await apiRequest("POST", "/api/contact", data);
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Message sent successfully",
        description: "We'll be in touch within 24 hours.",
      });
      form.reset();
    },
    onError: () => {
      toast({
        title: "Something went wrong",
        description: "Please try again or email us directly.",
        variant: "destructive",
      });
    },
  });

  return (
    <section id="contact" className="py-24 md:py-32 bg-card/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
          >
            <motion.div variants={fadeInUp}>
              <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
                Get Started
              </Badge>
            </motion.div>
            <motion.h2
              variants={fadeInUp}
              className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6"
            >
              Ready to Build Something
              <span className="text-primary block mt-1">Extraordinary?</span>
            </motion.h2>
            <motion.p
              variants={fadeInUp}
              className="text-muted-foreground text-lg leading-relaxed mb-10"
            >
              Tell us about your project and we'll get back to you within 24
              hours with a strategic assessment and proposed approach.
            </motion.p>

            <motion.div variants={staggerContainer} className="space-y-6">
              {[
                { icon: Mail, label: "chris@blackridgeplatforms.com" },
                { icon: MapPin, label: "Edmond, OK" },
              ].map((contact) => (
                <motion.div
                  key={contact.label}
                  variants={fadeInUp}
                  className="flex items-center gap-4"
                >
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <contact.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-muted-foreground" data-testid={`text-contact-${contact.label.includes('@') ? 'email' : 'location'}`}>
                    {contact.label}
                  </span>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeInUp}
          >
            <Card className="border-border/50 bg-card/80">
              <CardContent className="p-6 pt-6">
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit((data) => mutation.mutate(data))}
                    className="space-y-5"
                    data-testid="form-contact"
                  >
                    <div className="grid sm:grid-cols-2 gap-5">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Full Name</FormLabel>
                            <FormControl>
                              <Input placeholder="John Smith" {...field} data-testid="input-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input placeholder="john@company.com" {...field} data-testid="input-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="company"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Company</FormLabel>
                          <FormControl>
                            <Input placeholder="Your company name" {...field} value={field.value ?? ""} data-testid="input-company" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid sm:grid-cols-2 gap-5">
                      <FormField
                        control={form.control}
                        name="projectType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Project Type</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-project-type">
                                  <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="enterprise-platform">Enterprise Platform</SelectItem>
                                <SelectItem value="client-portal">Client Portal</SelectItem>
                                <SelectItem value="web-application">Web Application</SelectItem>
                                <SelectItem value="ecommerce">E-Commerce</SelectItem>
                                <SelectItem value="other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="budget"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Budget Range</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value ?? ""}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="select-budget">
                                  <SelectValue placeholder="Select range" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="1k-2.5k">$1K - $2.5K</SelectItem>
                                <SelectItem value="2.5k-5k">$2.5K - $5K</SelectItem>
                                <SelectItem value="5k-15k">$5K - $15K</SelectItem>
                                <SelectItem value="15k-30k">$15K - $30K</SelectItem>
                                <SelectItem value="30k-75k">$30K - $75K</SelectItem>
                                <SelectItem value="75k-150k">$75K - $150K</SelectItem>
                                <SelectItem value="150k+">$150K+</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="message"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Project Details</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Tell us about your project, goals, and timeline..."
                              className="resize-none min-h-[120px]"
                              {...field}
                              data-testid="textarea-message"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      size="lg"
                      className="w-full"
                      disabled={mutation.isPending}
                      data-testid="button-submit-contact"
                    >
                      {mutation.isPending ? "Sending..." : "Send Project Inquiry"}
                      {!mutation.isPending && <ChevronRight className="ml-1 h-4 w-4" />}
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function TrustStripSection() {
  const trustItems = [
    {
      icon: ShieldCheck,
      title: "Automated Nightly Backups",
      description: "Your data is backed up every night to secure cloud storage (Amazon S3). 30+ restore points always available.",
    },
    {
      icon: Lock,
      title: "Encrypted at Every Layer",
      description: "AES-256 encryption for data at rest, TLS 1.3 in transit. Enterprise-grade security from database to browser.",
    },
    {
      icon: HardDrive,
      title: "99.9% Uptime Guarantee",
      description: "Redundant cloud infrastructure with automatic failover. Your platform stays online when it matters most.",
    },
    {
      icon: CloudCog,
      title: "Secure Cloud Infrastructure",
      description: "Hosted on hardened cloud servers with DDoS protection, firewall rules, and real-time monitoring built in.",
    },
  ];

  return (
    <section className="py-16 md:py-20 border-b border-border/20">
      <div className="max-w-7xl mx-auto px-6">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          variants={staggerContainer}
          className="text-center mb-12"
        >
          <motion.div variants={fadeInUp}>
            <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">
              Enterprise-Grade Security
            </Badge>
          </motion.div>
          <motion.h2
            variants={fadeInUp}
            className="text-2xl md:text-3xl font-bold tracking-tight mb-3"
          >
            Your Data Is <span className="text-primary">Always Protected</span>
          </motion.h2>
          <motion.p
            variants={fadeInUp}
            className="text-muted-foreground max-w-2xl mx-auto"
          >
            Every platform we build includes automated backups, encrypted storage, and secure cloud hosting — so you never worry about data loss.
          </motion.p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={staggerContainer}
          className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {trustItems.map((item) => (
            <motion.div key={item.title} variants={fadeInUp}>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <item.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-2 text-sm" data-testid={`text-trust-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                  {item.title}
                </h3>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {item.description}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <footer className="py-12 border-t border-border/30">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <Mountain className="h-5 w-5 text-primary" />
            <span className="font-bold tracking-tight">
              BlackRidge<span className="text-primary"> Platforms</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6">
            {["services", "portfolio", "process", "about", "contact"].map((id) => (
              <button
                key={id}
                onClick={() => scrollTo(id)}
                className="text-sm text-muted-foreground capitalize"
                data-testid={`link-footer-${id}`}
              >
                {id === "portfolio" ? "Work" : id}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <a
              href="tel:+14052015869"
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
              data-testid="link-phone-footer"
            >
              <Phone className="h-3 w-3" />
              (405) 201-5869
            </a>
            <p className="text-xs text-muted-foreground">
              &copy; 2026 BlackRidge Platforms. All rights reserved.
            </p>
            <a
              href="/admin"
              className="text-xs text-muted-foreground/50 transition-colors"
              data-testid="link-admin-login"
            >
              Admin
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <Navbar />
      <HeroSection />
      <BlackridgeAdvantageSection />
      <ServicesSection />
      <TrustStripSection />
      <PortfolioSection />
      <ProcessSection />
      <TestimonialsSection />
      <AboutSection />
      <ContactSection />
      <Footer />
    </div>
  );
}
