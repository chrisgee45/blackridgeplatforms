import { db } from "./db";
import { outreachCampaigns, campaignSteps } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const CAMPAIGN_A_NAME = "Campaign A - Website Audit";

const STEPS = [
  {
    stepNumber: 1,
    delayDays: 0,
    templateSubject: "Quick thought about {{business_name}}||{{business_domain}}||noticed this",
    templateBody: `Hey {{first_name}},

I came across {{business_name}} and spent a few minutes on your site. {{opening_line}}

My name is Chris Gee, I'm the founder of BlackRidge Platforms. We build high-end websites with full backend portals — think member login, CRM, billing, and everything running from one central location. No more juggling five different tools.

I'd love to put together a quick mock up so you can actually see what your business could look like. No pitch deck. No pressure. Just want you to see what we see.

Mind if I send that over?

Thanks,
Chris Gee
Founder | BlackRidge Platforms`,
  },
  {
    stepNumber: 2,
    delayDays: 3,
    templateSubject: "re: quick question||following up||{{business_domain}}",
    templateBody: `Hey {{first_name}},

Sent you a note a couple days ago — just wanted to make sure it didn't get buried.

We rebuilt a gym site in Tulsa last month. They went from 3 contact form submissions a week to 14 in the first 30 days. Main change was moving their phone number and booking button above the fold and adding a Google reviews widget.

Worth a 10 minute conversation to see if something similar applies to {{business_name}}? No pressure at all.

Chris Gee
Founder | BlackRidge Platforms`,
  },
  {
    stepNumber: 3,
    delayDays: 7,
    templateSubject: "what changed for them||3 weeks later||quick win",
    templateBody: `Hey {{first_name}},

Worked with a law firm in Edmond recently — they went from 1–2 contact form submissions a week to 11 in the first three weeks. Simple stuff. Phone number visible, consultation button above the fold, Google reviews on the homepage.

I think we could do some great things for {{business_name}}. Want me to mock up what that could look like? No charge, just want you to see what we see.

Chris Gee
Founder | BlackRidge Platforms`,
  },
  {
    stepNumber: 4,
    delayDays: 14,
    templateSubject: "not a $10k project||what it actually costs||honest question",
    templateBody: `Hey {{first_name}},

Most business owners I talk to assume a site rebuild is going to cost a fortune. For most of our clients it's been between $1,500 and $3,500 depending on what's needed — and most of them made that back on one or two new customers.

Is cost the main thing holding this back or is the timing just not right? Either way, no pressure.

Chris Gee
Founder | BlackRidge Platforms`,
  },
  {
    stepNumber: 5,
    delayDays: 21,
    templateSubject: "closing the loop||last note||stepping back",
    templateBody: `Hey {{first_name}},

I've reached out a few times and haven't heard back so I'll assume the timing isn't right. I won't follow up again after this.

If you ever want a second set of eyes on {{business_name}}'s site you know where to find me. Wishing you a strong rest of the year.

Chris Gee
Founder | BlackRidge Platforms`,
  },
];

export async function seedCampaignA() {
  const existing = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.name, CAMPAIGN_A_NAME))
    .limit(1);

  if (existing.length > 0) {
    const campaign = existing[0];
    const existingSteps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, campaign.id));

    for (const stepDef of STEPS) {
      const found = existingSteps.find(s => s.stepNumber === stepDef.stepNumber);
      if (found) {
        await db
          .update(campaignSteps)
          .set({
            delayDays: stepDef.delayDays,
            templateSubject: stepDef.templateSubject,
            templateBody: stepDef.templateBody,
          })
          .where(and(eq(campaignSteps.campaignId, campaign.id), eq(campaignSteps.stepNumber, stepDef.stepNumber)));
      } else {
        await db.insert(campaignSteps).values({
          campaignId: campaign.id,
          ...stepDef,
        });
      }
    }

    console.log(`Campaign A updated to ${STEPS.length} steps`);
    return campaign;
  }

  const [campaign] = await db
    .insert(outreachCampaigns)
    .values({ name: CAMPAIGN_A_NAME, isActive: true })
    .returning();

  for (const step of STEPS) {
    await db.insert(campaignSteps).values({
      campaignId: campaign.id,
      ...step,
    });
  }

  console.log(`Seeded Campaign A with ${STEPS.length} steps (id: ${campaign.id})`);
  return campaign;
}
